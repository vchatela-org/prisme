import { describe, expect, it } from 'vitest';
import {
  adoptedObjectiveStatus,
  isObjectiveOpen,
  OBJECTIVE_STATUSES,
  objectiveCountsIn,
  objectiveDatesOf,
  objectivePeriodOf,
  periodMatchesType,
} from './objective.js';

describe('the days a period covers', () => {
  it('is the whole calendar year for an annual objective', () => {
    expect(objectiveDatesOf('annual', '2027')).toEqual({
      startsOn: '2027-01-01',
      endsOn: '2027-12-31',
    });
  });

  it('is the whole calendar month for a monthly one, whatever its length', () => {
    expect(objectiveDatesOf('monthly', '2027-02')).toEqual({
      startsOn: '2027-02-01',
      endsOn: '2027-02-28',
    });
    expect(objectiveDatesOf('monthly', '2028-02')?.endsOn).toBe('2028-02-29');
    expect(objectiveDatesOf('monthly', '2027-04')?.endsOn).toBe('2027-04-30');
    expect(objectiveDatesOf('monthly', '2027-12')?.endsOn).toBe('2027-12-31');
  });

  it('is nothing for a period written the other type’s way, rather than a guess', () => {
    expect(objectiveDatesOf('annual', '2027-03')).toBeUndefined();
    expect(objectiveDatesOf('monthly', '2027')).toBeUndefined();
    expect(objectiveDatesOf('monthly', '2027-13')).toBeUndefined();
    expect(objectiveDatesOf('monthly', '2027-00')).toBeUndefined();
  });

  it('is exactly what adoption reads back as the same period', () => {
    for (const [type, period] of [
      ['annual', '2026'],
      ['annual', '2028'],
      ['monthly', '2026-01'],
      ['monthly', '2028-02'],
      ['monthly', '2026-11'],
    ] as const) {
      const dates = objectiveDatesOf(type, period);
      expect(objectivePeriodOf(dates?.startsOn, dates?.endsOn)).toEqual({ type, period });
    }
  });
});

describe('a period written the way its type says', () => {
  it('is four digits for an annual objective and a year-month for a monthly one', () => {
    expect(periodMatchesType('annual', '2027')).toBe(true);
    expect(periodMatchesType('monthly', '2027-09')).toBe(true);
    expect(periodMatchesType('annual', '2027-09')).toBe(false);
    expect(periodMatchesType('monthly', '2027')).toBe(false);
    expect(periodMatchesType('monthly', '2027-9')).toBe(false);
  });
});

describe('an open objective', () => {
  it('is a draft or an active one; a judged or dropped one is closed', () => {
    const open = OBJECTIVE_STATUSES.filter((status) => isObjectiveOpen(status));
    expect(open).toEqual(['draft', 'active']);
  });
});

describe('the status an adopted objective starts in', () => {
  it('is draft while its period has not started', () => {
    expect(adoptedObjectiveStatus('annual', '2027', '2026-09-28')).toBe('draft');
    expect(adoptedObjectiveStatus('monthly', '2026-10', '2026-09-28')).toBe('draft');
    expect(adoptedObjectiveStatus('annual', '2027', '2026-12-31')).toBe('draft');
  });

  it('is active from the first day of its period', () => {
    expect(adoptedObjectiveStatus('annual', '2027', '2027-01-01')).toBe('active');
    expect(adoptedObjectiveStatus('monthly', '2026-10', '2026-10-01')).toBe('active');
    expect(adoptedObjectiveStatus('monthly', '2026-09', '2026-09-28')).toBe('active');
  });

  it('is active for a period already over, which a review judges rather than adoption', () => {
    expect(adoptedObjectiveStatus('annual', '2025', '2026-09-28')).toBe('active');
    expect(adoptedObjectiveStatus('monthly', '2026-02', '2026-09-28')).toBe('active');
  });
});

describe('an objective counted in a window (ADR-0035)', () => {
  const annual = (period: string, status: 'draft' | 'active' | 'met' | 'dropped' = 'active') =>
    ({ type: 'annual', period, status }) as const;

  it('counts when its period overlaps the window', () => {
    expect(objectiveCountsIn(annual('2026'), '2026-07-01', '2026-09-28')).toBe(true);
    expect(objectiveCountsIn(annual('2026'), '2025-12-31', '2026-01-01')).toBe(true);
    expect(
      objectiveCountsIn(
        { type: 'monthly', period: '2026-09', status: 'active' },
        '2026-09-30',
        '2026-12-31',
      ),
    ).toBe(true);
  });

  it('does not count a period outside it, next year’s above all', () => {
    expect(objectiveCountsIn(annual('2027'), '2026-01-01', '2026-12-31')).toBe(false);
    expect(objectiveCountsIn(annual('2025'), '2026-01-01', '2026-09-28')).toBe(false);
    expect(
      objectiveCountsIn(
        { type: 'monthly', period: '2026-10', status: 'active' },
        '2026-07-01',
        '2026-09-30',
      ),
    ).toBe(false);
  });

  it('does not count a draft, which was never under way, and counts a judged one', () => {
    expect(objectiveCountsIn(annual('2026', 'draft'), '2026-01-01', '2026-12-31')).toBe(false);
    expect(objectiveCountsIn(annual('2026', 'met'), '2026-01-01', '2026-12-31')).toBe(true);
    expect(objectiveCountsIn(annual('2026', 'dropped'), '2026-01-01', '2026-12-31')).toBe(true);
  });

  it('does not count a period it cannot read', () => {
    expect(
      objectiveCountsIn(
        { type: 'annual', period: '2026-01', status: 'active' },
        '2026-01-01',
        '2026-12-31',
      ),
    ).toBe(false);
  });
});
