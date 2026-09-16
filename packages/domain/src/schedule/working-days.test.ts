import { describe, expect, it } from 'vitest';

import { dayNumberOfDate, parseCalendarDate } from '../entities/calendar.js';
import { isInvariantError } from '../entities/errors.js';
import {
  addWorkingDays,
  buildWorkingCalendar,
  dateOfDayNumber,
  isWorkingDay,
  nextWorkingDay,
  subtractWorkingDays,
  weekdayOfDayNumber,
  workingDayOnOrAfter,
  workingDayOnOrBefore,
  workingDaysBetween,
} from './working-days.js';

/**
 * Calendar arithmetic, which the W02 brief predicts is where a schedule engine
 * breaks. Everything here is tested around the places it breaks: weekends,
 * month ends, year ends, a leap day, a holiday that lands on a Monday, and the
 * two daylight-saving transitions that catch engines doing arithmetic on
 * instants.
 */

const day = (iso: string) => dayNumberOfDate(parseCalendarDate(iso));

const ALL_DAYS = buildWorkingCalendar([0, 1, 2, 3, 4, 5, 6], []);
const MON_TO_FRI = buildWorkingCalendar([1, 2, 3, 4, 5], []);
const WITH_HOLIDAY = buildWorkingCalendar(
  [1, 2, 3, 4, 5],
  [parseCalendarDate('2026-02-02'), parseCalendarDate('2026-12-25')],
);

function expectInvariant(run: () => unknown, code: string): void {
  try {
    run();
    expect.unreachable('expected an InvariantError');
  } catch (error) {
    expect(isInvariantError(error)).toBe(true);
    if (isInvariantError(error)) expect(error.code).toBe(code);
  }
}

describe('day numbers', () => {
  it('knows the epoch was a Thursday', () => {
    expect(weekdayOfDayNumber(0)).toBe(4);
    expect(weekdayOfDayNumber(-1)).toBe(3);
  });

  it('agrees with the calendar on a known Monday', () => {
    expect(weekdayOfDayNumber(day('2026-01-05'))).toBe(1);
    expect(weekdayOfDayNumber(day('2026-01-10'))).toBe(6);
    expect(weekdayOfDayNumber(day('2026-01-11'))).toBe(0);
  });

  it('round-trips every day of a year, leap day included', () => {
    for (let offset = 0; offset < 800; offset++) {
      const date = dateOfDayNumber(day('2027-06-01') + offset);
      expect(dayNumberOfDate(date)).toBe(day('2027-06-01') + offset);
    }
    expect(dateOfDayNumber(day('2028-02-28') + 1)).toBe('2028-02-29');
    expect(dateOfDayNumber(day('2026-12-31') + 1)).toBe('2027-01-01');
  });

  it('refuses a day number that is not a whole number of days', () => {
    expectInvariant(() => dateOfDayNumber(1.5), 'invalid_calendar_date');
  });
});

describe('building a working calendar', () => {
  it('refuses a weekday outside 0–6 and a fractional one', () => {
    expectInvariant(() => buildWorkingCalendar([7], []), 'invalid_params');
    expectInvariant(() => buildWorkingCalendar([-1], []), 'invalid_params');
    expectInvariant(() => buildWorkingCalendar([1.5], []), 'invalid_params');
  });

  it('refuses an empty working week rather than searching for a day that is not there', () => {
    expectInvariant(() => buildWorkingCalendar([], []), 'invalid_params');
  });

  it('treats a repeated weekday as one', () => {
    const calendar = buildWorkingCalendar([1, 1, 1], []);
    expect(calendar.workingWeekdays.size).toBe(1);
  });
});

describe('which days are worked', () => {
  it('excludes the weekend, and the holiday that falls on a Monday', () => {
    expect(isWorkingDay(day('2026-01-30'), MON_TO_FRI)).toBe(true);
    expect(isWorkingDay(day('2026-01-31'), MON_TO_FRI)).toBe(false);
    expect(isWorkingDay(day('2026-02-02'), MON_TO_FRI)).toBe(true);
    expect(isWorkingDay(day('2026-02-02'), WITH_HOLIDAY)).toBe(false);
  });

  it('works every day when configured to', () => {
    expect(isWorkingDay(day('2026-01-31'), ALL_DAYS)).toBe(true);
  });
});

