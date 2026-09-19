/**
 * When the Year Review unlocks, and what a valid set of weights looks like.
 *
 * ## The gate, restated
 *
 * ADR-0007: weights are fixed for a calendar year, decided at the yearly
 * review, **read-only in the UI in between**. A year with no weights does not
 * silently inherit — balance factors are marked stale, the banner stays up,
 * and this surface unlocks until the decision is actually taken.
 *
 * So the rule here is the ADR's, literally: **entry is offered for a year that
 * has no weights of its own, and for no other year.** A year already decided
 * is shown read-only with the reason, because the rigidity *is* the mechanism
 * — a weight you can adjust in the moment is one that will be adjusted to
 * match whatever you already did, and then the only reference point the system
 * has is gone.
 *
 * There are exactly two such years a reader can be looking at: the current one
 * if it was never decided (overdue — the gate is holding right now), and
 * otherwise the next one (due at the year's end). Nothing further out is
 * offered: deciding 2029 in 2026 is not a review, it is a guess.
 */

export type ReviewStance =
  /** The year under way has no weights. Every balance factor on screen is carried. */
  | 'overdue'
  /** The year under way is decided; the next one is not. The review is ahead. */
  | 'ahead';

export interface ReviewTarget {
  /** The year whose weights this screen writes. */
  readonly year: number;
  /** The year whose evidence this screen reads — always the one before it. */
  readonly reviewing: number;
  readonly stance: ReviewStance;
}

/**
 * Which year the review decides, and which one it looks back at.
 *
 * `decided` answers whether a year has weights **of its own** — not whether it
 * has weights at all, which every year does once one exists anywhere before
 * it. That distinction is the whole of the year gate.
 */
export function reviewTarget(
  currentYear: number,
  decided: (year: number) => boolean,
): ReviewTarget {
  if (!decided(currentYear)) {
    return { year: currentYear, reviewing: currentYear - 1, stance: 'overdue' };
  }
  return { year: currentYear + 1, reviewing: currentYear, stance: 'ahead' };
}

export interface WeightEntry {
  readonly areaKey: string;
  readonly name: string;
  /** What the reader has typed, as a percentage. */
  readonly weightPct: number;
  /** The same area's weight in the year being reviewed, for comparison. */
  readonly previousPct: number | null;
  /** What that area actually received over the year being reviewed. */
  readonly observedPct: number | null;
}

export interface WeightsVerdict {
  readonly sumPct: number;
  readonly complete: boolean;
  /** Ready to submit. False blocks the button and names why. */
  readonly valid: boolean;
  readonly problems: readonly string[];
}

/** Capacity is one person's year. The shares of it add up to it. */
export const REQUIRED_SUM_PCT = 100;

/**
 * Whether a set of entered weights can be submitted.
 *
 * This one **refuses** rather than warns, which is the opposite of how the
 * status guardrails behave (`./guardrails.ts`), and the difference is worth
 * being explicit about. A guardrail warns because it is commenting on an
 * observation, and a model that refuses to describe reality stops being used.
 * A weight is not an observation — it is a definition of how one capacity is
 * split. A split that does not add up to the capacity makes every
 * `targetSharePct` derived from it meaningless, and every balance factor with
 * it. There is no reality here for the refusal to be wrong about.
 *
 * The running total is shown live, so this is never a surprise at submit time.
 */
export function verdictFor(entries: readonly WeightEntry[]): WeightsVerdict {
  const problems: string[] = [];

  const sumPct = entries.reduce((total, entry) => total + entry.weightPct, 0);
  const complete = entries.every((entry) => Number.isFinite(entry.weightPct));

  if (entries.length === 0) {
    problems.push('There are no rankable areas to allocate between.');
  }

  for (const entry of entries) {
    if (!Number.isFinite(entry.weightPct) || entry.weightPct < 0 || entry.weightPct > 100) {
      problems.push(`${entry.name} needs a share between 0 and 100.`);
    }
  }

  // Compared on a rounded total: the inputs are whole percentages, and a
  // floating-point sum of six of them should not be what blocks a decision.
  if (Math.round(sumPct) !== REQUIRED_SUM_PCT) {
    problems.push(
      `The shares add up to ${sumPct.toFixed(0)}%, not ${String(REQUIRED_SUM_PCT)}%. ` +
        `They are shares of one person's capacity, so they have to account for all of it.`,
    );
  }

  return { sumPct, complete, valid: problems.length === 0, problems };
}

/**
 * How far an entered weight moves from the year being reviewed.
 *
 * Shown beside each input so the decision is made against what was decided
 * last time as well as against what happened — a weight that has drifted three
 * years running toward whatever the observed share was is the rationalisation
 * ADR-0007 exists to prevent, and it is only visible if the previous number is
 * on screen.
 */
export function driftPct(entry: WeightEntry): number | null {
  if (entry.previousPct === null) return null;
  return entry.weightPct - entry.previousPct;
}

/**
 * True when an entered weight has moved toward what the area actually got.
 *
 * Not an error, and deliberately not blocked — sometimes last year's
 * allocation was simply wrong. It is surfaced as a question, once, next to the
 * areas it applies to.
 */
export function movedTowardObserved(entry: WeightEntry): boolean {
  if (entry.previousPct === null || entry.observedPct === null) return false;
  if (entry.weightPct === entry.previousPct) return false;

  const gapBefore = Math.abs(entry.previousPct - entry.observedPct);
  const gapAfter = Math.abs(entry.weightPct - entry.observedPct);
  return gapAfter < gapBefore;
}
