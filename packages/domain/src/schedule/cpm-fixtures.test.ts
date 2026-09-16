import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Area, AreaWeight } from '../entities/area.js';
import { type CalendarDate, parseCalendarDate, parseYear } from '../entities/calendar.js';
import type { Fibonacci } from '../entities/fibonacci.js';
import type { Initiative } from '../entities/initiative.js';
import { SCHEDULE_DEFAULTS, type ScheduleConfig } from './config.js';
import { schedule } from './schedule.js';
import type { BoundBy } from './types.js';

/**
 * The four networks in `fixtures/schedule/cpm-cases.json`, checked against
 * results that were **computed by hand from the network**, not read back from
 * this implementation.
 *
 * That is the whole value of the file. A golden file recorded from the code
 * under test proves only that the code has not changed; it cannot tell you the
 * code was ever right. Classic CPM has textbook answers, so here they are
 * written down independently — including the two cases that are not textbook at
 * all: an area whose weight will not let it run four things at once, and a
 * deadline that cannot be met.
 *
 * Fixture data only, as everywhere (docs/17-privacy.md).
 */

interface FixtureInitiative {
  readonly id: string;
  readonly title: string;
  readonly areaKey: string;
  readonly size: Fibonacci;
  readonly dependsOn: readonly string[];
  readonly deadline?: string;
  readonly earliestStart?: string;
}

interface FixtureExpectedInitiative {
  readonly id: string;
  readonly earliestStart: string;
  readonly earliestFinish: string;
  readonly latestStart: string;
  readonly latestFinish: string;
  readonly slackDays: number;
  readonly onCriticalPath: boolean;
  readonly boundBy: BoundBy;
  readonly boundByIds: readonly string[];
  readonly deadlineFeasible?: boolean;
  readonly deadlineSlackDays?: number;
}

interface FixtureCase {
  readonly name: string;
  readonly why: string;
  readonly now: string;
  readonly weightYear: number;
  readonly config: {
    readonly workingWeekdays: readonly number[];
    readonly holidays: readonly string[];
    readonly concurrentInitiatives: number;
  };
  readonly areas: readonly {
    readonly key: string;
    readonly name: string;
    readonly kind: 'area';
    readonly weightPct: number;
  }[];
  readonly expectedSlots?: Readonly<Record<string, number>>;
  readonly initiatives: readonly FixtureInitiative[];
  readonly expected: {
    readonly projectStart: string;
    readonly projectEnd: string;
    readonly minSlackDays: number;
    readonly criticalPath: readonly string[];
    readonly infeasibleDeadlines: readonly string[];
    readonly initiatives: readonly FixtureExpectedInitiative[];
  };
}

const cases = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../../fixtures/schedule/cpm-cases.json', import.meta.url)),
      'utf8',
    ),
  ) as { readonly cases: readonly FixtureCase[] }
).cases;

/**
 * Scoring inputs play no part in scheduling. Fixing them at one value keeps the
 * fixture about the thing it is testing, and any value would do.
 */
const IRRELEVANT_TO_SCHEDULING = { value: 3, timeCriticality: 3, risk: 3 } as const;

function toInitiative(row: FixtureInitiative): Initiative {
  return {
    id: row.id,
    title: row.title,
    areaKey: row.areaKey,
    status: 'next',
    ...IRRELEVANT_TO_SCHEDULING,
    size: row.size,
    ...(row.deadline === undefined ? {} : { deadline: parseCalendarDate(row.deadline) }),
    ...(row.earliestStart === undefined
      ? {}
      : { earliestStart: parseCalendarDate(row.earliestStart) }),
    dependsOn: row.dependsOn,
    origin: 'created_in_prisme',
  };
}

function toAreas(testCase: FixtureCase): readonly Area[] {
  return testCase.areas.map((area) => ({
    key: area.key,
    name: area.name,
    kind: area.kind,
    active: true,
  }));
}

