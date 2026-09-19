import { describe, expect, it } from 'vitest';
import {
  anyStale,
  declaredSeries,
  staleYears,
  targetPctAt,
  yearOf,
  yearsSpanned,
  type WeightsByYear,
  type YearWeights,
} from './weight-year';

/**
 * The year-boundary test the brief asks for first.
 *
 * The weights here are the fixture ones (`fixtures/areas.json`), which differ
 * deliberately between 2026 and 2027 so this is testable at all — health goes
 * 30 → 20, relationships 25 → 30. A chart of 2026 drawn after 2027's weights
 * land must still say 30 for health in December, and 20 in January.
 */

function weightsFor(
  year: number,
  sourceYear: number | null,
  weights: Record<string, number>,
): YearWeights {
  return {
    year,
    sourceYear,
    stale: sourceYear !== null && sourceYear !== year,
    weights: new Map(Object.entries(weights)),
  };
}

const W2026 = weightsFor(2026, 2026, {
  health: 30,
  relationships: 25,
  craft: 20,
  money: 15,
  home: 5,
  community: 5,
});

const W2027 = weightsFor(2027, 2027, {
  health: 20,
  relationships: 30,
  craft: 15,
  money: 20,
  home: 10,
  community: 5,
});

const BOTH: WeightsByYear = new Map([
  [2026, W2026],
  [2027, W2027],
]);

/** Monthly buckets straddling the boundary: Nov 2026 through Feb 2027. */
const ACROSS_THE_BOUNDARY = ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'];

describe('the year boundary', () => {
  it('draws each bucket against the weights in force at that time', () => {
    expect(declaredSeries(ACROSS_THE_BOUNDARY, 'health', BOTH)).toEqual([30, 30, 20, 20]);
    expect(declaredSeries(ACROSS_THE_BOUNDARY, 'relationships', BOTH)).toEqual([25, 25, 30, 30]);
  });

  it('does not let a later decision move an earlier target', () => {
    const before: WeightsByYear = new Map([[2026, W2026]]);
    const decemberBefore = declaredSeries(['2026-12-01'], 'health', before);
    const decemberAfter = declaredSeries(['2026-12-01'], 'health', BOTH);

    // The whole point: 2027's weights existing changes nothing about 2026.
    expect(decemberAfter).toEqual(decemberBefore);
    expect(decemberAfter).toEqual([30]);
  });

  it('steps at the boundary rather than sloping across it', () => {
    const series = declaredSeries(ACROSS_THE_BOUNDARY, 'craft', BOTH);

    // 20, 20, 15, 15 — no interpolated value between them. A weight is fixed
    // for a calendar year and changes by decision, not by drift.
    expect(series).toEqual([20, 20, 15, 15]);
    expect(series).not.toContain(17.5);
  });

  it('reads the year from the label, never from a clock', () => {
    // Midnight UTC on New Year's Day is the previous year west of Greenwich,
    // which is how this bug arrives when a label goes through `Date`.
    expect(yearOf('2027-01-01')).toBe(2027);
    expect(new Date('2027-01-01T00:00:00.000Z').getUTCFullYear()).toBe(2027);
  });

  it('refuses a label that is not a calendar date', () => {
    expect(() => yearOf('2027-01')).toThrow(/calendar date/);
    expect(() => yearOf('')).toThrow(/calendar date/);
  });
});

describe('targetPctAt', () => {
  it('answers the declared share for an area in that bucket’s year', () => {
    expect(targetPctAt('2026-03-01', 'home', BOTH)).toBe(5);
    expect(targetPctAt('2027-03-01', 'home', BOTH)).toBe(10);
  });

  it('answers null for an area with no agreed share, not zero', () => {
    // A lane has a budget in hours, not a share (ADR-0014), so it is absent
    // from the weights entirely. Zero would claim a decision was taken.
    expect(targetPctAt('2026-03-01', 'run', BOTH)).toBeNull();
  });

  it('answers null for a year nothing is known about', () => {
    expect(targetPctAt('2025-06-01', 'health', BOTH)).toBeNull();
  });
});

describe('yearsSpanned', () => {
  it('lists every year a range touches, so both ends are fetched', () => {
    expect(yearsSpanned('2026-11-01', '2027-02-28')).toEqual([2026, 2027]);
  });

  it('is a single year when the range does not cross one', () => {
    expect(yearsSpanned('2026-01-01', '2026-12-31')).toEqual([2026]);
  });

  it('covers the years in between, not only the ends', () => {
    expect(yearsSpanned('2024-06-01', '2027-06-01')).toEqual([2024, 2025, 2026, 2027]);
  });

  it('refuses a range that ends before it starts', () => {
    expect(() => yearsSpanned('2027-01-01', '2026-01-01')).toThrow(/ends after it starts/);
  });
});

describe('staleness across a window', () => {
  // Carried forward: 2027 asked for, 2026's numbers answered.
  const CARRIED_2027 = weightsFor(2027, 2026, Object.fromEntries(W2026.weights));
  const CARRIED: WeightsByYear = new Map([
    [2026, W2026],
    [2027, CARRIED_2027],
  ]);

  it('is false when every year on screen was decided for itself', () => {
    expect(anyStale(ACROSS_THE_BOUNDARY, BOTH)).toBe(false);
    expect(staleYears(ACROSS_THE_BOUNDARY, BOTH)).toEqual([]);
  });

  it('is true when a year reached by the window carries earlier weights', () => {
    expect(anyStale(ACROSS_THE_BOUNDARY, CARRIED)).toBe(true);
    expect(staleYears(ACROSS_THE_BOUNDARY, CARRIED)).toEqual([{ year: 2027, carriedFrom: 2026 }]);
  });

  it('reports a carried year even when only the tail of the window reaches it', () => {
    // A twelve-month chart can reach into an undecided year through one
    // bucket. One carried bucket is still a carried target line.
    expect(anyStale(['2026-12-01', '2027-01-01'], CARRIED)).toBe(true);
  });

  it('reports each year once, in order', () => {
    const three: WeightsByYear = new Map([
      [2025, weightsFor(2025, null, {})],
      [2026, W2026],
      [2027, CARRIED_2027],
    ]);

    expect(staleYears(['2025-12-01', '2026-06-01', '2027-01-01', '2027-02-01'], three)).toEqual([
      { year: 2027, carriedFrom: 2026 },
    ]);
  });

  it('omits a year from before any weights existed', () => {
    // The API reports a year it knows nothing about as stale with a null
    // source. There is no year it was carried from, so there is no sentence
    // to write about it — and a caller that wrote one anyway said "computed
    // from 0's weights", which is how this was found on a three-year window.
    const prehistory: YearWeights = {
      year: 2023,
      sourceYear: null,
      stale: true,
      weights: new Map(),
    };
    const reaching: WeightsByYear = new Map([
      [2023, prehistory],
      [2026, W2026],
    ]);

    expect(staleYears(['2023-06-01', '2026-06-01'], reaching)).toEqual([]);
  });
});
