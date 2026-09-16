import { type CalendarDate, dayNumberOfDate, parseCalendarDate } from '../entities/calendar.js';
import { InvariantError } from '../entities/errors.js';

/**
 * Calendar arithmetic for the schedule engine, in **whole working days**.
 *
 * The W02 brief warns that calendar arithmetic is where a schedule engine
 * breaks, and tells the implementer to reach for a date library rather than do
 * arithmetic on `Date` by hand. The risk it is naming — daylight saving,
 * month ends, leap years — is the risk of doing arithmetic on *instants*.
 * `entities/calendar.ts` already removed that class of bug by reducing every
 * date to a **whole UTC day number** before anything compares or adds, and
 * integer arithmetic on day numbers has no hours to lose or gain. A library
 * would add a dependency to a package whose defining property is that it has
 * almost none, and it would not remove a single failure mode that day numbers
 * have not already removed.
 *
 * So: nothing here adds to a `Date`. Everything is `number` — days since the
 * epoch — until the moment a result is turned back into a `CalendarDate`.
 *
 * A **working day** is a day whose weekday is in the working week and which is
 * not a holiday. Both are configuration: the working week is not a constant of
 * the universe, and the holidays of one country are not those of another.
 */

const MS_PER_DAY = 86_400_000;

/** 1970-01-01, day number 0, was a Thursday. */
const EPOCH_WEEKDAY = 4;

/**
 * How far any search will walk before it concludes the calendar has no working
 * day left. Ten years: long enough that no real configuration reaches it, short
 * enough that a pathological one fails in milliseconds instead of hanging.
 */
const MAX_SEARCH_DAYS = 3660;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** `0` is Sunday, matching `Date.prototype.getUTCDay`. */
export function weekdayOfDayNumber(day: number): number {
  return (((day + EPOCH_WEEKDAY) % 7) + 7) % 7;
}

/** The inverse of `dayNumberOfDate`. */
export function dateOfDayNumber(day: number): CalendarDate {
  if (!Number.isInteger(day)) {
    throw new InvariantError(
      'invalid_calendar_date',
      `a day number must be a whole number of days, not ${String(day)}`,
    );
  }
  const instant = new Date(day * MS_PER_DAY);
  const year = String(instant.getUTCFullYear()).padStart(4, '0');
  const month = String(instant.getUTCMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(instant.getUTCDate()).padStart(2, '0');
  return parseCalendarDate(`${year}-${month}-${dayOfMonth}`);
}

export interface WorkingCalendar {
  /** Weekdays that are worked, `0` = Sunday. Never empty. */
  readonly workingWeekdays: ReadonlySet<number>;
  /** Day numbers that are not worked whatever their weekday. */
  readonly holidays: ReadonlySet<number>;
}

export function buildWorkingCalendar(
  workingWeekdays: readonly number[],
  holidays: readonly CalendarDate[],
): WorkingCalendar {
  const days = new Set<number>();
  for (const weekday of workingWeekdays) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new InvariantError(
        'invalid_params',
        `a working weekday must be a whole number from 0 (Sunday) to 6 (Saturday), not ${String(weekday)}`,
      );
    }
    days.add(weekday);
  }
  if (days.size === 0) {
    // Not pedantry: with no working day every search below runs to its bound
    // and every duration is unsatisfiable. Failing at construction says why.
    throw new InvariantError('invalid_params', 'the working week must contain at least one day');
  }

  return {
    workingWeekdays: days,
    holidays: new Set<number>(holidays.map(dayNumberOfDate)),
  };
}

export function isWorkingDay(day: number, calendar: WorkingCalendar): boolean {
  return calendar.workingWeekdays.has(weekdayOfDayNumber(day)) && !calendar.holidays.has(day);
}

function search(day: number, step: 1 | -1, calendar: WorkingCalendar): number {
  for (let candidate = day, walked = 0; walked <= MAX_SEARCH_DAYS; candidate += step, walked++) {
    if (isWorkingDay(candidate, calendar)) return candidate;
  }
  throw new InvariantError(
    'invalid_params',
    `no working day within ${String(MAX_SEARCH_DAYS)} days of ${dateOfDayNumber(day)} — the working week and the holiday list leave nothing to work on`,
  );
}

/** `day` itself when it is worked, otherwise the next day that is. */
export function workingDayOnOrAfter(day: number, calendar: WorkingCalendar): number {
  return search(day, 1, calendar);
}

/** `day` itself when it is worked, otherwise the previous day that is. */
export function workingDayOnOrBefore(day: number, calendar: WorkingCalendar): number {
  return search(day, -1, calendar);
}

/** The first working day strictly after `day`. The day work may resume. */
export function nextWorkingDay(day: number, calendar: WorkingCalendar): number {
  return workingDayOnOrAfter(day + 1, calendar);
}

function assertWholeDays(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new InvariantError(
      'invalid_params',
      `a span must be a whole, non-negative number of working days, not ${String(count)}`,
    );
  }
}

/**
 * `count` working days after the working day `day`, counting `day` as zero.
 *
 * Spans are **inclusive**: an initiative that starts on a working day and takes
 * `d` working days finishes at the end of `addWorkingDays(start, d - 1)`, and
 * its successor may start on the next working day after that. That convention
 * is what makes a Gantt bar cover exactly the days worked, with no off-by-one
 * between the bar and the dates beneath it.
 */
export function addWorkingDays(day: number, count: number, calendar: WorkingCalendar): number {
  assertWholeDays(count);
  let current = workingDayOnOrAfter(day, calendar);
  for (let remaining = count; remaining > 0; remaining--) {
    current = nextWorkingDay(current, calendar);
  }
  return current;
}

export function subtractWorkingDays(day: number, count: number, calendar: WorkingCalendar): number {
  assertWholeDays(count);
  let current = workingDayOnOrBefore(day, calendar);
  for (let remaining = count; remaining > 0; remaining--) {
    current = workingDayOnOrBefore(current - 1, calendar);
  }
  return current;
}

/**
 * Working days from `from` to `to`, signed: positive when `to` is later,
 * negative when it is earlier, zero when they are the same day.
 *
 * This is the unit slack is reported in. Slack measured in calendar days would
 * say five when a weekend eats two of them, which is exactly the kind of quiet
 * optimism a schedule must not have.
 */
export function workingDaysBetween(from: number, to: number, calendar: WorkingCalendar): number {
  if (from === to) return 0;
  const sign = to > from ? 1 : -1;
  const [low, high] = to > from ? [from, to] : [to, from];

  let count = 0;
  for (let day = low + 1; day <= high; day++) {
    if (isWorkingDay(day, calendar)) count++;
  }
  return sign * count;
}
