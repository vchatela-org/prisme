import { z } from 'zod';

/**
 * The vocabulary every DTO is built from.
 *
 * Two deliberate choices live here.
 *
 * **Dates cross the boundary as text.** A calendar date is `YYYY-MM-DD` and an
 * instant is ISO-8601 with an offset, and neither is ever a driver's `Date`
 * object rendered by whatever `JSON.stringify` felt like. apps/sync says the
 * same thing about the database boundary for the same reason: a deadline is the
 * 25th wherever you are standing, and letting a local midnight creep in is how
 * an off-by-one appears at 23:00 and is gone by morning.
 *
 * **The API's schemas are its own.** They do not reuse the branded schemas from
 * `@prisme/domain`: a brand is an internal guarantee, `z.custom` does not
 * describe itself to OpenAPI, and the boundary's job is to *parse* untrusted
 * text into something the domain will accept — not to assume it already has.
 */

export const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const calendarDate = z
  .string()
  .regex(CALENDAR_DATE_PATTERN, 'expected a YYYY-MM-DD calendar date')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const utc = new Date(Date.UTC(year, month - 1, day));
    return (
      utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
    );
  }, 'expected a calendar date naming a real day');

/** ISO-8601 with an offset, as `Date.prototype.toISOString` writes it. */
export const instant = z.string().min(20);

export const areaKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'an area key is a lower-case slug');

export const entityId = z.uuid();

/** The estimation scale. A 4 or a 6 cannot be constructed (docs/10-model.md §5). */
export const fibonacci = z.literal([1, 2, 3, 5, 8, 13]);

export const year = z.int().min(1970).max(9999);

export const percentage = z.number().min(0).max(100);

export const INITIATIVE_STATUSES = [
  'inbox',
  'later',
  'next',
  'now',
  'waiting',
  'review',
  'done',
  'dropped',
] as const;

export const initiativeStatus = z.enum(INITIATIVE_STATUSES);

export const areaKind = z.enum(['area', 'run', 'signals']);
export const origin = z.enum(['created_in_prisme', 'adopted']);
export const projectStatus = z.enum(['active', 'paused', 'done', 'dropped']);
export const objectiveType = z.enum(['annual', 'monthly']);
export const objectiveStatus = z.enum(['draft', 'active', 'met', 'missed', 'dropped']);
export const ritualCadence = z.enum(['daily', 'weekly', 'monthly']);
export const reviewCadence = z.enum(['weekly', 'monthly', 'quarterly', 'yearly']);
export const taskPriority = z.enum(['highest', 'high', 'medium', 'lowest']);

/**
 * A comma-separated repeated parameter — `?status=next,now`.
 *
 * Repeated query keys would be more conventional, but they arrive as either a
 * string or an array depending on how many were sent, and a parameter whose
 * *type* depends on its cardinality is a parameter every client gets wrong
 * once. One string, split here, described honestly in OpenAPI.
 */
export function csvOf<T>(member: z.ZodType<T>, what: string): z.ZodType<readonly T[] | undefined> {
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return undefined;
      const parsed: T[] = [];
      for (const part of value.split(',').map((entry) => entry.trim())) {
        const result = member.safeParse(part);
        if (!result.success) {
          ctx.addIssue({ code: 'custom', message: `"${part}" is not ${what}` });
          continue;
        }
        parsed.push(result.data);
      }
      return parsed;
    });
}

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Pagination, on every list that can grow.
 *
 * `limit` is capped rather than honoured: an unbounded page is a way to turn
 * one request into a whole-database read, and a personal instance has no second
 * machine to absorb it.
 */
export const pagination = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
};

export function page<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    /** Rows matching the filter, before the page was cut. */
    total: z.int().min(0),
    limit: z.int(),
    offset: z.int(),
  });
}
