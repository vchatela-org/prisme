import { describe, expect, it } from 'vitest';

import type { Area, AreaWeight } from '../entities/area.js';
import { parseCalendarDate, parseYear } from '../entities/calendar.js';
import { isInvariantError } from '../entities/errors.js';
import type { Initiative } from '../entities/initiative.js';
import { anArea, anInitiative } from '../test-support/builders.js';
import { DEFAULT_DURATION_DAYS_BY_SIZE, SCHEDULE_DEFAULTS, type ScheduleConfig } from './config.js';
import { criticalPath, schedule } from './schedule.js';

/**
 * The behaviour around the arithmetic: what is scheduled and what is not, which
 * constraint gets the credit, what a bad configuration does, and the promise
 * that two runs of the same inputs are the same run.
 */

const YEAR = parseYear(2026);
/** A Monday. Every case below works all seven days unless it says otherwise. */
const MONDAY = new Date('2026-01-05T00:00:00Z');

const AREAS: readonly Area[] = [
  anArea({ key: 'alpha', name: 'Alpha' }),
  anArea({ key: 'beta', name: 'Beta' }),
];

const WEIGHTS: readonly AreaWeight[] = [
  { areaKey: 'alpha', year: YEAR, weightPct: 60 },
  { areaKey: 'beta', year: YEAR, weightPct: 40 },
];

function config(overrides: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return {
    ...SCHEDULE_DEFAULTS,
    workingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    concurrentInitiatives: 10,
    weights: WEIGHTS,
    weightYear: YEAR,
    ...overrides,
  };
}

function plan(initiatives: readonly Initiative[], overrides: Partial<ScheduleConfig> = {}) {
  return schedule(initiatives, AREAS, config(overrides), MONDAY);
}

function expectInvariant(run: () => unknown, code: string): Error {
  try {
    run();
    expect.unreachable('expected an InvariantError');
  } catch (error) {
    expect(isInvariantError(error)).toBe(true);
    if (isInvariantError(error)) {
      expect(error.code).toBe(code);
      return error;
    }
  }
  /* c8 ignore next -- unreachable: expect.unreachable already threw */
  throw new Error('unreachable');
}

describe('what gets scheduled', () => {
  it('schedules nothing, gracefully, when there is nothing to schedule', () => {
    const computed = plan([]);
    expect(computed.initiatives).toEqual([]);
    expect(computed.projectEnd).toBeUndefined();
    expect(computed.criticalPath).toEqual([]);
    expect(computed.minSlackDays).toBe(0);
  });

  it('excludes closed work, and does not let a finished predecessor hold anything back', () => {
    const computed = plan([
      anInitiative({ id: 'finished', status: 'done', doneAt: parseCalendarDate('2026-01-01') }),
      anInitiative({ id: 'abandoned', status: 'dropped', droppedReason: 'superseded' }),
      anInitiative({ id: 'waiting-on-it', size: 2, dependsOn: ['finished', 'abandoned'] }),
    ]);

    expect(computed.excluded).toEqual(['abandoned', 'finished']);
    expect(computed.byId.get('waiting-on-it')?.earliestStart).toBe('2026-01-05');
    expect(computed.byId.get('waiting-on-it')?.boundBy).toBe('none');
  });

  it('schedules inbox work rather than deciding, silently, that it does not count', () => {
    // Which initiatives to plan is a selection question, and selection has its
    // own module. Dropping `inbox` here would make that decision out of sight.
    const computed = plan([anInitiative({ id: 'unsorted', status: 'inbox', size: 1 })]);
    expect(computed.initiatives.map((entry) => entry.id)).toEqual(['unsorted']);
  });

  it('records a dependency it has never ingested, and does not pretend to plan around it', () => {
    const computed = plan([anInitiative({ id: 'orphan', size: 2, dependsOn: ['never-seen'] })]);

    expect(computed.danglingRefs).toEqual(['never-seen']);
    expect(computed.byId.get('orphan')?.earliestStart).toBe('2026-01-05');
    expect(computed.byId.get('orphan')?.boundBy).toBe('none');
  });

  it('refuses a cycle and names the path', () => {
    const error = expectInvariant(
      () =>
        plan([
          anInitiative({ id: 'a', dependsOn: ['c'] }),
          anInitiative({ id: 'b', dependsOn: ['a'] }),
          anInitiative({ id: 'c', dependsOn: ['b'] }),
        ]),
      'dependency_cycle',
    );
    expect(error.message).toContain('a → c → b → a');
  });

  it('refuses an initiative whose area is not in the area set', () => {
    expectInvariant(
      () => plan([anInitiative({ id: 'nowhere', areaKey: 'gamma' })]),
      'unknown_area',
    );
  });
});

