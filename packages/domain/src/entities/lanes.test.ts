import { describe, expect, it } from 'vitest';
import { ritualOpportunities, ritualPeriodOf, ritualTaskLink } from './lanes.js';

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
