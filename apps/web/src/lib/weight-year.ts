/**
 * Which year's weights a chart point is drawn against.
 *
 * ## The bug this file exists to prevent
 *
 * A historical chart rendered with *today's* weights makes history appear to
 * change retroactively. Last December's months were decided against last
 * year's allocation; re-drawing them against this year's moves every target
 * line under work that already happened, and an area that was on its agreed
 * share in November reads as starved in January because a decision taken in
 * the meantime was applied backwards.
 *
 * It destroys confidence in every other number on the page, and it is easy to
 * write by accident: one `weights` fetch, one target per area, applied to
 * every bucket. So the weights here are held **per year**, a bucket resolves
 * its year from its own start date, and there is deliberately no function that
 * takes a single set of weights and a series.
 *
 * This is ADR-0007 expressed as a lookup: a weight always arrives inside a
 * year, and there is no such thing as "the" current weight.
 *
 * ## Nothing here computes a balance factor
 *
 * Selecting which declared share to draw is not the same as measuring against
 * it. The balance factor is `packages/domain`'s, arrives on `/balance`, and is
 * never recomputed in this tier (`apps/web/CLAUDE.md` non-negotiable 1).
 */

/** The weights in force for one year, as `/areas/weights?year=` answers. */
export interface YearWeights {
  readonly year: number;
  /**
   * The year the weights were actually decided for. Null when no year at or
   * before this one has any — a first run, before the first Year Review.
   */
  readonly sourceYear: number | null;
  /** True when `sourceYear` is not `year`: carried forward, and said out loud. */
  readonly stale: boolean;
  readonly weights: ReadonlyMap<string, number>;
}

/** Keyed by the year asked for, not by `sourceYear`. */
export type WeightsByYear = ReadonlyMap<number, YearWeights>;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The calendar year a bucket label falls in.
 *
 * Parsed from the text rather than through `Date`: `new Date('2026-01-01')` is
 * midnight UTC, and in any timezone west of Greenwich `getFullYear()` on it
 * answers 2025. A year-boundary bug caused by reading the year is exactly the
 * kind this module exists to stop, so the year never goes near a clock.
 */
export function yearOf(calendarDate: string): number {
  const match = CALENDAR_DATE.exec(calendarDate);
  if (match?.[1] === undefined) {
    throw new Error(`A bucket label must be a calendar date, got ${JSON.stringify(calendarDate)}`);
  }
  return Number(match[1]);
}

/**
 * Every calendar year a range touches, ascending.
 *
 * This is what a KPI screen fetches weights for: one request per year, so a
 * chart spanning a boundary has both years' decisions in hand before it draws
 * a single point.
 */
export function yearsSpanned(from: string, to: string): readonly number[] {
  const first = yearOf(from);
  const last = yearOf(to);
  if (last < first) {
    throw new Error('A range ends after it starts');
  }

  const years: number[] = [];
  for (let year = first; year <= last; year += 1) years.push(year);
  return years;
}

/**
 * The declared share for one area at one bucket, or null when no year at or
 * before it has a decision to read.
 *
 * Null is not zero. An area with no weights yet has no agreed share, and
 * drawing that as a 0% target would say the decision was "nothing" rather than
 * "not taken" — which is the silence the year gate exists to remove.
 */
export function targetPctAt(
  periodStart: string,
  areaKey: string,
  byYear: WeightsByYear,
): number | null {
  return byYear.get(yearOf(periodStart))?.weights.get(areaKey) ?? null;
}

/**
 * The declared-share line for one area across a set of buckets.
 *
 * It **steps** at a year boundary rather than sloping into the new weight,
 * because that is what happened: a weight is fixed for a whole calendar year
 * and changes on the first of January by decision, not by drift.
 */
export function declaredSeries(
  labels: readonly string[],
  areaKey: string,
  byYear: WeightsByYear,
): readonly (number | null)[] {
  return labels.map((label) => targetPctAt(label, areaKey, byYear));
}

/**
 * True when any bucket on screen is drawn against carried-forward weights.
 *
 * The banner is driven from this rather than from the current year alone: a
 * twelve-month chart can reach back into a year that was never decided, and a
 * target line resting on a carried weight has to say so wherever it appears.
 */
export function anyStale(labels: readonly string[], byYear: WeightsByYear): boolean {
  return labels.some((label) => byYear.get(yearOf(label))?.stale ?? false);
}

/**
 * The distinct years on screen that carry weights **from an earlier year**,
 * with where each was carried from. Ascending, so the sentence reads in order.
 *
 * A year with no source year at all is deliberately **not** here. "Carried
 * from nowhere" is not a thing that can be said, and a caller that treats it
 * as one renders *"computed from 0's weights"* — which is what this did until
 * a three-year window reached back past the first weights that ever existed.
 * A year before prisme knew anything is not a gate that is open; there was
 * nothing to decide. Its charts simply draw no declared line, which they
 * already do.
 */
export function staleYears(
  labels: readonly string[],
  byYear: WeightsByYear,
): ReadonlyArray<{ readonly year: number; readonly carriedFrom: number }> {
  const seen = new Set<number>();
  const result: { year: number; carriedFrom: number }[] = [];

  for (const label of labels) {
    const year = yearOf(label);
    if (seen.has(year)) continue;
    seen.add(year);

    const weights = byYear.get(year);
    if (weights?.stale === true && weights.sourceYear !== null) {
      result.push({ year, carriedFrom: weights.sourceYear });
    }
  }

  return result.sort((a, b) => a.year - b.year);
}