describe('finding the next working day', () => {
  it('returns the day itself when it is worked', () => {
    expect(dateOfDayNumber(workingDayOnOrAfter(day('2026-01-29'), MON_TO_FRI))).toBe('2026-01-29');
    expect(dateOfDayNumber(workingDayOnOrBefore(day('2026-01-29'), MON_TO_FRI))).toBe('2026-01-29');
  });

  it('steps over a weekend, a month end and a holiday in one hop', () => {
    expect(dateOfDayNumber(workingDayOnOrAfter(day('2026-01-31'), WITH_HOLIDAY))).toBe(
      '2026-02-03',
    );
    expect(dateOfDayNumber(nextWorkingDay(day('2026-01-30'), WITH_HOLIDAY))).toBe('2026-02-03');
    expect(dateOfDayNumber(workingDayOnOrBefore(day('2026-02-02'), WITH_HOLIDAY))).toBe(
      '2026-01-30',
    );
  });

  it('crosses a year end', () => {
    expect(dateOfDayNumber(nextWorkingDay(day('2026-12-31'), MON_TO_FRI))).toBe('2027-01-01');
    expect(dateOfDayNumber(nextWorkingDay(day('2026-12-24'), WITH_HOLIDAY))).toBe('2026-12-28');
  });

  it('gives up rather than hanging when the calendar leaves nothing to work on', () => {
    const start = day('2026-01-01');
    const everyDay = [];
    for (let offset = 0; offset < 3700; offset++) everyDay.push(dateOfDayNumber(start + offset));
    const nothing = buildWorkingCalendar([0, 1, 2, 3, 4, 5, 6], everyDay);
    expectInvariant(() => workingDayOnOrAfter(start, nothing), 'invalid_params');
  });
});

describe('adding and subtracting working days', () => {
  it('counts the start day as zero, so a span of d days ends d−1 later', () => {
    expect(dateOfDayNumber(addWorkingDays(day('2026-01-29'), 0, MON_TO_FRI))).toBe('2026-01-29');
    expect(dateOfDayNumber(addWorkingDays(day('2026-01-29'), 4, WITH_HOLIDAY))).toBe('2026-02-05');
  });

  it('is the inverse of subtracting, for every span up to a month', () => {
    for (let span = 0; span <= 30; span++) {
      const forward = addWorkingDays(day('2026-01-29'), span, WITH_HOLIDAY);
      expect(subtractWorkingDays(forward, span, WITH_HOLIDAY)).toBe(day('2026-01-29'));
    }
  });

  it('snaps a non-working start forward, and a non-working finish back', () => {
    expect(dateOfDayNumber(addWorkingDays(day('2026-01-31'), 0, MON_TO_FRI))).toBe('2026-02-02');
    expect(dateOfDayNumber(subtractWorkingDays(day('2026-01-31'), 0, MON_TO_FRI))).toBe(
      '2026-01-30',
    );
  });

  it('refuses a negative or fractional span', () => {
    expectInvariant(() => addWorkingDays(day('2026-01-29'), -1, MON_TO_FRI), 'invalid_params');
    expectInvariant(
      () => subtractWorkingDays(day('2026-01-29'), 0.5, MON_TO_FRI),
      'invalid_params',
    );
  });
});

describe('counting working days between two days', () => {
  it('is zero for the same day and signed either side of it', () => {
    expect(workingDaysBetween(day('2026-01-29'), day('2026-01-29'), MON_TO_FRI)).toBe(0);
    expect(workingDaysBetween(day('2026-01-29'), day('2026-02-05'), WITH_HOLIDAY)).toBe(4);
    expect(workingDaysBetween(day('2026-02-05'), day('2026-01-29'), WITH_HOLIDAY)).toBe(-4);
  });

  it('does not count the weekend it spans', () => {
    // Friday to the following Monday is one working day apart, not three.
    expect(workingDaysBetween(day('2026-01-30'), day('2026-02-03'), WITH_HOLIDAY)).toBe(1);
    expect(workingDaysBetween(day('2026-01-30'), day('2026-02-03'), ALL_DAYS)).toBe(4);
  });

  it('is unmoved by a daylight-saving transition, in either hemisphere', () => {
    // Europe springs forward on 2026-03-29, North America on 2026-03-08. A day
    // number has no hours to lose, which is the reason to work in day numbers.
    expect(workingDaysBetween(day('2026-03-27'), day('2026-03-30'), MON_TO_FRI)).toBe(1);
    expect(workingDaysBetween(day('2026-03-06'), day('2026-03-09'), MON_TO_FRI)).toBe(1);
    expect(workingDaysBetween(day('2026-10-30'), day('2026-11-02'), MON_TO_FRI)).toBe(1);
  });
});
