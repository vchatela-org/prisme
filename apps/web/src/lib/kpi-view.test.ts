import { describe, expect, it } from 'vitest';
import {
  agingBuckets,
  bucketLabel,
  estimatedMinutesPct,
  labelsOf,
  measuredBuckets,
  minutesCaveat,
  monthsBefore,
  mostStarved,
  observedShareSeries,
  orderAreas,
  totalMinutesPerBucket,
  type AreaSeries,
} from './kpi-view';

/**
 * Invented areas and invented minutes. The keys match `fixtures/areas.json`
 * because the fixture keys are themselves invented (`fixtures/README.md`), and
 * a test that reads like the screen is easier to keep honest.
 */
function series(areaKey: string, kind: AreaSeries['kind'], values: readonly number[]): AreaSeries {
  return {
    areaKey,
    kind,
    points: values.map((value, index) => ({
      periodStart: `2026-0${String(index + 1)}-01`,
      value,
    })),
  };
}

const MINUTES: readonly AreaSeries[] = [
  series('health', 'area', [300, 600, 0]),
  series('craft', 'area', [600, 400, 0]),
  // Signals arrive as zero minutes: the API applies ADR-0014, not this tier.
  series('signals', 'signals', [0, 0, 0]),
  series('run', 'run', [100, 0, 0]),
];

describe('observedShareSeries', () => {
  it('normalises one area against every area in the same bucket', () => {
    // Bucket 1: 300 of 1000. Bucket 2: 600 of 1000.
    expect(observedShareSeries('health', MINUTES)).toEqual([30, 60, null]);
  });

  it('includes Run in the denominator', () => {
    // Craft is 600 of 1000 and not 600 of 900: upkeep counts toward capacity
    // even though it never competes in the ranking (docs/12-scoring.md §4).
    expect(observedShareSeries('craft', MINUTES)?.[0]).toBe(60);
  });

  it('gives an empty bucket a gap, not a zero', () => {
    const shares = observedShareSeries('health', MINUTES);

    // The third bucket recorded nothing at all. Zero would draw every area
    // collapsing to the floor, which reads as a catastrophe rather than a
    // month off.
    expect(shares[2]).toBeNull();
    expect(shares[2]).not.toBe(0);
  });

  it('gives an area that did nothing in a measured bucket a real zero', () => {
    // Run has no minutes in bucket 2, but bucket 2 *was* measured — so this
    // one genuinely is zero, and the line should not break.
    expect(observedShareSeries('run', MINUTES)?.[1]).toBe(0);
  });

  it('answers all-null for an area the payload does not carry', () => {
    expect(observedShareSeries('unknown', MINUTES)).toEqual([0, 0, null]);
  });

  it('answers an empty series for an empty payload', () => {
    expect(observedShareSeries('health', [])).toEqual([]);
  });
});

describe('totalMinutesPerBucket', () => {
  it('sums every area in each bucket', () => {
    expect(totalMinutesPerBucket(MINUTES)).toEqual([1000, 1000, 0]);
  });

  it('is empty when there are no series', () => {
    expect(totalMinutesPerBucket([])).toEqual([]);
  });
});

