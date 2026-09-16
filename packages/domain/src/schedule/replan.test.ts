import { describe, expect, it } from 'vitest';

import type { Area, AreaWeight } from '../entities/area.js';
import { parseCalendarDate, parseYear } from '../entities/calendar.js';
import { isInvariantError } from '../entities/errors.js';
import type { Initiative } from '../entities/initiative.js';
import { anArea, anInitiative } from '../test-support/builders.js';
import { replan } from './replan.js';
import { SCHEDULE_DEFAULTS, type ScheduleConfig } from './config.js';
import { schedule } from './schedule.js';

/**
 * Replanning. The brief asks for two things and they pull in opposite
 * directions: a move must propagate to every transitive dependent, and the diff
 * must be **exact**. Both are met the same way — by recomputing the schedule
 * and comparing, rather than by pushing dates forward from the move.
 */

const YEAR = parseYear(2026);
const MONDAY = new Date('2026-01-05T00:00:00Z');

const AREAS: readonly Area[] = [
  anArea({ key: 'alpha', name: 'Alpha' }),
  anArea({ key: 'beta', name: 'Beta' }),
];

const WEIGHTS: readonly AreaWeight[] = [
  { areaKey: 'alpha', year: YEAR, weightPct: 60 },
  { areaKey: 'beta', year: YEAR, weightPct: 40 },
];

function plan(initiatives: readonly Initiative[], overrides: Partial<ScheduleConfig> = {}) {
  const config: ScheduleConfig = {
    ...SCHEDULE_DEFAULTS,
    workingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    concurrentInitiatives: 10,
    weights: WEIGHTS,
    weightYear: YEAR,
    ...overrides,
  };
  return schedule(initiatives, AREAS, config, MONDAY);
}

const date = parseCalendarDate;

describe('propagation', () => {
  const chain: readonly Initiative[] = [
    anInitiative({ id: 'r-a', size: 3 }),
    anInitiative({ id: 'r-b', size: 2, dependsOn: ['r-a'] }),
    anInitiative({ id: 'r-c', size: 1, dependsOn: ['r-b'] }),
  ];

  it('moves every transitive dependent, and says by how much', () => {
    const before = plan(chain);
    expect(before.byId.get('r-c')?.earliestStart).toBe('2026-01-10');

    const diff = replan(before, { id: 'r-a', newStart: date('2026-01-12') });

    expect(diff.move).toEqual({
      id: 'r-a',
      requestedStart: '2026-01-12',
      actualStart: '2026-01-12',
      honoured: true,
      boundBy: 'earliest_start',
    });

    expect(diff.shifted).toEqual([
      {
        id: 'r-a',
        fromStart: '2026-01-05',
        toStart: '2026-01-12',
        fromEnd: '2026-01-07',
        toEnd: '2026-01-14',
        startDeltaDays: 7,
        endDeltaDays: 7,
        isDownstream: false,
      },
      {
        id: 'r-b',
        fromStart: '2026-01-08',
        toStart: '2026-01-15',
        fromEnd: '2026-01-09',
        toEnd: '2026-01-16',
        startDeltaDays: 7,
        endDeltaDays: 7,
        isDownstream: true,
      },
      {
        id: 'r-c',
        fromStart: '2026-01-10',
        toStart: '2026-01-17',
        fromEnd: '2026-01-10',
        toEnd: '2026-01-17',
        startDeltaDays: 7,
        endDeltaDays: 7,
        isDownstream: true,
      },
    ]);
  });

  it('reports nothing shifted when the move changes nothing', () => {
    const diff = replan(plan(chain), { id: 'r-a', newStart: date('2026-01-05') });
    expect(diff.shifted).toEqual([]);
    expect(diff.move.honoured).toBe(true);
    expect(diff.brokenDeadlines).toEqual([]);
    expect(diff.repairedDeadlines).toEqual([]);
  });

  it('leaves the original schedule untouched', () => {
    const before = plan(chain);
    const snapshot = structuredClone(before.initiatives);
    replan(before, { id: 'r-a', newStart: date('2026-02-02') });
    expect(before.initiatives).toEqual(snapshot);
  });
});

