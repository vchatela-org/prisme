import { describe, expect, it } from 'vitest';
import {
  CAPACITY_WINDOW_DEFAULTS,
  computeCapacity,
  parseYear,
  type Area,
  type AreaKey,
  type AreaKind,
  type AreaWeight,
} from '@prisme/domain';

import { attribute } from './attribute.js';
import { locationKey } from '../reconcile/types.js';
import type { AttributedCompletion, StoredCompletion } from './types.js';
import { startOfWeek, weeklyCapacity } from './weeks.js';

/** All synthetic: invented areas, invented projects, invented durations. */

const AREAS: readonly Area[] = [
  { key: 'alpha', name: 'Alpha', kind: 'area', active: true },
  { key: 'beta', name: 'Beta', kind: 'area', active: true },
  { key: 'upkeep', name: 'Upkeep', kind: 'run', active: true },
  { key: 'noise', name: 'Noise', kind: 'signals', active: true },
];

const WEIGHTS: readonly AreaWeight[] = [
  { areaKey: 'alpha', year: parseYear(2026), weightPct: 60 },
  { areaKey: 'beta', year: parseYear(2026), weightPct: 40 },
];

function attributed(overrides: Partial<AttributedCompletion> = {}): AttributedCompletion {
  return {
    externalTaskId: 't-1',
    completedAt: new Date('2026-09-09T09:00:00Z'),
    areaKey: 'alpha',
    areaKind: 'area',
    lane: 'change',
    minutes: 30,
    source: 'default',
    ...overrides,
  };
}

