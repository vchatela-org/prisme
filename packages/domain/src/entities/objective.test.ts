import { describe, expect, it } from 'vitest';
import {
  isObjectiveOpen,
  OBJECTIVE_STATUSES,
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
