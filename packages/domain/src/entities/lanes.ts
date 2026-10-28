import { z } from 'zod';
import type { AreaKey } from './area.js';
import { parseCalendarDate, type CalendarDate } from './calendar.js';
import type { InitiativeId } from './initiative.js';

/**
 * The lanes that are deliberately outside the ranked backlog (ADR-0014), plus
 * the reading pipeline that feeds it.
 *
 * Keeping these out of the backlog is what stops the backlog from being noise.
 * A habit task is never "done", so it either recurs forever or is closed
 * dishonestly — adherence is the measure that reflects it.
 */

export type TakeawayId = string;
export type RitualId = string;

/**
 * A takeaway is owned outright by the document tool; prisme mirrors it and
 * applies exactly one rule (docs/10-model.md §8).
 *
 * - `principle` never enters the backlog. It surfaces as context during the
 *   review of its area.
 * - `action` is a *candidate* initiative, landing in the Inbox for promotion.
 *
 * Promotion links; it does not copy the text and does not modify the takeaway.
 */
export type TakeawayKind = 'principle' | 'action';

export const TAKEAWAY_KINDS = ['principle', 'action'] as const;

export interface Takeaway {
  readonly id: TakeawayId;
  readonly kind: TakeawayKind;
  readonly externalPageId: string;
  readonly areaKey?: AreaKey | undefined;
  /** Set when this takeaway has been promoted. The takeaway itself is untouched. */
  readonly promotedTo?: InitiativeId | undefined;
}

export function mayEnterBacklog(takeaway: Takeaway): boolean {
  return takeaway.kind === 'action';
}

export type RitualCadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const RITUAL_CADENCES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;

export interface Ritual {
  readonly id: RitualId;
  readonly name: string;
  readonly areaKey: AreaKey;
  readonly cadence: RitualCadence;
  /** The share of opportunities you intend to take, 0–100. */
  readonly targetAdherencePct: number;
  readonly externalPageId?: string | undefined;
  /** Closing a review session of its cadence is its completion (S3). */
  readonly fulfilledByReview?: boolean | undefined;
}

/** The metric neither external tool provides. prisme owns this series outright. */
export interface RitualAdherence {
  readonly ritualId: RitualId;
  readonly periodStart: Date;
  readonly opportunities: number;
  readonly completions: number;
}

/**
 * How many chances a period of this cadence offers.
 *
 * | Cadence | Period | Opportunities |
 * |---|---|---|
 * | `daily` | the week (Monday, UTC) | 7 — one per day |
 * | `weekly` | the week (Monday, UTC) | 1 |
 * | `monthly`, `quarterly`, `yearly` | the calendar month, quarter or year | 1 |
 *
 * A daily habit is counted over a week rather than a day: a daily period would
 * make every row a 0 or a 100, which measures nothing anyone can read.
 */
export function ritualOpportunities(cadence: RitualCadence): number {
  return cadence === 'daily' ? 7 : 1;
}

/** The adherence period an instant falls in, for one cadence, and what it offers. */
export interface RitualPeriod {
  readonly periodStart: CalendarDate;
  readonly opportunities: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * The period `at` falls in — the key `ritual_adherence` is stored under.
 *
 * In UTC, like every other bucketing of completions: two answers to "which
 * week is this" are two different charts. The backfill reconstructs periods
 * with this, and *done this period* on Rituals records into the one it names,
 * so a habit counted by hand and one counted from its task land in the same
 * rows.
 */
export function ritualPeriodOf(cadence: RitualCadence, at: Date): RitualPeriod {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  let start: Date;
  if (cadence === 'monthly') start = new Date(Date.UTC(year, month, 1));
  else if (cadence === 'quarterly') start = new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1));
  else if (cadence === 'yearly') start = new Date(Date.UTC(year, 0, 1));
  else {
    const day = Date.UTC(year, month, at.getUTCDate());
    // getUTCDay: 0 is Sunday, so Sunday steps back six days rather than none.
    start = new Date(day - ((at.getUTCDay() + 6) % 7) * MS_PER_DAY);
  }
  return {
    periodStart: parseCalendarDate(start.toISOString().slice(0, 10)),
    opportunities: ritualOpportunities(cadence),
  };
}

/**
 * What tying a task to a ritual does, given the task it already has (S2).
 *
 * A ritual is measured from **one** recurring task's completions. Linking the
 * task it already has changes nothing; linking another is refused rather than
 * settled either way, the rule `ritualPageLink` applies to the process page:
 * replacing the task would undo a choice made on Rituals, and keeping it would
 * record a link the ritual does not honour. Rituals is where it is changed.
 */
export type RitualTaskLink = 'attach' | 'already' | 'other_task';

