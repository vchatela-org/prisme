import { z } from 'zod';
import type { AreaKey } from './area.js';
import { isCalendarDate, type CalendarDate } from './calendar.js';
import type { InitiativeId } from './initiative.js';

/**
 * Objectives and key results (ADR-0012, ADR-0013).
 *
 * A key result is first-class, not a bullet inside a document, and every one
 * gets an anchor task — a key result you can break into subtasks is a key
 * result that gets worked on.
 *
 * `progress_self` is the primary measure and the one that syncs outward.
 * `progress_computed` is shown beside it and **never** written back: the gap
 * between them is more informative than either alone, and automating the number
 * would destroy the signal.
 */

export type ObjectiveId = string;
export type KeyResultId = string;

export type ObjectiveType = 'annual' | 'monthly';

export type ObjectiveStatus = 'draft' | 'active' | 'met' | 'missed' | 'dropped';

export const OBJECTIVE_TYPES = ['annual', 'monthly'] as const;
export const OBJECTIVE_STATUSES = ['draft', 'active', 'met', 'missed', 'dropped'] as const;

/**
 * The statuses of an objective that is still open — whose period may still be
 * changed (ADR-0034). A met, missed or dropped objective has been judged
 * against its period, and changing the period afterwards would rewrite the
 * judgement, so it keeps the one it has.
 */
export const OBJECTIVE_OPEN_STATUSES = ['draft', 'active'] as const;

export function isObjectiveOpen(status: ObjectiveStatus): boolean {
  return (OBJECTIVE_OPEN_STATUSES as readonly string[]).includes(status);
}

export interface Objective {
  readonly id: ObjectiveId;
  readonly title: string;
  readonly type: ObjectiveType;
  /** `2026` for an annual objective, `2026-03` for a monthly one. */
  readonly period: string;
  readonly areaKey: AreaKey;
  readonly status: ObjectiveStatus;
  /** The narrative lives in the document tool. prisme holds only the link. */
  readonly externalPageId?: string | undefined;
}

export interface KeyResult {
  readonly id: KeyResultId;
  readonly objectiveId: ObjectiveId;
  readonly statement: string;
  readonly target: number;
  readonly unit: string;
  /** 0–100, set by hand, by judgement. The primary measure. */
  readonly progressSelf: number;
  readonly externalAnchorId?: string | undefined;
  /** Initiatives that serve this key result. */
  readonly servedBy: readonly InitiativeId[];
}

/** Append-only, so a trend exists rather than a single current number. */
export interface KeyResultMeasurement {
  readonly keyResultId: KeyResultId;
  readonly observedAt: Date;
  readonly value: number;
  readonly note?: string | undefined;
}

export const objectiveSchema: z.ZodType<Objective> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(OBJECTIVE_TYPES),
  period: z.string().regex(/^\d{4}(-\d{2})?$/, 'expected YYYY or YYYY-MM'),
  areaKey: z.string().min(1),
  status: z.enum(OBJECTIVE_STATUSES),
  externalPageId: z.string().min(1).optional(),
});

export const keyResultSchema: z.ZodType<KeyResult> = z.object({
  id: z.string().min(1),
  objectiveId: z.string().min(1),
  statement: z.string().min(1),
  target: z.number(),
  unit: z.string().min(1),
  progressSelf: z.number().min(0).max(100),
  externalAnchorId: z.string().min(1).optional(),
  servedBy: z.array(z.string().min(1)).readonly(),
});

/**
 * The objective a period names, when it names exactly one.
 *
 * An objectives page adopted from the document tool brings its period with it
 * — the store's date column, chosen on Settings → Notion — and the objective's
 * `type` and `period` are read off it rather than asked for (ADR-0033, amended
 * 2026-09-28). The rule is exact on purpose: a whole calendar year is
 * `annual`, a whole calendar month is `monthly`, and anything else — a quarter,
 * a fortnight, a year that starts in March, no dates at all — is `undefined`,
 * so adoption refuses it rather than rounding it to the nearest shape.
 */