describe('a move is a request, not an instruction', () => {
  it('is refused by a dependency, and says which one', () => {
    const before = plan([
      anInitiative({ id: 'r-a', size: 3 }),
      anInitiative({ id: 'r-b', size: 2, dependsOn: ['r-a'] }),
    ]);

    const diff = replan(before, { id: 'r-b', newStart: date('2026-01-06') });

    expect(diff.move.honoured).toBe(false);
    expect(diff.move.actualStart).toBe('2026-01-08');
    expect(diff.move.boundBy).toBe('dependency');
    expect(diff.after.byId.get('r-b')?.boundByIds).toEqual(['r-a']);
    expect(diff.shifted).toEqual([]);
  });

  it('is refused by an area whose slot was taken before the move could claim it', () => {
    // `p-moved` waits on a gate in another area, so it is not schedulable at
    // all while `a-blocker` is being placed into alpha's single slot. Giving a
    // moved initiative first refusal only helps among the work that is ready at
    // the same moment — and the diff says so rather than granting a date the
    // plan cannot support.
    const before = plan(
      [
        anInitiative({ id: 'a-blocker', areaKey: 'alpha', size: 8 }),
        anInitiative({ id: 'q-gate', areaKey: 'beta', size: 1 }),
        anInitiative({ id: 'p-moved', areaKey: 'alpha', size: 2, dependsOn: ['q-gate'] }),
      ],
      { concurrentInitiatives: 1 },
    );

    expect(before.byId.get('p-moved')?.earliestStart).toBe('2026-01-13');
    expect(before.byId.get('p-moved')?.boundBy).toBe('capacity');

    const diff = replan(before, { id: 'p-moved', newStart: date('2026-01-06') });
    expect(diff.move.honoured).toBe(false);
    expect(diff.move.actualStart).toBe('2026-01-13');
    expect(diff.move.boundBy).toBe('capacity');
    expect(diff.shifted).toEqual([]);
  });

  it('cannot be moved into the past', () => {
    const diff = replan(plan([anInitiative({ id: 'only', size: 1 })]), {
      id: 'only',
      newStart: date('2025-11-01'),
    });
    expect(diff.move.honoured).toBe(false);
    expect(diff.move.actualStart).toBe('2026-01-05');
  });
});

describe('capacity neighbours', () => {
  it('reports work that moved only because the area’s slot changed hands', () => {
    // Not a dependent — nothing connects these two but the area they share.
    // A planner that showed only the dependency chain would hide half of what
    // the move actually cost.
    const before = plan(
      [
        anInitiative({ id: 'cap-x', areaKey: 'alpha', size: 2 }),
        anInitiative({ id: 'cap-y', areaKey: 'alpha', size: 2 }),
      ],
      { concurrentInitiatives: 1 },
    );

    expect(before.byId.get('cap-y')?.earliestStart).toBe('2026-01-07');

    const diff = replan(before, { id: 'cap-y', newStart: date('2026-01-05') });

    expect(diff.move.honoured).toBe(true);
    expect(
      diff.shifted.map((entry) => [entry.id, entry.startDeltaDays, entry.isDownstream]),
    ).toEqual([
      ['cap-y', -2, false],
      ['cap-x', 2, true],
    ]);
  });
});

describe('deadlines', () => {
  it('reports the deadline a move breaks', () => {
    const before = plan([
      anInitiative({ id: 'd-a', size: 3 }),
      anInitiative({
        id: 'd-b',
        size: 2,
        dependsOn: ['d-a'],
        deadline: date('2026-01-12'),
      }),
    ]);
    expect(before.infeasibleDeadlines).toEqual([]);

    const diff = replan(before, { id: 'd-a', newStart: date('2026-01-12') });

    expect(diff.brokenDeadlines).toEqual(['d-b']);
    expect(diff.repairedDeadlines).toEqual([]);
    expect(diff.after.byId.get('d-b')?.deadlineFeasible).toBe(false);
    expect(diff.after.byId.get('d-b')?.deadlineSlackDays).toBe(-4);
  });

  it('reports the deadline a move repairs', () => {
    const before = plan([
      anInitiative({ id: 'e-a', size: 3, earliestStart: date('2026-02-01') }),
      anInitiative({
        id: 'e-b',
        size: 2,
        dependsOn: ['e-a'],
        deadline: date('2026-02-01'),
      }),
    ]);
    expect(before.infeasibleDeadlines).toEqual(['e-b']);

    const diff = replan(before, { id: 'e-a', newStart: date('2026-01-05') });

    expect(diff.repairedDeadlines).toEqual(['e-b']);
    expect(diff.brokenDeadlines).toEqual([]);
  });

  it('never writes a deadline, in either direction', () => {
    const before = plan([
      anInitiative({ id: 'd-a', size: 3 }),
      anInitiative({ id: 'd-b', size: 2, dependsOn: ['d-a'], deadline: date('2026-01-12') }),
    ]);

    const diff = replan(before, { id: 'd-a', newStart: date('2026-01-12') });
    const after = diff.after.input.initiatives.find((initiative) => initiative.id === 'd-b');

    expect(after?.deadline).toBe('2026-01-12');
    expect(diff.after.byId.get('d-b')?.deadline).toBe('2026-01-12');
  });
});

describe('what cannot be replanned', () => {
  function expectInvariant(run: () => unknown, code: string): void {
    try {
      run();
      expect.unreachable('expected an InvariantError');
    } catch (error) {
      expect(isInvariantError(error)).toBe(true);
      if (isInvariantError(error)) expect(error.code).toBe(code);
    }
  }

  it('refuses an initiative the schedule was never built from', () => {
    const before = plan([anInitiative({ id: 'only', size: 1 })]);
    expectInvariant(
      () => replan(before, { id: 'someone-else', newStart: date('2026-01-06') }),
      'unknown_initiative',
    );
  });

  it('refuses closed work, which has no future dates to move', () => {
    const before = plan([
      anInitiative({ id: 'only', size: 1 }),
      anInitiative({ id: 'finished', status: 'done', doneAt: date('2026-01-01') }),
    ]);
    expectInvariant(
      () => replan(before, { id: 'finished', newStart: date('2026-01-06') }),
      'unknown_initiative',
    );
  });
});
