import { describe, expect, it } from 'vitest';

import { reconstructAdherence } from './adherence.js';
import type { AttributedCompletion, RitualRecord } from './types.js';

/**
 * Ritual adherence — the series neither external tool keeps.
 *
 * All synthetic. Ritual names here are invented and deliberately bland: a real
 * habit is one of the more revealing things in a personal workspace
 * (docs/17-privacy.md).
 */

const RANGE = {
  from: new Date('2026-09-07T00:00:00Z'), // a Monday
  to: new Date('2026-10-05T00:00:00Z'), // four weeks later, exclusive
};

function ritual(overrides: Partial<RitualRecord> = {}): RitualRecord {
  return {
    id: 'r-1',
    name: 'Invented habit',
    areaKey: 'alpha',
    cadence: 'weekly',
    externalTaskId: 't-1',
    ...overrides,
  };
}

function done(iso: string, overrides: Partial<AttributedCompletion> = {}): AttributedCompletion {
  return {
    externalTaskId: 't-1',
    completedAt: new Date(iso),
    areaKey: 'alpha',
    areaKind: 'area',
    lane: 'ritual',
    ritualId: 'r-1',
    minutes: 15,
    source: 'default',
    ...overrides,
  };
}

describe('opportunities per cadence', () => {
  it('gives a daily habit seven chances a week', () => {
    const series = reconstructAdherence([ritual({ cadence: 'daily' })], [], RANGE);

    expect(series).toHaveLength(4);
    expect(series.every((period) => period.opportunities === 7)).toBe(true);
  });

  it('gives a weekly habit one chance a week', () => {
    const series = reconstructAdherence([ritual({ cadence: 'weekly' })], [], RANGE);

    expect(series).toHaveLength(4);
    expect(series.every((period) => period.opportunities === 1)).toBe(true);
  });

  it('gives a monthly habit one chance a month, bucketed by month', () => {
    const series = reconstructAdherence([ritual({ cadence: 'monthly' })], [], RANGE);

    expect(series.map((period) => period.periodStart)).toEqual(['2026-09-01', '2026-10-01']);
    expect(series.every((period) => period.opportunities === 1)).toBe(true);
  });
});

describe('counting what happened', () => {
  it('counts each completion into the period it fell in', () => {
    const series = reconstructAdherence(
      [ritual({ cadence: 'daily' })],
      [done('2026-09-08T07:00:00Z'), done('2026-09-09T07:00:00Z'), done('2026-09-21T07:00:00Z')],
      RANGE,
    );

    expect(series[0]).toEqual({
      ritualId: 'r-1',
      periodStart: '2026-09-07',
      opportunities: 7,
      completions: 2,
      excess: 0,
    });
    expect(series[2]?.completions).toBe(1);
  });

  /**
   * A period in which the habit did not happen is the observation, not a gap.
   * The range is known — it is what the backfill covered — so an empty week is
   * genuinely "did not happen" rather than "was never looked at", and leaving
   * it out would turn a missed month into a hole in the line.
   */
  it('emits a zero for a period in which nothing happened', () => {
    const series = reconstructAdherence([ritual()], [done('2026-09-08T07:00:00Z')], RANGE);

    expect(series.map((period) => period.completions)).toEqual([1, 0, 0, 0]);
  });

  it('ignores a completion outside the range on either side', () => {
    const series = reconstructAdherence(
      [ritual()],
      [done('2026-09-06T23:59:00Z'), done('2026-10-05T00:00:00Z')],
      RANGE,
    );

    expect(series.every((period) => period.completions === 0)).toBe(true);
  });

  it('attributes a completion to its own ritual and no other', () => {
    const series = reconstructAdherence(
      [ritual(), ritual({ id: 'r-2', externalTaskId: 't-2' })],
      [done('2026-09-08T07:00:00Z')],
      RANGE,
    );

    expect(series.filter((period) => period.ritualId === 'r-1')[0]?.completions).toBe(1);
    expect(series.filter((period) => period.ritualId === 'r-2')[0]?.completions).toBe(0);
  });

  it('ignores a completion that is not a ritual instance at all', () => {
    const series = reconstructAdherence(
      [ritual()],
      [done('2026-09-08T07:00:00Z', { ritualId: undefined, lane: 'change' })],
      RANGE,
    );

    expect(series.every((period) => period.completions === 0)).toBe(true);
  });
});

/**
 * `ritual_adherence` refuses `completions > opportunities` outright, and
 * rightly: doing a daily habit twice on Tuesday does not make the week 114%
 * adhered. The excess is clamped out of the row a human would see and reported,
 * because a habit that regularly overshoots has the wrong cadence — which is
 * worth knowing rather than discarding.
 */
describe('over-completion', () => {
  it('clamps to the opportunities the cadence offered', () => {
    const series = reconstructAdherence(
      [ritual({ cadence: 'weekly' })],
      [done('2026-09-08T07:00:00Z'), done('2026-09-10T07:00:00Z'), done('2026-09-11T07:00:00Z')],
      RANGE,
    );

    expect(series[0]?.completions).toBe(1);
    expect(series[0]?.excess).toBe(2);
  });

  it('reports no excess when the cadence was merely met', () => {
    const series = reconstructAdherence(
      [ritual({ cadence: 'weekly' })],
      [done('2026-09-08T07:00:00Z')],
      RANGE,
    );

    expect(series[0]).toMatchObject({ completions: 1, excess: 0 });
  });
});

/**
 * A ritual with no bound task is a habit prisme cannot measure. A row of zeroes
 * for it would read as "never done", which is a different and much more
 * damning claim than "not measurable" — so it is absent from the series and
 * named in the report instead.
 */
describe('a ritual with no bound task', () => {
  it('produces no series at all', () => {
    const series = reconstructAdherence([ritual({ externalTaskId: undefined })], [], RANGE);

    expect(series).toEqual([]);
  });
});

describe('determinism', () => {
  it('is ordered by ritual then period, whatever order the input arrived in', () => {
    const series = reconstructAdherence(
      [ritual({ id: 'r-2', externalTaskId: 't-2' }), ritual({ id: 'r-1' })],
      [],
      RANGE,
    );

    const keys = series.map((period) => `${period.ritualId}/${period.periodStart}`);
    expect(keys).toEqual([...keys].sort());
  });
});