describe('which constraint gets the credit', () => {
  it('says `none` when only the project start held it, and never starts before now', () => {
    const computed = plan([
      anInitiative({ id: 'yesterday', size: 1, earliestStart: parseCalendarDate('2025-12-01') }),
    ]);
    expect(computed.projectStart).toBe('2026-01-05');
    expect(computed.byId.get('yesterday')?.earliestStart).toBe('2026-01-05');
    expect(computed.byId.get('yesterday')?.boundBy).toBe('none');
  });

  it('says `earliest_start` when that is what pushed it out', () => {
    const entry = plan([
      anInitiative({ id: 'not-yet', size: 2, earliestStart: parseCalendarDate('2026-02-10') }),
    ]).byId.get('not-yet');

    expect(entry?.earliestStart).toBe('2026-02-10');
    expect(entry?.boundBy).toBe('earliest_start');
    expect(entry?.boundByIds).toEqual([]);
  });

  it('snaps an earliest start that lands on a non-working day forward', () => {
    const entry = plan(
      [anInitiative({ id: 'weekend', size: 1, earliestStart: parseCalendarDate('2026-02-07') })],
      { workingWeekdays: [1, 2, 3, 4, 5] },
    ).byId.get('weekend');

    expect(entry?.earliestStart).toBe('2026-02-09');
  });

  it('prefers the dependency when a dependency and an earliest start fall on the same day', () => {
    // Both are true; the dependency is the one whose movement propagates, so it
    // is the one worth drawing on a Timeline edge.
    const entry = plan([
      anInitiative({ id: 'first', size: 2 }),
      anInitiative({
        id: 'second',
        size: 1,
        dependsOn: ['first'],
        earliestStart: parseCalendarDate('2026-01-07'),
      }),
    ]).byId.get('second');

    expect(entry?.earliestStart).toBe('2026-01-07');
    expect(entry?.boundBy).toBe('dependency');
    expect(entry?.boundByIds).toEqual(['first']);
  });

  it('names every predecessor that finished on the binding day, not just one', () => {
    const entry = plan([
      anInitiative({ id: 'left', size: 3 }),
      anInitiative({ id: 'right', size: 3 }),
      anInitiative({ id: 'join', size: 1, dependsOn: ['right', 'left'] }),
    ]).byId.get('join');

    expect(entry?.boundBy).toBe('dependency');
    expect(entry?.boundByIds).toEqual(['left', 'right']);
  });
});

describe('capacity', () => {
  it('gives every area at least one slot, whatever its weight', () => {
    const computed = plan([anInitiative({ id: 'only' })], {
      weights: [{ areaKey: 'alpha', year: YEAR, weightPct: 1 }],
      concurrentInitiatives: 5,
    });
    expect(computed.config.slotsByArea.get('alpha')).toBe(1);
    expect(computed.config.slotsByArea.get('beta')).toBe(1);
  });

  it('carries last year’s weights forward and says so', () => {
    const computed = plan([anInitiative({ id: 'only' })], {
      weights: [{ areaKey: 'alpha', year: parseYear(2024), weightPct: 100 }],
      weightYear: YEAR,
    });
    expect(computed.config.weightsStale).toBe(true);
    expect(computed.config.weightSourceYear).toBe(2024);
  });

  it('does not delay work in an area that has room for it', () => {
    const computed = plan(
      [
        anInitiative({ id: 'one', areaKey: 'alpha', size: 2 }),
        anInitiative({ id: 'two', areaKey: 'alpha', size: 2 }),
      ],
      { concurrentInitiatives: 10 },
    );
    expect(computed.byId.get('two')?.earliestStart).toBe('2026-01-05');
    expect(computed.byId.get('two')?.boundBy).toBe('none');
  });

  it('keeps areas out of each other’s way', () => {
    const computed = plan(
      [
        anInitiative({ id: 'a-one', areaKey: 'alpha', size: 2 }),
        anInitiative({ id: 'a-two', areaKey: 'alpha', size: 2 }),
        anInitiative({ id: 'b-one', areaKey: 'beta', size: 2 }),
      ],
      { concurrentInitiatives: 1 },
    );

    expect(computed.byId.get('a-two')?.boundBy).toBe('capacity');
    // beta's single slot is beta's own: a full alpha does not delay it.
    expect(computed.byId.get('b-one')?.earliestStart).toBe('2026-01-05');
    expect(computed.byId.get('b-one')?.boundBy).toBe('none');
  });
});