describe('labelsOf', () => {
  it('takes the labels from the first series carrying any', () => {
    expect(labelsOf(MINUTES)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('skips a series with no points rather than answering empty', () => {
    const withEmptyFirst: readonly AreaSeries[] = [
      { areaKey: 'health', kind: 'area', points: [] },
      ...MINUTES,
    ];
    expect(labelsOf(withEmptyFirst)).toHaveLength(3);
  });

  it('is empty when nothing has points', () => {
    expect(labelsOf([{ areaKey: 'health', kind: 'area', points: [] }])).toEqual([]);
  });
});

describe('measuredBuckets', () => {
  it('counts only the buckets that recorded something', () => {
    expect(measuredBuckets(MINUTES)).toBe(2);
  });

  it('is zero for a history with nothing in it', () => {
    expect(measuredBuckets([series('health', 'area', [0, 0])])).toBe(0);
  });
});

describe('bucketLabel', () => {
  it('names the month for a monthly bucket', () => {
    expect(bucketLabel('2026-11-01', 'month')).toBe('Nov 26');
  });

  it('names the day for a weekly bucket', () => {
    expect(bucketLabel('2026-11-09', 'week')).toBe('9 Nov');
  });

  it('passes an unparseable label through rather than inventing one', () => {
    expect(bucketLabel('2026', 'month')).toBe('2026');
  });
});

describe('orderAreas', () => {
  const AREAS = [
    { areaKey: 'signals', kind: 'signals' as const },
    { areaKey: 'home', kind: 'area' as const },
    { areaKey: 'run', kind: 'run' as const },
    { areaKey: 'health', kind: 'area' as const },
    { areaKey: 'craft', kind: 'area' as const },
  ];

  const target = (key: string): number | null => ({ health: 30, craft: 20, home: 5 })[key] ?? null;

  it('puts areas first, then Run, then Signals', () => {
    const kinds = orderAreas(AREAS, target).map((a) => a.kind);
    expect(kinds).toEqual(['area', 'area', 'area', 'run', 'signals']);
  });

  it('orders areas by declared share, so the rows hold still for a year', () => {
    const keys = orderAreas(AREAS, target)
      .filter((a) => a.kind === 'area')
      .map((a) => a.areaKey);
    expect(keys).toEqual(['health', 'craft', 'home']);
  });

  it('falls back to the key when two areas share a declared share', () => {
    const tied = [
      { areaKey: 'money', kind: 'area' as const },
      { areaKey: 'community', kind: 'area' as const },
    ];
    expect(orderAreas(tied, () => 5).map((a) => a.areaKey)).toEqual(['community', 'money']);
  });

  it('does not mutate what it is given', () => {
    const input = [...AREAS];
    orderAreas(input, target);
    expect(input).toEqual(AREAS);
  });
});

describe('estimatedMinutesPct', () => {
  it('counts declared and default durations as estimates, recorded as not', () => {
    const areas = [
      { minutesBySource: { recorded: 60, declared: 20, default: 20 } },
      { minutesBySource: { recorded: 40, declared: 0, default: 60 } },
    ];
    // 100 estimated of 200 total.
    expect(estimatedMinutesPct(areas)).toBe(50);
  });

  it('is null when nothing has been attributed at all', () => {
    expect(estimatedMinutesPct([])).toBeNull();
    expect(
      estimatedMinutesPct([{ minutesBySource: { recorded: 0, declared: 0, default: 0 } }]),
    ).toBeNull();
  });

  it('is zero when every duration was recorded', () => {
    expect(
      estimatedMinutesPct([{ minutesBySource: { recorded: 90, declared: 0, default: 0 } }]),
    ).toBe(0);
  });
});

describe('mostStarved', () => {
  const area = (name: string, balanceFactor: number) => ({
    areaKey: name.toLowerCase(),
    name,
    balanceFactor,
  });

  it('names the area when one is clearly worst', () => {
    expect(mostStarved([area('Health', 1.7), area('Craft', 0.5), area('Home', 1.2)])).toEqual({
      label: 'Health',
      tied: 1,
    });
  });

  it('refuses to name one of several areas pinned at the clamp', () => {
    // Relationships is 30% declared against 6.3% observed and Money is 20%
    // against 6.3%: genuinely different, identical after the clamp. Naming
    // either would send a reader to an area that is no worse than the others.
    const verdict = mostStarved([
      area('Relationships', 2),
      area('Money', 2),
      area('Community', 2),
      area('Craft', 0.5),
    ]);

    expect(verdict.tied).toBe(3);
    expect(verdict.label).toBe('3 at the clamp');
  });

  it('distinguishes a tie below the ceiling from one at it', () => {
    const below = mostStarved([area('Health', 1.4), area('Money', 1.4)]);
    expect(below.label).toBe('2 tied');
  });

  it('has nothing to say about no areas', () => {
    expect(mostStarved([])).toEqual({ label: '—', tied: 0 });
  });
});

describe('agingBuckets', () => {
  it('buckets by how long each item has sat untouched', () => {
    expect(agingBuckets([0, 3, 7, 13, 14, 29, 30, 200])).toEqual([
      { label: 'Under a week', count: 2 },
      { label: 'One to two weeks', count: 2 },
      { label: 'Two to four weeks', count: 2 },
      { label: 'Over a month', count: 2 },
    ]);
  });

  it('keeps an unknown age out of the freshest bucket', () => {
    // Folding it into "under a week" would make the dashboard quietly
    // optimistic about work nobody can date.
    const rows = agingBuckets([1, null, null]);
    expect(rows.find((row) => row.label === 'Under a week')?.count).toBe(1);
    expect(rows.find((row) => row.label === 'Age unknown')?.count).toBe(2);
  });

  it('omits the unknown row when every age is known', () => {
    expect(agingBuckets([1, 2]).map((row) => row.label)).not.toContain('Age unknown');
  });

  it('reports every bucket as zero when nothing is in flight', () => {
    const rows = agingBuckets([]);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.count === 0)).toBe(true);
  });
});

describe('monthsBefore', () => {
  it('steps back within a year', () => {
    expect(monthsBefore('2026-12-31', 3)).toBe('2026-09-01');
  });

  it('rolls across a year boundary', () => {
    // The case the KPI range hits every January, and the reason this is not
    // written as `month - months` with a manual year adjustment.
    expect(monthsBefore('2027-01-31', 1)).toBe('2026-12-01');
    expect(monthsBefore('2027-01-31', 24)).toBe('2025-01-01');
  });

  it('always lands on the first of a month', () => {
    for (const months of [0, 1, 7, 13, 25]) {
      expect(monthsBefore('2026-06-17', months).endsWith('-01')).toBe(true);
    }
  });

  it('refuses something that is not a calendar date', () => {
    expect(() => monthsBefore('soon', 3)).toThrow(/calendar date/);
  });
});

describe('minutesCaveat', () => {
  it('quotes the measured proportion when there is one', () => {
    expect(minutesCaveat(42.4)).toContain('42% of these minutes are estimated');
  });

  it('still states the limitation when there is nothing to measure', () => {
    const sentence = minutesCaveat(null);
    expect(sentence).toContain('estimated otherwise');
    expect(sentence).toContain('attention routed through tasks');
  });

  it('always carries the stated limitation, whatever the proportion', () => {
    // docs/12-scoring.md §4 says this out loud where it is implemented; the
    // brief says to say it on the chart rather than in a footnote.
    expect(minutesCaveat(0)).toContain('not hours lived');
  });
});
