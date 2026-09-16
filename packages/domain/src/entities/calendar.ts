import { z } from 'zod';
import { InvariantError } from './errors.js';

/**
 * Calendar arithmetic, done in whole UTC days.
 *
 * A deadline is a calendar fact, not an instant: "the 25th" is the 25th
 * wherever you are standing. Mixing it with a wall-clock instant is how an
 * off-by-one appears in a ranking at 23:00 and disappears by morning, so both
 * sides are reduced to a UTC day number before they are ever compared.
 *
 * `now` is always a parameter here, never the ambient clock
 * (packages/domain/CLAUDE.md §2).
 */

const MS_PER_DAY = 86_400_000;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

declare const calendarDateBrand: unique symbol;

/** An ISO calendar date, `YYYY-MM-DD`, known to name a real day. */
export type CalendarDate = string & { readonly [calendarDateBrand]: 'CalendarDate' };

declare const yearBrand: unique symbol;

/**
 * A calendar year.
 *
 * Branded on purpose. Every weight lookup takes one (ADR-0007), and a brand
 * means a bare `number` — an index, a count, a percentage — cannot drift into
 * the position where a year belongs.
 */
export type Year = number & { readonly [yearBrand]: 'Year' };

export function isCalendarDate(value: string): value is CalendarDate {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through UTC: rejects 2026-02-30 and friends, which the regex
  // happily accepts.
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

export function parseCalendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) {
    throw new InvariantError(
      'invalid_calendar_date',
      `"${value}" is not a calendar date — expected YYYY-MM-DD naming a real day`,
    );
  }
  return value;
}

export const calendarDateSchema: z.ZodType<CalendarDate> = z.custom<CalendarDate>(
  (value) => typeof value === 'string' && isCalendarDate(value),
  { message: 'expected a YYYY-MM-DD calendar date naming a real day' },
);

export function isYear(value: number): value is Year {
  return Number.isInteger(value) && value >= 1970 && value <= 9999;
}

export function parseYear(value: number): Year {
  if (!isYear(value)) {
    throw new InvariantError(
      'invalid_year',
      `${value} is not a calendar year — expected a whole number between 1970 and 9999`,
    );
  }
  return value;
}

export const yearSchema: z.ZodType<Year> = z.custom<Year>(
  (value) => typeof value === 'number' && isYear(value),
  { message: 'expected a whole calendar year between 1970 and 9999' },
);

/** Whole UTC days since the epoch. The common currency for every comparison. */
export function dayNumberOfInstant(instant: Date): number {
  return Math.floor(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()) / MS_PER_DAY,
  );
}

export function dayNumberOfDate(date: CalendarDate): number {
  const match = CALENDAR_DATE.exec(date);
  /* c8 ignore next -- unreachable: the brand guarantees the shape */
  if (!match) throw new InvariantError('invalid_calendar_date', `"${date}" is not a calendar date`);
  const [, y, m, d] = match;
  return Math.floor(Date.UTC(Number(y), Number(m) - 1, Number(d)) / MS_PER_DAY);
}

/**
 * Whole days from `now` until `date`. Negative once the date is behind us,
 * which is what makes an overdue deadline keep its override rather than quietly
 * losing it.
 */
export function daysUntil(date: CalendarDate, now: Date): number {
  return dayNumberOfDate(date) - dayNumberOfInstant(now);
}

export function yearOfInstant(instant: Date): Year {
  return parseYear(instant.getUTCFullYear());
}

export function yearOfDate(date: CalendarDate): Year {
  return parseYear(Number(date.slice(0, 4)));
}

/** `now` shifted back by whole days. Used to open a capacity window. */
export function subtractDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() - days * MS_PER_DAY);
}
