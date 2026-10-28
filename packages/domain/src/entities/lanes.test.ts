import { describe, expect, it } from 'vitest';
import {
  reviewAdherence,
  reviewCanFulfil,
  ritualMeasure,
  ritualOpportunities,
  ritualPeriodOf,
  ritualTaskLink,
} from './lanes.js';

describe('the period a ritual is counted in', () => {
  it('is the Monday week for a daily habit, with seven chances', () => {
    // A Sunday evening belongs to the week that started six days before.
    expect(ritualPeriodOf('daily', new Date('2026-11-01T21:30:00Z'))).toEqual({
      periodStart: '2026-10-26',
      opportunities: 7,
    });
    expect(ritualPeriodOf('daily', new Date('2026-10-26T00:00:00Z')).periodStart).toBe(
      '2026-10-26',
    );
  });

  it('is the same week for a weekly habit, with one chance', () => {
    expect(ritualPeriodOf('weekly', new Date('2026-10-28T12:00:00Z'))).toEqual({
      periodStart: '2026-10-26',
      opportunities: 1,
    });
  });

  it('is the calendar month, quarter or year for the longer cadences', () => {
    const at = new Date('2026-11-17T08:00:00Z');
    expect(ritualPeriodOf('monthly', at).periodStart).toBe('2026-11-01');
    expect(ritualPeriodOf('quarterly', at).periodStart).toBe('2026-10-01');
    expect(ritualPeriodOf('yearly', at).periodStart).toBe('2026-01-01');
    expect(ritualOpportunities('quarterly')).toBe(1);
  });

  it('reads the instant in UTC, whatever the clock it came from', () => {
    // 23:30 on the last day of a month in UTC is still that month.
    expect(ritualPeriodOf('monthly', new Date('2026-09-30T23:30:00Z')).periodStart).toBe(
      '2026-09-01',
    );
  });
});

describe('what tying a task to a ritual does', () => {
  it('attaches a task to a ritual that has none', () => {
    expect(ritualTaskLink(undefined, 'task-walk')).toBe('attach');
  });

  it('changes nothing when the ritual already has that task', () => {
    expect(ritualTaskLink('task-walk', 'task-walk')).toBe('already');
  });

  it('refuses another task rather than replacing the one it has', () => {
    expect(ritualTaskLink('task-walk', 'task-stretch')).toBe('other_task');
  });
});

describe('what a ritual is measured from', () => {
  it('is its task when it has one, whatever else is set', () => {
    expect(ritualMeasure({ externalTaskId: 'task-walk', fulfilledByReview: true })).toBe('task');
  });

  it('is its review when it is fulfilled by one, and by hand otherwise', () => {
    expect(ritualMeasure({ externalTaskId: null, fulfilledByReview: true })).toBe('review');
    expect(ritualMeasure({ externalTaskId: null, fulfilledByReview: false })).toBe('hand');
    expect(ritualMeasure({})).toBe('hand');
  });

  it('can be a review for every cadence a review has, and never for a daily habit', () => {
    expect(reviewCanFulfil('daily')).toBe(false);
    for (const cadence of ['weekly', 'monthly', 'quarterly', 'yearly'] as const) {
      expect(reviewCanFulfil(cadence)).toBe(true);
    }
  });
});

describe('the adherence of a ritual fulfilled by its review', () => {
  const now = new Date('2026-10-28T12:00:00Z'); // a Wednesday; the week began 2026-10-26

  it('is nothing at all before the first review is closed', () => {
    expect(reviewAdherence('weekly', [], now)).toEqual([]);
  });

  it('runs from the first close to last week, a skipped week reading as a zero', () => {
    const closed = [new Date('2026-10-04T18:00:00Z'), new Date('2026-10-18T09:00:00Z')];
    expect(reviewAdherence('weekly', closed, now)).toEqual([
      { periodStart: '2026-09-28', opportunities: 1, completions: 1 },
      { periodStart: '2026-10-05', opportunities: 1, completions: 0 },
      { periodStart: '2026-10-12', opportunities: 1, completions: 1 },
      { periodStart: '2026-10-19', opportunities: 1, completions: 0 },
    ]);
  });

  it('includes this week once it is done, and counts two closes in it once', () => {
    const closed = [new Date('2026-10-26T08:00:00Z'), new Date('2026-10-27T08:00:00Z')];
    expect(reviewAdherence('weekly', closed, now)).toEqual([
      { periodStart: '2026-10-26', opportunities: 1, completions: 1 },
    ]);
  });

  it('steps by calendar month, quarter or year for the longer cadences', () => {
    const closed = [new Date('2026-07-31T20:00:00Z')];
    expect(reviewAdherence('monthly', closed, now).map((row) => row.periodStart)).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ]);
    expect(reviewAdherence('quarterly', closed, now)).toEqual([
      { periodStart: '2026-07-01', opportunities: 1, completions: 1 },
    ]);
    expect(reviewAdherence('yearly', [new Date('2025-12-30T10:00:00Z')], now)).toEqual([
      { periodStart: '2025-01-01', opportunities: 1, completions: 1 },
    ]);
  });

  it('ignores a close after now, and has nothing to say about a daily habit', () => {
    expect(reviewAdherence('weekly', [new Date('2026-11-02T08:00:00Z')], now)).toEqual([]);
    expect(reviewAdherence('daily', [new Date('2026-10-04T18:00:00Z')], now)).toEqual([]);
  });
});
