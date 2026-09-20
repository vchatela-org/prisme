/**
 * What the objectives screens decide, as pure functions.
 *
 * Nothing here computes progress. `progressSelf` is set by hand and
 * `progressComputed` arrives from the API; what this module does is put the
 * two beside each other and say what their *gap* means — which is the whole
 * of ADR-0013. The one thing it must never do is reconcile them: an average
 * of a judgement and a task count is a number with no referent, and it
 * destroys the only signal the pair carries.
 *
 * ## Why the thresholds live here and not in `packages/domain`
 *
 * `apps/web/CLAUDE.md` non-negotiable 1 is about scores, dates and balance
 * factors — values the domain owns, that are stored, and that two tiers can
 * disagree about. None of these numbers is any of those. "Material", "low"
 * and "late" decide whether a sentence is shown; they change no stored value,
 * they are not read back by anything, and moving one moves nothing but the
 * wording on a screen. Putting a display threshold in the domain package
 * would make `packages/domain` describe a rendering decision, which is the
 * mistake in the other direction.
 *
 * They are named constants rather than literals precisely so a reader can see
 * that they were chosen, and argue with them.
 */

import type { KeyResult, Objective } from './contracts';

/**
 * How far the two numbers must be apart before the gap is worth a sentence.
 *
 * ADR-0013 says "where the two diverge materially" and does not put a number
 * on it, because there is not a principled one. Twenty points is a fifth of
 * the scale: wide enough that rounding, a stale breakdown or a single closed
 * task cannot produce it, narrow enough to catch the pattern the ADR is about
 * before the period ends.
 */
export const MATERIAL_GAP_PCT = 20;

/** Below this, on both numbers at once, an objective is not moving. */
export const LOW_PROGRESS_PCT = 30;

/** How much of the period has to be gone before "still low" is a finding. */
export const LATE_IN_PERIOD_PCT = 75;

export type DivergencePattern =
  /** self ≪ computed — the tasks were the wrong tasks. */
  | 'activity_without_progress'
  /** self ≫ computed — progress came from outside, or the breakdown is stale. */
  | 'progress_outside_tracked_work'
  /** Both low, late in the period. */
  | 'at_risk';

export interface DivergenceFinding {
  readonly pattern: DivergencePattern;
  /** The sentence to show. One reading, in prisme's vocabulary, never a number. */
  readonly reading: string;
}

export interface Divergence {
  /** `progressSelf − progressComputed`, or null when there is nothing to compare. */
  readonly gapPct: number | null;
  readonly material: boolean;
  /**
   * Every reading that applies, not the strongest one.
   *
   * A key result can be both diverging and at risk, and picking one to show
   * would hide the other at exactly the review where both matter.
   */
  readonly findings: readonly DivergenceFinding[];
}

/**
 * What the pair of numbers says about one key result.
 *
 * `elapsedPct` is how far through its objective's period the key result is,
 * which is the only reason the third row of the ADR's table can be evaluated
 * at all: "both low" is unremarkable in week one and is the finding of the
 * review in week fifty.
 *
 * A null `progressComputed` produces no divergence and no gap — not a gap of
 * `progressSelf`. There being no breakdown to compute from is a different
 * fact from a breakdown that shows nothing done, and treating the first as
 * zero invents a divergence that says something false about the work.
 */
export function divergenceOf(keyResult: KeyResult, elapsedPct: number): Divergence {
  const findings: DivergenceFinding[] = [];
  const computed = keyResult.progressComputed;
  const gapPct = computed === null ? null : keyResult.progressSelf - computed;
  const material = gapPct !== null && Math.abs(gapPct) >= MATERIAL_GAP_PCT;

  if (gapPct !== null && material) {
    findings.push(
      gapPct < 0
        ? {
            pattern: 'activity_without_progress',
            reading:
              'Most of the breakdown is closed and little of it felt like progress. That usually means the tasks were the wrong tasks — worth re-cutting the work rather than re-judging the number.',
          }
        : {
            pattern: 'progress_outside_tracked_work',
            reading:
              'Progress came from outside the tracked work, or the breakdown beneath the anchor is stale. Both are worth a minute: the second is fixable here, the first is worth knowing about.',
          },
    );
  }

  const bothLow =
    keyResult.progressSelf < LOW_PROGRESS_PCT &&
    computed !== null &&
    computed < LOW_PROGRESS_PCT &&
    elapsedPct >= LATE_IN_PERIOD_PCT;

  if (bothLow) {
    findings.push({
      pattern: 'at_risk',
      reading:
        'Both numbers are low and most of the period is gone. Nothing here is wrong; this is the honest reading, and the decision it asks for is whether to carry this or let it go.',
    });
  }

  return { gapPct, material, findings };
}