export function objectivePeriodOf(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): { readonly type: ObjectiveType; readonly period: string } | undefined {
  if (startsOn === null || startsOn === undefined || endsOn === null || endsOn === undefined) {
    return undefined;
  }
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn)) return undefined;

  const year = startsOn.slice(0, 4);
  if (startsOn === `${year}-01-01` && endsOn === `${year}-12-31`) {
    return { type: 'annual', period: year };
  }

  const month = startsOn.slice(0, 7);
  if (startsOn === `${month}-01` && endsOn === `${month}-${lastDayOfMonth(month)}`) {
    return { type: 'monthly', period: month };
  }

  return undefined;
}

/**
 * Whether a period is written the way its type says: `YYYY` for an annual
 * objective, `YYYY-MM` (month 01–12) for a monthly one.
 */
export function periodMatchesType(type: ObjectiveType, period: string): boolean {
  if (type === 'annual') return /^\d{4}$/.test(period);
  if (!/^\d{4}-\d{2}$/.test(period)) return false;
  const month = Number(period.slice(5, 7));
  return month >= 1 && month <= 12;
}

/**
 * The calendar days an objective's period covers — the inverse of
 * {@link objectivePeriodOf}, and what an objectives page's date column is set
 * to when the objective is linked to one (ADR-0034): `2027` is 2027-01-01 to
 * 2027-12-31, `2027-02` is 2027-02-01 to 2027-02-28. `undefined` when the
 * period is not written the way its type says, rather than a guess.
 */
export function objectiveDatesOf(
  type: ObjectiveType,
  period: string,
): { readonly startsOn: CalendarDate; readonly endsOn: CalendarDate } | undefined {
  if (!periodMatchesType(type, period)) return undefined;
  if (type === 'annual') {
    return {
      startsOn: `${period}-01-01` as CalendarDate,
      endsOn: `${period}-12-31` as CalendarDate,
    };
  }
  return {
    startsOn: `${period}-01` as CalendarDate,
    endsOn: `${period}-${lastDayOfMonth(period)}` as CalendarDate,
  };
}

/**
 * The status an objective adopted from its page starts in (ADR-0033, amended
 * 2026-09-28): `draft` while its period has not started on `today`, and
 * `active` once it has — a period already over included, which a review
 * judges rather than adoption.
 *
 * An objective authored on the Objectives screen starts as `draft` too. A page
 * written ahead of its period is a plan, not work under way, and counting it
 * as active put it in every count and list of the current one. Nothing makes
 * it `active` later: that is a person's decision, made on its page.
 *
 * `today` is the instance's calendar day, `YYYY-MM-DD`.
 */
export function adoptedObjectiveStatus(
  type: ObjectiveType,
  period: string,
  today: string,
): 'draft' | 'active' {
  const dates = objectiveDatesOf(type, period);
  return dates !== undefined && dates.startsOn > today ? 'draft' : 'active';
}

/**
 * Whether an objective counts towards what a window from `from` to `to`
 * measures, both `YYYY-MM-DD` and inclusive (ADR-0035): its period overlaps
 * the window, and it was ever under way.
 *
 * A draft never was, so its attainment is nobody's result. A met, missed or
 * dropped objective was, and the review of its period is where that is read.
 * An objective for a period outside the window, next year's above all, has
 * nothing to report for it. A period that cannot be read does not count.
 */
export function objectiveCountsIn(
  objective: Pick<Objective, 'type' | 'period' | 'status'>,
  from: string,
  to: string,
): boolean {
  if (objective.status === 'draft') return false;
  const dates = objectiveDatesOf(objective.type, objective.period);
  if (dates === undefined) return false;
  return dates.startsOn <= to && dates.endsOn >= from;
}

/** `28` to `31`, for a `YYYY-MM`. Day 0 of the next month is the last of this one. */
function lastDayOfMonth(month: string): string {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return String(last.getUTCDate()).padStart(2, '0');
}

/**
 * Tasks done ÷ total, shown beside `progressSelf`. Derived, never written
 * outward. `undefined` when there is no breakdown to compute from — which is
 * honest, and different from zero.
 */
export function computeProgress(doneCount: number, totalCount: number): number | undefined {
  if (totalCount <= 0) return undefined;
  return (doneCount / totalCount) * 100;
}
