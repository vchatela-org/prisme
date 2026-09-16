import { describe, expect, it } from 'vitest';

import type { Area, AreaWeight } from '../entities/area.js';
import { dayNumberOfDate, parseCalendarDate, parseYear } from '../entities/calendar.js';
import { FIBONACCI_SCALE } from '../entities/fibonacci.js';
import type { Initiative } from '../entities/initiative.js';
import { anArea, anInitiative } from '../test-support/builders.js';
import { SCHEDULE_DEFAULTS, type ScheduleConfig } from './config.js';
import { replan } from './replan.js';
import { schedule } from './schedule.js';
import type { Schedule } from './types.js';
import { isWorkingDay, workingDaysBetween } from './working-days.js';

/**
 * Properties that must hold of **every** schedule, checked over a family of
 * networks rather than one example.
 *
 * The family is built systematically, not randomly: four dependency shapes
 * crossed with three concurrency settings and two working weeks, with sizes and
 * areas cycling through their own closed sets. That follows the decision W01
 * took for the scoring properties — a walk over a constructed space proves the
 * property outright where a generator only makes it probable, and it runs
 * identically every time. `fast-check` is still not a dependency of this
 * package.
 */

const YEAR = parseYear(2026);
const MONDAY = new Date('2026-01-05T00:00:00Z');

const AREA_KEYS = ['alpha', 'beta', 'gamma'] as const;

const AREAS: readonly Area[] = AREA_KEYS.map((key) => anArea({ key, name: key }));

const WEIGHTS: readonly AreaWeight[] = [
  { areaKey: 'alpha', year: YEAR, weightPct: 50 },
  { areaKey: 'beta', year: YEAR, weightPct: 35 },
  { areaKey: 'gamma', year: YEAR, weightPct: 15 },
];

/** How initiative `n` depends on the ones before it. */
const SHAPES = {
  independent: () => [],
  chain: (n: number) => (n === 0 ? [] : [id(n - 1)]),
  diamond: (n: number) => (n < 2 ? [] : n % 2 === 0 ? [id(n - 2)] : [id(n - 2), id(n - 1)]),
  fanIn: (n: number) => (n < 6 ? [] : [id(n - 6), id(n - 5), id(n - 4)]),
} as const;

const COUNT = 12;

function id(index: number): string {
  return `n-${String(index).padStart(2, '0')}`;
}

function network(shape: keyof typeof SHAPES): readonly Initiative[] {
  return Array.from({ length: COUNT }, (_unused, index) =>
    anInitiative({
      id: id(index),
      areaKey: AREA_KEYS[index % AREA_KEYS.length],
      size: FIBONACCI_SCALE[index % FIBONACCI_SCALE.length],
      dependsOn: SHAPES[shape](index),
      // Every fourth initiative carries a deadline, half of them impossible.
      ...(index % 4 === 0
        ? { deadline: parseCalendarDate(index % 8 === 0 ? '2026-01-09' : '2026-06-30') }
        : {}),
    }),
  );
}

interface Scenario {
  readonly name: string;
  readonly initiatives: readonly Initiative[];
  readonly config: ScheduleConfig;
  readonly computed: Schedule;
}

const scenarios: readonly Scenario[] = (Object.keys(SHAPES) as (keyof typeof SHAPES)[]).flatMap(
  (shape) =>
    [1, 2, 5].flatMap((concurrentInitiatives) =>
      (
        [
          ['seven-day week', [0, 1, 2, 3, 4, 5, 6]],
          ['Monday to Friday', [1, 2, 3, 4, 5]],
        ] as const
      ).map(([week, workingWeekdays]): Scenario => {
        const initiatives = network(shape);
        const config: ScheduleConfig = {
          ...SCHEDULE_DEFAULTS,
          workingWeekdays,
          holidays: [parseCalendarDate('2026-01-19'), parseCalendarDate('2026-02-16')],
          concurrentInitiatives,
          weights: WEIGHTS,
          weightYear: YEAR,
        };
        return {
          name: `${shape}, ${String(concurrentInitiatives)} in flight, ${week}`,
          initiatives,
          config,
          computed: schedule(initiatives, AREAS, config, MONDAY),
        };
      }),
    ),
);