/**
 * How much of a period has passed, as a percentage.
 *
 * Integer UTC days throughout, the way `packages/domain`'s schedule engine
 * does it — a calendar period compared with a wall clock is a timezone bug
 * waiting for the one day a year it can happen on. Clamped at both ends, so a
 * period not yet started reads 0 and a finished one reads 100.
 */
export function elapsedPctOf(period: string, today: string): number {
  const bounds = periodBounds(period);
  if (bounds === null) return 0;

  const now = dayNumber(today);
  if (now === null) return 0;

  if (now <= bounds.startDay) return 0;
  if (now >= bounds.endDay) return 100;

  const span = bounds.endDay - bounds.startDay;
  return ((now - bounds.startDay) / span) * 100;
}

interface PeriodBounds {
  readonly startDay: number;
  readonly endDay: number;
}

/** `YYYY` or `YYYY-MM` to the UTC day numbers of its first and last day. */
function periodBounds(period: string): PeriodBounds | null {
  const annual = /^(\d{4})$/.exec(period);
  if (annual !== null) {
    const year = Number(annual[1]);
    return { startDay: dayOf(year, 1, 1), endDay: dayOf(year, 12, 31) };
  }

  const monthly = /^(\d{4})-(\d{2})$/.exec(period);
  if (monthly === null) return null;

  const year = Number(monthly[1]);
  const month = Number(monthly[2]);
  if (month < 1 || month > 12) return null;

  // Day 0 of the following month is the last day of this one, which is how
  // February gets its length without a table or a library.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDay: dayOf(year, month, 1), endDay: dayOf(year, month, lastDay) };
}

const MS_PER_DAY = 86_400_000;

function dayOf(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** A `YYYY-MM-DD` string as a UTC day number, or null if it is not one. */
function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  return dayOf(Number(match[1]), Number(match[2]), Number(match[3]));
}

export interface ObjectiveProgress {
  /** Mean `progressSelf` across the key results, or null when there are none. */
  readonly selfPct: number | null;
  /**
   * Mean `progressComputed` across the key results **that have one**.
   *
   * Key results with no breakdown are left out of the mean rather than
   * counted as zero, for the same reason `divergenceOf` refuses to: absent is
   * not zero. `computedFrom` says how many went into it, so a screen can say
   * "2 of 3" rather than implying the whole objective is covered.
   */
  readonly computedPct: number | null;
  readonly computedFrom: number;
  readonly keyResultCount: number;
}

/**
 * An objective's two numbers, rolled up from its key results.
 *
 * An unweighted mean, deliberately: a key result carries no weight in the
 * model, and inventing one here — by target, by task count, by anything —
 * would be this tier deciding which part of an objective matters, which is a
 * judgement the person doing the review is making anyway.
 */
export function objectiveProgress(objective: Objective): ObjectiveProgress {
  const keyResults = objective.keyResults;
  if (keyResults.length === 0) {
    return { selfPct: null, computedPct: null, computedFrom: 0, keyResultCount: 0 };
  }

  const selfSum = keyResults.reduce((total, keyResult) => total + keyResult.progressSelf, 0);
  const withComputed = keyResults.filter((keyResult) => keyResult.progressComputed !== null);
  const computedSum = withComputed.reduce(
    (total, keyResult) => total + (keyResult.progressComputed ?? 0),
    0,
  );

  return {
    selfPct: selfSum / keyResults.length,
    computedPct: withComputed.length === 0 ? null : computedSum / withComputed.length,
    computedFrom: withComputed.length,
    keyResultCount: keyResults.length,
  };
}