describe('startOfWeek', () => {
  it('is the Monday, in UTC', () => {
    expect(startOfWeek(new Date('2026-09-09T23:30:00Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });

  /** getUTCDay puts Sunday at 0, so the naive offset sends it forward six days. */
  it('sends a Sunday back to the Monday before it, not forward', () => {
    expect(startOfWeek(new Date('2026-09-13T12:00:00Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });

  it('is already the answer for a Monday at midnight', () => {
    expect(startOfWeek(new Date('2026-09-07T00:00:00Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });
});

describe('weeklyCapacity', () => {
  it('groups by week and area, splitting minutes by where they came from', () => {
    const rows = weeklyCapacity([
      attributed({ minutes: 30, source: 'recorded' }),
      attributed({ externalTaskId: 't-2', minutes: 20, source: 'default' }),
      attributed({ externalTaskId: 't-3', areaKey: 'beta', minutes: 15, source: 'declared' }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      weekStart: '2026-09-07',
      areaKey: 'alpha',
      completions: 2,
      minutes: 50,
      minutesBySource: { recorded: 30, declared: 0, default: 20 },
    });
    expect(rows[1]?.minutesBySource).toEqual({ recorded: 0, declared: 15, default: 0 });
  });

  it('separates weeks that touch, so a Sunday and the Monday after it do not merge', () => {
    const rows = weeklyCapacity([
      attributed({ completedAt: new Date('2026-09-13T22:00:00Z') }),
      attributed({ externalTaskId: 't-2', completedAt: new Date('2026-09-14T02:00:00Z') }),
    ]);

    expect(rows.map((row) => row.weekStart)).toEqual(['2026-09-07', '2026-09-14']);
  });

  it('emits nothing for a week with no completions, rather than a zero row', () => {
    expect(weeklyCapacity([])).toEqual([]);
  });

  it('is ordered by week then area, and not by the order the tool answered in', () => {
    const rows = weeklyCapacity([
      attributed({ areaKey: 'beta', completedAt: new Date('2026-09-16T09:00:00Z') }),
      attributed({ areaKey: 'beta' }),
      attributed({ areaKey: 'alpha' }),
    ]);

    expect(rows.map((row) => `${row.weekStart}/${row.areaKey}`)).toEqual([
      '2026-09-07/alpha',
      '2026-09-07/beta',
      '2026-09-14/beta',
    ]);
  });
});

/**
 * The definition of done's load-bearing assertion: **materialised rows match an
 * on-the-fly computation over the same window.**
 *
 * The two paths are genuinely different code — `computeCapacity` in
 * `@prisme/domain` walks completions and produces shares, `attribute` plus
 * `weeklyCapacity` walk the same completions and produce stored rows — and they
 * have to agree, because the dashboard reads one and the balance factor uses
 * the other. The window is chosen to start on a Monday so four weeks is exactly
 * four buckets; anything else would be comparing different questions.
 */
describe('a materialised window against computeCapacity', () => {
  const NOW = new Date('2026-10-05T00:00:00Z'); // a Monday
  const WINDOW_WEEKS = 4;
  const DEFAULT_MINUTES = 25;

  const stored: readonly StoredCompletion[] = [
    // Inside the window, spread across its four weeks and three areas.
    {
      externalTaskId: 'a1',
      completedAt: new Date('2026-09-08T09:00:00Z'),
      externalProjectId: 'p-alpha',
      recordedMinutes: 60,
      durationScale: 'minute',
    },
    {
      externalTaskId: 'a2',
      completedAt: new Date('2026-09-15T09:00:00Z'),
      externalProjectId: 'p-alpha',
    },
    {
      externalTaskId: 'a3',
      completedAt: new Date('2026-09-22T09:00:00Z'),
      externalProjectId: 'p-alpha',
      recordedMinutes: 45,
      durationScale: 'minute',
    },
    {
      externalTaskId: 'b1',
      completedAt: new Date('2026-09-29T09:00:00Z'),
      externalProjectId: 'p-beta',
      recordedMinutes: 30,
      durationScale: 'minute',
    },
    {
      externalTaskId: 'u1',
      completedAt: new Date('2026-09-30T09:00:00Z'),
      externalProjectId: 'p-upkeep',
      recordedMinutes: 120,
      durationScale: 'minute',
    },
    {
      externalTaskId: 'n1',
      completedAt: new Date('2026-10-01T09:00:00Z'),
      externalProjectId: 'p-noise',
      recordedMinutes: 999,
      durationScale: 'minute',
    },
    // A day-scale duration, which neither path may convert.
    {
      externalTaskId: 'b2',
      completedAt: new Date('2026-10-02T09:00:00Z'),
      externalProjectId: 'p-beta',
      durationScale: 'day',
    },
    // Outside the window on both sides.
    {
      externalTaskId: 'old',
      completedAt: new Date('2026-08-01T09:00:00Z'),
      externalProjectId: 'p-alpha',
      recordedMinutes: 600,
      durationScale: 'minute',
    },
  ];

  const result = attribute(stored, {
    areaByLocation: new Map<string, AreaKey>([
      [locationKey('p-alpha'), 'alpha'],
      [locationKey('p-beta'), 'beta'],
      [locationKey('p-upkeep'), 'upkeep'],
      [locationKey('p-noise'), 'noise'],
    ]),
    kindByArea: new Map<AreaKey, AreaKind>(AREAS.map((area) => [area.key, area.kind])),
    ritualByTask: new Map(),
    declaredMinutesByTask: new Map(),
    defaultMinutes: DEFAULT_MINUTES,
  });

  const rows = weeklyCapacity(result.attributed);

  const onTheFly = computeCapacity(
    result.attributed.map((completion) => ({
      id: `${completion.externalTaskId}@${completion.completedAt.toISOString()}`,
      areaKey: completion.areaKey,
      completedAt: completion.completedAt,
      // The source of truth for the minutes is the attribution step, so the
      // comparison is of the two aggregations rather than of two guesses at a
      // duration. A Signals completion carries 0, which computeCapacity
      // discards anyway.
      recordedMinutes: completion.minutes,
    })),
    AREAS,
    {
      ...CAPACITY_WINDOW_DEFAULTS,
      weeks: WINDOW_WEEKS,
      defaultMinutes: DEFAULT_MINUTES,
      weights: WEIGHTS,
    },
    NOW,
  );

  const windowStart = new Date(NOW.getTime() - WINDOW_WEEKS * 7 * 86_400_000);
  const inWindow = rows.filter((row) => new Date(`${row.weekStart}T00:00:00Z`) >= windowStart);

  it('agrees on minutes per area', () => {
    for (const area of AREAS) {
      const materialised = inWindow
        .filter((row) => row.areaKey === area.key)
        .reduce((sum, row) => sum + row.minutes, 0);
      const computed = onTheFly.find((entry) => entry.areaKey === area.key)?.minutes ?? 0;

      expect(materialised, `minutes for ${area.key}`).toBe(computed);
    }
  });

  it('agrees on completion counts per area', () => {
    for (const area of AREAS) {
      const materialised = inWindow
        .filter((row) => row.areaKey === area.key)
        .reduce((sum, row) => sum + row.completions, 0);
      const computed = onTheFly.find((entry) => entry.areaKey === area.key)?.completions ?? 0;

      expect(materialised, `completions for ${area.key}`).toBe(computed);
    }
  });

  it('excludes Signals from minutes on both paths and keeps them as volume', () => {
    const noise = onTheFly.find((entry) => entry.areaKey === 'noise');

    expect(noise?.minutes).toBe(0);
    expect(noise?.completions).toBe(1);
    expect(inWindow.find((row) => row.areaKey === 'noise')?.minutes).toBe(0);
  });

  /**
   * The materialised table is deliberately wider than any one window: it holds
   * every week that was backfilled, and a four-week question narrows it. The
   * older completion is therefore present as a row and absent from the
   * comparison — if it were missing from the table, the KPI trend would start
   * at the balance factor's horizon rather than at the history's.
   */
  it('keeps the week before the window as a row, and out of the window total', () => {
    expect(rows.some((row) => row.weekStart === '2026-07-27')).toBe(true);
    expect(inWindow.some((row) => row.weekStart === '2026-07-27')).toBe(false);
    expect(rows.length).toBeGreaterThan(inWindow.length);
  });
});
