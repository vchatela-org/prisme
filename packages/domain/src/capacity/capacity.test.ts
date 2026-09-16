import { describe, expect, it } from 'vitest';

import type { Area, AreaWeight } from '../entities/area.js';
import { parseYear } from '../entities/calendar.js';
import { anArea } from '../test-support/builders.js';
import {
  CAPACITY_WINDOW_DEFAULTS,
  computeCapacity,
  toScoringContexts,
  type CapacityWindow,
  type Completion,
} from './index.js';

/**
 * Capacity measurement (docs/12-scoring.md §4).
 *
 * All synthetic: four invented areas plus the two lanes, with invented
 * durations. Nothing here resembles any real configuration.
 */

const NOW = new Date('2026-09-15T12:00:00Z');

const AREAS: readonly Area[] = [
  anArea({ key: 'alpha', name: 'Alpha' }),
  anArea({ key: 'beta', name: 'Beta' }),
  anArea({ key: 'gamma', name: 'Gamma' }),
  anArea({ key: 'delta', name: 'Delta', active: false }),
  anArea({ key: 'upkeep', name: 'Upkeep', kind: 'run', runBudgetHoursPerWeek: 3 }),
  anArea({ key: 'noise', name: 'Noise', kind: 'signals' }),
];

const WEIGHTS: readonly AreaWeight[] = [
  { areaKey: 'alpha', year: parseYear(2026), weightPct: 50 },
  { areaKey: 'beta', year: parseYear(2026), weightPct: 25 },
  { areaKey: 'gamma', year: parseYear(2026), weightPct: 25 },
];

function window(overrides: Partial<CapacityWindow> = {}): CapacityWindow {
  return { ...CAPACITY_WINDOW_DEFAULTS, weights: WEIGHTS, ...overrides };
}

function completion(
  overrides: Partial<Completion> & Pick<Completion, 'id' | 'areaKey'>,
): Completion {
  return { completedAt: new Date('2026-09-10T09:00:00Z'), ...overrides };
}

function byKey(capacity: readonly { readonly areaKey: string }[], key: string) {
  const found = capacity.find((entry) => entry.areaKey === key);
  if (!found) throw new Error(`no capacity row for ${key}`);
  return found;
}

describe('the duration preference order', () => {
  it('uses a recorded duration when there is one', () => {
    const capacity = computeCapacity(
      [completion({ id: '1', areaKey: 'alpha', recordedMinutes: 90, declaredMinutes: 20 })],
      AREAS,
      window(),
      NOW,
    );
    const alpha = byKey(capacity, 'alpha');
    expect(alpha.minutes).toBe(90);
    expect(alpha.minutesBySource).toEqual({ recorded: 90, declared: 0, default: 0 });
  });

  it('falls back to the declared duration of the matching process page', () => {
    const capacity = computeCapacity(
      [completion({ id: '1', areaKey: 'alpha', declaredMinutes: 20 })],
      AREAS,
      window(),
      NOW,
    );
    expect(byKey(capacity, 'alpha').minutesBySource).toEqual({
      recorded: 0,
      declared: 20,
      default: 0,
    });
  });

  it('falls back to the configured default, which is configuration and not a constant', () => {
    const capacity = computeCapacity(
      [completion({ id: '1', areaKey: 'alpha' })],
      AREAS,
      window({ defaultMinutes: 45 }),
      NOW,
    );
    expect(byKey(capacity, 'alpha').minutes).toBe(45);
  });
});