describe('deadlines', () => {
  it('is feasible when the work finishes on the last working day before a weekend deadline', () => {
    const entry = plan(
      [
        anInitiative({
          id: 'friday',
          size: 5,
          earliestStart: parseCalendarDate('2026-02-02'),
          deadline: parseCalendarDate('2026-02-08'),
        }),
      ],
      { workingWeekdays: [1, 2, 3, 4, 5] },
    ).byId.get('friday');

    expect(entry?.earliestFinish).toBe('2026-02-06');
    expect(entry?.deadlineFeasible).toBe(true);
    expect(entry?.deadlineSlackDays).toBe(0);
  });

  it('reports no deadline as feasible, because there is nothing to miss', () => {
    const entry = plan([anInitiative({ id: 'open-ended', size: 1 })]).byId.get('open-ended');
    expect(entry?.deadlineFeasible).toBe(true);
    expect(entry?.deadlineSlackDays).toBeUndefined();
    expect(entry?.deadline).toBeUndefined();
  });
});

describe('configuration', () => {
  it('lets the duration table be replaced, which is the point of having one', () => {
    const entry = plan([anInitiative({ id: 'big', size: 8 })], {
      durationDaysBySize: { ...DEFAULT_DURATION_DAYS_BY_SIZE, 8: 20, 13: 40 },
    }).byId.get('big');

    expect(entry?.durationDays).toBe(20);
    expect(entry?.earliestFinish).toBe('2026-01-24');
  });

  it('refuses a duration that is not a whole number of days, or is under one', () => {
    expectInvariant(
      () => plan([], { durationDaysBySize: { ...DEFAULT_DURATION_DAYS_BY_SIZE, 3: 0 } }),
      'invalid_params',
    );
    expectInvariant(
      () => plan([], { durationDaysBySize: { ...DEFAULT_DURATION_DAYS_BY_SIZE, 3: 2.5 } }),
      'invalid_params',
    );
  });

  it('refuses a table where a bigger slice takes fewer days', () => {
    // Otherwise raising an estimate could pull a deadline earlier, and nobody
    // would believe the second plan.
    expectInvariant(
      () => plan([], { durationDaysBySize: { ...DEFAULT_DURATION_DAYS_BY_SIZE, 8: 4 } }),
      'invalid_params',
    );
  });

  it('refuses a parallelism that is not a whole number of initiatives', () => {
    expectInvariant(() => plan([], { concurrentInitiatives: 0 }), 'invalid_limits');
    expectInvariant(() => plan([], { concurrentInitiatives: 1.5 }), 'invalid_limits');
  });

  it('takes the weight year from `now` when it is not given', () => {
    const computed = schedule(
      [anInitiative({ id: 'only' })],
      AREAS,
      { ...SCHEDULE_DEFAULTS, weights: WEIGHTS },
      MONDAY,
    );
    expect(computed.config.weightYear).toBe(2026);
    expect(computed.config.weightsStale).toBe(false);
  });
});

describe('determinism', () => {
  const network: readonly Initiative[] = [
    anInitiative({ id: 'i-01', areaKey: 'alpha', size: 3 }),
    anInitiative({ id: 'i-02', areaKey: 'alpha', size: 5, dependsOn: ['i-01'] }),
    anInitiative({ id: 'i-03', areaKey: 'beta', size: 2, dependsOn: ['i-01'] }),
    anInitiative({ id: 'i-04', areaKey: 'beta', size: 8, dependsOn: ['i-02', 'i-03'] }),
    anInitiative({ id: 'i-05', areaKey: 'alpha', size: 1 }),
    anInitiative({
      id: 'i-06',
      areaKey: 'alpha',
      size: 2,
      deadline: parseCalendarDate('2026-01-08'),
    }),
  ];

  it('does not depend on the order the initiatives arrive in', () => {
    const forwards = plan(network, { concurrentInitiatives: 2 });
    const backwards = plan([...network].reverse(), { concurrentInitiatives: 2 });

    expect(backwards.initiatives).toEqual(forwards.initiatives);
    expect(backwards.criticalPath).toEqual(forwards.criticalPath);
    expect(backwards.infeasibleDeadlines).toEqual(forwards.infeasibleDeadlines);
    expect(backwards.minSlackDays).toBe(forwards.minSlackDays);
  });

  it('returns an identical schedule on a second run', () => {
    expect(plan(network).initiatives).toEqual(plan(network).initiatives);
  });

  it('sorts by earliest start, then by id', () => {
    const order = plan(network, { concurrentInitiatives: 2 }).initiatives.map((entry) => [
      entry.earliestStart,
      entry.id,
    ]);
    expect([...order].sort()).toEqual(order);
  });

  it('reads the critical path back off a computed schedule', () => {
    const computed = plan(network);
    expect(criticalPath(computed)).toEqual(computed.criticalPath);
  });
});