function toConfig(testCase: FixtureCase): ScheduleConfig {
  const year = parseYear(testCase.weightYear);
  const weights: readonly AreaWeight[] = testCase.areas.map((area) => ({
    areaKey: area.key,
    year,
    weightPct: area.weightPct,
  }));

  return {
    ...SCHEDULE_DEFAULTS,
    workingWeekdays: testCase.config.workingWeekdays,
    holidays: testCase.config.holidays.map((day) => parseCalendarDate(day)),
    concurrentInitiatives: testCase.config.concurrentInitiatives,
    weights,
    weightYear: year,
  };
}

describe.each(cases)('$name', (testCase) => {
  const computed = schedule(
    testCase.initiatives.map(toInitiative),
    toAreas(testCase),
    toConfig(testCase),
    new Date(testCase.now),
  );

  it(testCase.why, () => {
    expect(computed.projectStart).toBe(testCase.expected.projectStart);
    expect(computed.projectEnd).toBe(testCase.expected.projectEnd);
  });

  it('reproduces the hand-computed forward and backward passes', () => {
    const actual = testCase.expected.initiatives.map((row) => {
      const entry = computed.byId.get(row.id);
      expect(entry, `${row.id} was not scheduled`).toBeDefined();
      return {
        id: entry?.id,
        earliestStart: entry?.earliestStart,
        earliestFinish: entry?.earliestFinish,
        latestStart: entry?.latestStart,
        latestFinish: entry?.latestFinish,
        slackDays: entry?.slackDays,
        onCriticalPath: entry?.onCriticalPath,
        boundBy: entry?.boundBy,
        boundByIds: entry?.boundByIds,
        deadlineFeasible: entry?.deadlineFeasible,
        deadlineSlackDays: entry?.deadlineSlackDays,
      };
    });

    expect(actual).toEqual(
      testCase.expected.initiatives.map((row) => ({
        id: row.id,
        earliestStart: row.earliestStart,
        earliestFinish: row.earliestFinish,
        latestStart: row.latestStart,
        latestFinish: row.latestFinish,
        slackDays: row.slackDays,
        onCriticalPath: row.onCriticalPath,
        boundBy: row.boundBy,
        boundByIds: row.boundByIds,
        deadlineFeasible: row.deadlineFeasible ?? true,
        deadlineSlackDays: row.deadlineSlackDays,
      })),
    );
  });

  it('finds the critical path and the minimum slack', () => {
    expect(computed.criticalPath).toEqual(testCase.expected.criticalPath);
    expect(computed.minSlackDays).toBe(testCase.expected.minSlackDays);
  });

  it('flags every deadline it cannot meet, and moves none of them', () => {
    expect(computed.infeasibleDeadlines).toEqual(testCase.expected.infeasibleDeadlines);

    // The deadline a plan cannot meet is still the deadline it was given.
    for (const row of testCase.initiatives) {
      if (row.deadline === undefined) continue;
      const original = computed.input.initiatives.find((initiative) => initiative.id === row.id);
      expect(original?.deadline).toBe(row.deadline as CalendarDate);
      expect(computed.byId.get(row.id)?.deadline).toBe(row.deadline as CalendarDate);
    }
  });

  it('plans every open initiative and writes planned dates equal to the earliest ones', () => {
    expect(computed.initiatives).toHaveLength(testCase.initiatives.length);
    for (const entry of computed.initiatives) {
      expect(entry.plannedStart).toBe(entry.earliestStart);
      expect(entry.plannedEnd).toBe(entry.earliestFinish);
    }
  });

  if (testCase.expectedSlots) {
    const expectedSlots = testCase.expectedSlots;
    it('derives each area’s concurrent slots from that year’s weight', () => {
      for (const [areaKey, slots] of Object.entries(expectedSlots)) {
        expect(computed.config.slotsByArea.get(areaKey)).toBe(slots);
      }
    });
  }
});