describe('the rolling window', () => {
  it('counts four weeks back and nothing older', () => {
    const capacity = computeCapacity(
      [
        completion({
          id: 'inside',
          areaKey: 'alpha',
          completedAt: new Date('2026-08-20T09:00:00Z'),
          recordedMinutes: 60,
        }),
        completion({
          id: 'outside',
          areaKey: 'alpha',
          completedAt: new Date('2026-08-01T09:00:00Z'),
          recordedMinutes: 600,
        }),
      ],
      AREAS,
      window(),
      NOW,
    );
    expect(byKey(capacity, 'alpha').minutes).toBe(60);
  });

  it('ignores work completed after the moment being asked about', () => {
    const capacity = computeCapacity(
      [
        completion({
          id: 'future',
          areaKey: 'alpha',
          completedAt: new Date('2026-09-20T09:00:00Z'),
          recordedMinutes: 60,
        }),
      ],
      AREAS,
      window(),
      NOW,
    );
    expect(byKey(capacity, 'alpha').minutes).toBe(0);
  });

  it('is half-open, so two consecutive windows never count the same completion twice', () => {
    const onTheBoundary = new Date(NOW.getTime() - 28 * 86_400_000);
    const capacity = computeCapacity(
      [
        completion({
          id: 'edge',
          areaKey: 'alpha',
          completedAt: onTheBoundary,
          recordedMinutes: 60,
        }),
      ],
      AREAS,
      window(),
      NOW,
    );
    expect(byKey(capacity, 'alpha').minutes).toBe(0);
  });

  it('refuses a window with no width', () => {
    expect(() => computeCapacity([], AREAS, window({ weeks: 0 }), NOW)).toThrow(
      /at least one week/,
    );
  });
});