describe.each(scenarios)('$name', ({ initiatives, config, computed }) => {
  const calendar = computed.config.calendar;
  const day = (iso: string) => dayNumberOfDate(parseCalendarDate(iso));

  it('places every date on a working day, on or after the project start', () => {
    for (const entry of computed.initiatives) {
      for (const date of [
        entry.earliestStart,
        entry.earliestFinish,
        entry.latestStart,
        entry.latestFinish,
      ]) {
        expect(isWorkingDay(day(date), calendar), `${entry.id} ${date}`).toBe(true);
      }
      expect(day(entry.earliestStart)).toBeGreaterThanOrEqual(day(computed.projectStart));
    }
  });

  it('gives every span exactly its duration in working days', () => {
    for (const entry of computed.initiatives) {
      expect(
        workingDaysBetween(day(entry.earliestStart), day(entry.earliestFinish), calendar),
      ).toBe(entry.durationDays - 1);
      expect(workingDaysBetween(day(entry.latestStart), day(entry.latestFinish), calendar)).toBe(
        entry.durationDays - 1,
      );
    }
  });

  it('starts nothing until everything it depends on has finished', () => {
    for (const initiative of initiatives) {
      const entry = computed.byId.get(initiative.id);
      /* c8 ignore next -- every initiative in these networks is open */
      if (!entry) continue;
      for (const dependency of initiative.dependsOn) {
        const predecessor = computed.byId.get(dependency);
        /* c8 ignore next -- these networks have no dangling references */
        if (!predecessor) continue;
        expect(day(entry.earliestStart)).toBeGreaterThan(day(predecessor.earliestFinish));
      }
    }
  });

  it('never runs an area over its slots on any day', () => {
    const slots = computed.config.slotsByArea;
    const occupancy = new Map<string, number>();

    for (const entry of computed.initiatives) {
      for (let at = day(entry.earliestStart); at <= day(entry.earliestFinish); at++) {
        if (!isWorkingDay(at, calendar)) continue;
        const key = `${entry.areaKey}:${String(at)}`;
        occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
      }
    }

    for (const [key, count] of occupancy) {
      const areaKey = key.slice(0, key.lastIndexOf(':'));
      expect(count, key).toBeLessThanOrEqual(slots.get(areaKey) ?? 1);
    }
  });

  it('defines slack as the working days between the earliest and latest finish', () => {
    for (const entry of computed.initiatives) {
      expect(entry.slackDays).toBe(
        workingDaysBetween(day(entry.earliestFinish), day(entry.latestFinish), calendar),
      );
    }
  });

  it('marks exactly the minimum-slack work as critical', () => {
    const slacks = computed.initiatives.map((entry) => entry.slackDays);
    expect(computed.minSlackDays).toBe(Math.min(...slacks));
    for (const entry of computed.initiatives) {
      expect(entry.onCriticalPath).toBe(entry.slackDays === computed.minSlackDays);
    }
  });

  it('returns a critical path that is a real chain of minimum-slack work', () => {
    expect(computed.criticalPath.length).toBeGreaterThan(0);

    let previous: string | undefined;
    for (const member of computed.criticalPath) {
      const entry = computed.byId.get(member);
      expect(entry?.onCriticalPath).toBe(true);
      if (previous !== undefined) {
        const initiative = initiatives.find((candidate) => candidate.id === member);
        expect(initiative?.dependsOn).toContain(previous);
      }
      previous = member;
    }
  });

  it('flags a deadline if and only if the plan misses it, and moves none of them', () => {
    const missed: string[] = [];
    for (const initiative of initiatives) {
      const entry = computed.byId.get(initiative.id);
      /* c8 ignore next -- every initiative in these networks is open */
      if (!entry) continue;

      expect(entry.deadline).toBe(initiative.deadline);
      if (initiative.deadline === undefined) {
        expect(entry.deadlineFeasible).toBe(true);
        continue;
      }
      const met = day(entry.earliestFinish) <= day(initiative.deadline);
      expect(entry.deadlineFeasible).toBe(met);
      if (!met) missed.push(initiative.id);
    }
    expect(computed.infeasibleDeadlines).toEqual(missed.sort());
  });

  it('is the same schedule whichever order the initiatives arrive in', () => {
    const reversed = schedule([...initiatives].reverse(), AREAS, config, MONDAY);
    expect(reversed.initiatives).toEqual(computed.initiatives);
    expect(reversed.criticalPath).toEqual(computed.criticalPath);
  });

  it('treats a replan onto the day it already starts as a no-op', () => {
    for (const entry of computed.initiatives) {
      const diff = replan(computed, { id: entry.id, newStart: entry.earliestStart });
      expect(diff.shifted, entry.id).toEqual([]);
      expect(diff.move.honoured, entry.id).toBe(true);
      expect(diff.brokenDeadlines, entry.id).toEqual([]);
    }
  });
});