/**
 * Whether a key result looks like a habit rather than an outcome.
 *
 * ADR-0012 puts this distinction at authoring time and it is the one most
 * often skipped: a habit written as a key result is a task that is never
 * completed and an adherence measure nobody has. The signal is in the unit —
 * a rate (`sessions/week`, `per month`) is a cadence, and a cadence is a
 * Ritual.
 *
 * This **asks**, it never asserts, and nothing acts on it. A key result can
 * legitimately be measured in a rate; what cannot happen is the question
 * never being put. The screen shows it once, beside the key result, with the
 * reason.
 */
export function looksLikeAHabit(keyResult: KeyResult): boolean {
  const unit = keyResult.unit.toLowerCase();
  return /(\/|\bper\b|\ba\b)\s*(day|week|month|quarter|year)\b/.test(unit);
}

/**
 * Objectives with no work behind them.
 *
 * "Behind" means an initiative named in some key result's `servedBy` — the
 * only link the model has between an objective and the work (docs/10-model.md
 * §7). An objective with no key results at all is orphaned too, and is the
 * commonest case: it was written and never broken down.
 *
 * **Neither direction is automatically wrong**, which is why this returns a
 * list and not a warning count. An objective authored this morning has
 * nothing behind it and should not.
 */
export function orphanObjectives(objectives: readonly Objective[]): readonly Objective[] {
  return objectives.filter((objective) =>
    objective.keyResults.every((keyResult) => keyResult.servedBy.length === 0),
  );
}

/** Every initiative id named by any key result of any objective given. */
export function servedInitiativeIds(objectives: readonly Objective[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const objective of objectives) {
    for (const keyResult of objective.keyResults) {
      for (const initiativeId of keyResult.servedBy) ids.add(initiativeId);
    }
  }
  return ids;
}

export interface OrphanInitiative {
  readonly id: string;
  readonly title: string;
  readonly areaKey: string;
  readonly status: string;
}

/**
 * Initiatives serving no objective, in the other direction.
 *
 * The caller decides which initiatives are in the question — this does not.
 * Passing the whole backlog would report every piece of upkeep as an orphan,
 * which is true and useless; the screen asks about work that is in flight or
 * queued, because that is the work whose connection to an objective is worth
 * having an opinion about.
 */
export function orphanInitiatives(
  initiatives: readonly OrphanInitiative[],
  served: ReadonlySet<string>,
): readonly OrphanInitiative[] {
  return initiatives.filter((initiative) => !served.has(initiative.id));
}

export interface PeriodGroup {
  readonly period: string;
  readonly type: 'annual' | 'monthly';
  readonly objectives: readonly Objective[];
}

/**
 * Objectives grouped by period, most recent first, annual before monthly.
 *
 * Annual first within a date because an annual objective is the context a
 * monthly one is read against — a month's objectives make sense as steps
 * toward the year's, and reversing that ordering makes the page read as a
 * list of unrelated intentions.
 */
export function groupByPeriod(objectives: readonly Objective[]): readonly PeriodGroup[] {
  const groups = new Map<string, Objective[]>();
  for (const objective of objectives) {
    const existing = groups.get(objective.period);
    if (existing === undefined) groups.set(objective.period, [objective]);
    else existing.push(objective);
  }

  return [...groups.entries()]
    .map(([period, items]) => ({
      period,
      // A period is `YYYY` or `YYYY-MM`; its objectives all share the shape.
      type: period.includes('-') ? ('monthly' as const) : ('annual' as const),
      objectives: [...items].sort((left, right) => left.title.localeCompare(right.title)),
    }))
    .sort((left, right) => {
      const year = right.period.slice(0, 4).localeCompare(left.period.slice(0, 4));
      if (year !== 0) return year;
      if (left.type !== right.type) return left.type === 'annual' ? -1 : 1;
      return right.period.localeCompare(left.period);
    });
}

/** The month after the one `today` falls in, as a `YYYY-MM` period. */
export function nextMonthlyPeriod(today: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(today);
  if (match === null) return today;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${String(next.year)}-${String(next.month).padStart(2, '0')}`;
}

/** The period an objective of this type would be authored for today. */
export function currentPeriod(type: 'annual' | 'monthly', today: string): string {
  return type === 'annual' ? today.slice(0, 4) : today.slice(0, 7);
}