describe('lanes (ADR-0014)', () => {
  const completions: readonly Completion[] = [
    completion({ id: '1', areaKey: 'alpha', recordedMinutes: 60 }),
    completion({ id: '2', areaKey: 'upkeep', recordedMinutes: 120 }),
    completion({ id: '3', areaKey: 'noise', recordedMinutes: 999 }),
    completion({ id: '4', areaKey: 'noise', recordedMinutes: 999 }),
  ];

  it('counts Run toward capacity, because that is the pattern worth seeing', () => {
    const capacity = computeCapacity(completions, AREAS, window(), NOW);
    const upkeep = byKey(capacity, 'upkeep');
    expect(upkeep.minutes).toBe(120);
    expect(upkeep.actualSharePct).toBeCloseTo((120 / 180) * 100, 10);
  });

  it('counts Signals as volume and nothing else', () => {
    const capacity = computeCapacity(completions, AREAS, window(), NOW);
    const noise = byKey(capacity, 'noise');
    expect(noise.completions).toBe(2);
    expect(noise.minutes).toBe(0);
    expect(noise.countsTowardCapacity).toBe(false);
  });

  it('reports Run against its hours-per-week budget, not against a share', () => {
    const capacity = computeCapacity(completions, AREAS, window(), NOW);
    const upkeep = byKey(capacity, 'upkeep');
    expect(upkeep.runHoursPerWeek).toBeCloseTo(0.5, 10);
    expect(upkeep.runBudgetHoursPerWeek).toBe(3);
  });

  it('gives no lane a balance factor to be ranked by', () => {
    const capacity = computeCapacity(completions, AREAS, window(), NOW);
    expect(byKey(capacity, 'upkeep').targetSharePct).toBeUndefined();
    expect(byKey(capacity, 'upkeep').balanceFactor).toBe(1);
  });

  it('keeps lanes out of the scoring contexts entirely', () => {
    const capacity = computeCapacity(completions, AREAS, window(), NOW);
    expect(toScoringContexts(capacity, AREAS).map((context) => context.key)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });
});

describe('the balance factor', () => {
  it('lifts a starved area and damps an over-served one', () => {
    // alpha targets 50% and got 25%; beta targets 25% and got 50%.
    const capacity = computeCapacity(
      [
        completion({ id: '1', areaKey: 'alpha', recordedMinutes: 60 }),
        completion({ id: '2', areaKey: 'beta', recordedMinutes: 120 }),
        completion({ id: '3', areaKey: 'gamma', recordedMinutes: 60 }),
      ],
      AREAS,
      window(),
      NOW,
    );

    expect(byKey(capacity, 'alpha').balanceFactor).toBe(2);
    expect(byKey(capacity, 'beta').balanceFactor).toBe(0.5);
    expect(byKey(capacity, 'gamma').balanceFactor).toBe(1);
  });

  it('never leaves the clamp, including with nothing observed at all', () => {
    const capacity = computeCapacity([], AREAS, window(), NOW);
    for (const entry of capacity) {
      expect(entry.balanceFactor).toBeGreaterThanOrEqual(0.5);
      expect(entry.balanceFactor).toBeLessThanOrEqual(2);
    }
    // A target share with no observed work is the most starved an area can be.
    expect(byKey(capacity, 'alpha').balanceFactor).toBe(2);
  });

  it('does not lift an area that was deliberately allocated nothing', () => {
    const capacity = computeCapacity(
      [completion({ id: '1', areaKey: 'beta', recordedMinutes: 60 })],
      AREAS,
      window({
        weights: [
          { areaKey: 'alpha', year: parseYear(2026), weightPct: 0 },
          { areaKey: 'beta', year: parseYear(2026), weightPct: 100 },
        ],
      }),
      NOW,
    );
    expect(byKey(capacity, 'alpha').balanceFactor).toBe(0.5);
  });

  it('honours a clamp that is not the shipped one', () => {
    const capacity = computeCapacity([], AREAS, window({ balanceClamp: [0.8, 1.25] }), NOW);
    expect(byKey(capacity, 'alpha').balanceFactor).toBe(1.25);
  });
});

describe('the year gate (ADR-0007)', () => {
  it('measures against the weights in force for the year being asked about', () => {
    const capacity = computeCapacity([], AREAS, window(), NOW);
    expect(byKey(capacity, 'alpha').targetSharePct).toBe(50);
    expect(byKey(capacity, 'alpha').stale).toBe(false);
  });

  it('carries weights forward but marks every factor stale', () => {
    const nextYear = new Date('2027-03-01T00:00:00Z');
    const capacity = computeCapacity([], AREAS, window(), nextYear);
    expect(byKey(capacity, 'alpha').targetSharePct).toBe(50);
    expect(capacity.every((entry) => entry.stale)).toBe(true);
  });

  it('marks an area with no weight at all as stale', () => {
    const capacity = computeCapacity(
      [],
      AREAS,
      window({ weights: [{ areaKey: 'alpha', year: parseYear(2026), weightPct: 100 }] }),
      NOW,
    );
    expect(byKey(capacity, 'beta').targetSharePct).toBeUndefined();
    expect(byKey(capacity, 'beta').stale).toBe(true);
    expect(byKey(capacity, 'alpha').stale).toBe(false);
  });

  it('gives an archived area no target to be balanced against', () => {
    const capacity = computeCapacity([], AREAS, window(), NOW);
    expect(byKey(capacity, 'delta').targetSharePct).toBeUndefined();
  });
});

describe('capacity is deterministic and refuses to guess', () => {
  it('returns areas in a fixed order regardless of input order', () => {
    const forwards = computeCapacity([], AREAS, window(), NOW).map((entry) => entry.areaKey);
    const backwards = computeCapacity([], [...AREAS].reverse(), window(), NOW).map(
      (entry) => entry.areaKey,
    );
    expect(forwards).toEqual(backwards);
    expect(forwards).toEqual(['alpha', 'beta', 'delta', 'gamma', 'noise', 'upkeep']);
  });

  it('rejects a completion attributed to an area it has never heard of', () => {
    expect(() =>
      computeCapacity([completion({ id: '1', areaKey: 'nowhere' })], AREAS, window(), NOW),
    ).toThrow(/which is not in the area set/);
  });

  it('produces the same result twice', () => {
    const run = () =>
      computeCapacity(
        [completion({ id: '1', areaKey: 'alpha', recordedMinutes: 60 })],
        AREAS,
        window(),
        NOW,
      );
    expect(run()).toEqual(run());
  });
});