export function ritualTaskLink(
  heldTaskId: string | undefined,
  linkedTaskId: string,
): RitualTaskLink {
  if (heldTaskId === undefined) return 'attach';
  return heldTaskId === linkedTaskId ? 'already' : 'other_task';
}

/**
 * What a ritual's adherence is measured from (S3).
 *
 * - `task` — the completions of its recurring task, rewritten by the capacity
 *   refresh (S2).
 * - `review` — closing a prisme review session of the ritual's own cadence: the
 *   weekly review *is* the weekly-review ritual, so its completion is the close.
 * - `hand` — *done this period* on Rituals, for a habit that is neither.
 *
 * One source each. Two would write the same periods from two places, and the
 * last writer would win without anyone seeing which.
 */
export type RitualMeasure = 'task' | 'review' | 'hand';

export function ritualMeasure(ritual: {
  readonly externalTaskId?: string | null | undefined;
  readonly fulfilledByReview?: boolean | undefined;
}): RitualMeasure {
  if (ritual.externalTaskId !== undefined && ritual.externalTaskId !== null) return 'task';
  return ritual.fulfilledByReview === true ? 'review' : 'hand';
}

/**
 * Whether a review cadence comes round as often as this ritual does (S3).
 *
 * Reviews are weekly, monthly, quarterly and yearly — the ritual cadences bar
 * one. A daily ritual has no review to be fulfilled by: one close a week cannot
 * be seven chances taken.
 */
export function reviewCanFulfil(cadence: RitualCadence): boolean {
  return cadence !== 'daily';
}

/** One period of a series, as `ritual_adherence` stores it. */
export interface RitualPeriodRow {
  readonly periodStart: CalendarDate;
  readonly opportunities: number;
  readonly completions: number;
}

function nextPeriodStart(cadence: RitualCadence, start: CalendarDate): CalendarDate {
  const at = new Date(`${start}T00:00:00Z`);
  const months = cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12;
  const next =
    cadence === 'daily' || cadence === 'weekly'
      ? new Date(at.getTime() + 7 * MS_PER_DAY)
      : new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + months, 1));
  return parseCalendarDate(next.toISOString().slice(0, 10));
}

/**
 * The adherence series of a ritual fulfilled by its review, from the instants
 * the sessions of that cadence were closed (S3).
 *
 * The **whole** series, every time: it starts at the period of the first close
 * and runs to today's, one opportunity each, done when a session was closed in
 * it. Rebuilt in full rather than incremented, so a close whose write was lost
 * is healed by the next one — level-triggered, like every other derivation.
 *
 * - A period with no close is a **zero**, not a gap: a week the review was
 *   skipped is the observation.
 * - Today's period is emitted only once it is done. It is not over, and a
 *   review that has not come round yet must not read as a missed one.
 * - Two closes in one period are still one completion.
 * - Nothing before the first close is emitted, so periods recorded by hand
 *   before the ritual was fulfilled by its review keep what they recorded.
 */
export function reviewAdherence(
  cadence: RitualCadence,
  closedAt: readonly Date[],
  now: Date,
): readonly RitualPeriodRow[] {
  if (!reviewCanFulfil(cadence)) return [];
  const current = ritualPeriodOf(cadence, now).periodStart;
  const done = new Set<string>(
    closedAt
      .filter((at) => at.getTime() <= now.getTime())
      .map((at) => ritualPeriodOf(cadence, at).periodStart),
  );
  const first = [...done].sort()[0];
  if (first === undefined) return [];

  const rows: RitualPeriodRow[] = [];
  let cursor = parseCalendarDate(first);
  while (cursor < current) {
    rows.push({ periodStart: cursor, opportunities: 1, completions: done.has(cursor) ? 1 : 0 });
    cursor = nextPeriodStart(cadence, cursor);
  }
  if (done.has(current)) rows.push({ periodStart: current, opportunities: 1, completions: 1 });
  return rows;
}

export function adherencePct(observation: RitualAdherence): number | undefined {
  if (observation.opportunities <= 0) return undefined;
  return (observation.completions / observation.opportunities) * 100;
}

export const takeawaySchema: z.ZodType<Takeaway> = z.object({
  id: z.string().min(1),
  kind: z.enum(TAKEAWAY_KINDS),
  externalPageId: z.string().min(1),
  areaKey: z.string().min(1).optional(),
  promotedTo: z.string().min(1).optional(),
});

export const ritualSchema: z.ZodType<Ritual> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  areaKey: z.string().min(1),
  cadence: z.enum(RITUAL_CADENCES),
  targetAdherencePct: z.number().min(0).max(100),
  externalPageId: z.string().min(1).optional(),
  fulfilledByReview: z.boolean().optional(),
});
