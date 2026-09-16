import type { z } from 'zod';
import type { AreaKey } from '../entities/area.js';
import type { Initiative, InitiativeId } from '../entities/initiative.js';

/**
 * The scoring contract (docs/12-scoring.md §2).
 *
 * Three hard rules, and they are the reason this is an interface rather than a
 * function in a file:
 *
 * - **Pure.** No I/O, no clock, no randomness. `now` is an input.
 * - **Versioned.** Any change to behaviour bumps `version`, so a historical
 *   score stays attributable to the method that produced it.
 * - **Explainable.** `factors` and `explain` are not optional. A ranking you
 *   cannot interrogate is a ranking you stop trusting the first time it
 *   surprises you — and then the whole system is decoration.
 */

/**
 * The area context a method scores against.
 *
 * `targetShare` and `actualShare` are **percentage points** of discretionary
 * capacity, not fractions — the same units as `area_weight.weight_pct`.
 */
export interface AreaScoringContext {
  readonly key: AreaKey;
  readonly targetShare: number;
  readonly actualShare: number;
  /** `clamp(targetShare / actualShare, 0.5, 2)`. Computed by `computeCapacity`. */
  readonly balanceFactor: number;
  /** True when the weights behind `targetShare` were carried from an earlier year. */
  readonly stale: boolean;
}

export interface ScoringInput {
  readonly initiative: Initiative;
  readonly area: AreaScoringContext;
  /** Injected — never call the clock inside a method. */
  readonly now: Date;
}

export interface ScoringResult {
  /** Higher ranks first. */
  readonly score: number;
  /** Every intermediate, for explainability. */
  readonly factors: Readonly<Record<string, number>>;
  /** One human sentence. */
  readonly explain: string;
}

export interface ScoringMethod<Params = unknown> {
  readonly id: string;
  /** Bump on ANY behaviour change. */
  readonly version: number;
  readonly paramsSchema: z.ZodType<Params>;
  /** The parameters shipped with the method, so a caller can score without settings. */
  readonly defaultParams: Params;

  score(input: ScoringInput, params: Params): ScoringResult;
}

/**
 * A result carrying the identity of what it scored. `computeScores` returns
 * these: a bare `ScoringResult` cannot be ranked, stored or explained to
 * anyone, because it does not say what it is about.
 */
export interface ScoredInitiative extends ScoringResult {
  readonly initiativeId: InitiativeId;
  readonly areaKey: AreaKey;
  readonly methodId: string;
  readonly methodVersion: number;
}

/**
 * One row of `initiative_score` (docs/12-scoring.md, *Storage*).
 *
 * **Append-only. Never a column on `initiative`.** Knowing an item ranks fourth
 * today is much less useful than knowing it ranked first for six weeks and was
 * never picked — which is a fact about you, not about the item.
 */
export interface InitiativeScoreRow {
  readonly initiativeId: InitiativeId;
  readonly methodId: string;
  readonly methodVersion: number;
  readonly score: number;
  readonly factors: Readonly<Record<string, number>>;
  readonly explain: string;
  readonly computedAt: Date;
  readonly isActiveMethod: boolean;
}
