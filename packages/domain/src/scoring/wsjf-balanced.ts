import { z } from 'zod';
import { daysUntil } from '../entities/calendar.js';
import { type Fibonacci, fibonacciSchema } from '../entities/fibonacci.js';
import { clamp } from '../util/clamp.js';
import type { ScoringInput, ScoringMethod, ScoringResult } from './types.js';

/**
 * `wsjf-balanced` — the method shipped first (docs/12-scoring.md §3).
 *
 * ```
 * cost_of_delay = value + time_criticality + risk
 * wsjf          = cost_of_delay / size
 * score         = wsjf × balance_factor
 * ```
 *
 * Three corrections over naive WSJF, each of them the fix for a failure the
 * previous system actually had:
 *
 * 1. **Urgency is counted once.** `value` is purely about outcome; decay lives
 *    only in `time_criticality`. Scoring urgency into both is why urgency
 *    always beat importance, which is the opposite of what anyone wants.
 * 2. **Enough resolution to rank.** The Fibonacci scale, not 1–4.
 * 3. **Size no longer decides everything.** `balance_factor` is the
 *    counterweight to dividing by size, which otherwise amplifies the very bias
 *    it was meant to correct.
 *
 * It is the first method, not the last. Everything here is reachable only
 * through the registry.
 */

export const WSJF_BALANCED_ID = 'wsjf-balanced';

export interface WsjfBalancedParams {
  /**
   * A deadline strictly nearer than this many days forces time criticality up.
   * Strictly less than — the boundary is pinned by a golden case, because an
   * off-by-one here silently changes every ranking.
   */
  readonly deadlineOverrideDays: number;
  readonly deadlineOverrideValue: Fibonacci;
  /** `[min, max]` for the balance factor. Bounds, not a suggestion. */
  readonly balanceClamp: readonly [number, number];
}

export const wsjfBalancedParamsSchema: z.ZodType<WsjfBalancedParams> = z.object({
  deadlineOverrideDays: z.number().int().positive(),
  deadlineOverrideValue: fibonacciSchema,
  balanceClamp: z
    .tuple([z.number().positive(), z.number().positive()])
    .refine(([min, max]) => min <= max, {
      message: 'balanceClamp must be [min, max] with min ≤ max',
    })
    .readonly(),
});

export const WSJF_BALANCED_DEFAULTS: WsjfBalancedParams = {
  deadlineOverrideDays: 14,
  deadlineOverrideValue: 13,
  balanceClamp: [0.5, 2],
};

function display(value: number): string {
  return value.toFixed(2);
}

function balancePhrase(factor: number): string {
  if (factor > 1) return `lifted ×${display(factor)} because the area is starved`;
  if (factor < 1) return `damped ×${display(factor)} because the area is over-served`;
  return `left at ×${display(factor)} because the area is on its agreed share`;
}

function deadlinePhrase(daysLeft: number, raisedTo: number): string {
  const when =
    daysLeft < 0
      ? `${String(Math.abs(daysLeft))} days overdue`
      : daysLeft === 0
        ? 'due today'
        : `${String(daysLeft)} days away`;
  return ` Time criticality was raised to ${String(raisedTo)} by a deadline ${when}.`;
}

function score(input: ScoringInput, params: WsjfBalancedParams): ScoringResult {
  const { initiative, area, now } = input;
  const [clampMin, clampMax] = params.balanceClamp;

  const daysLeft =
    initiative.deadline === undefined ? undefined : daysUntil(initiative.deadline, now);

  // `< days`, strictly. The override is a *floor* on time criticality, never a
  // demotion: with the shipped value of 13 the two readings coincide, and
  // taking the maximum is what keeps raising `time_criticality` from ever
  // lowering a score.
  const overrideApplies = daysLeft !== undefined && daysLeft < params.deadlineOverrideDays;
  const effectiveTimeCriticality = overrideApplies
    ? Math.max(initiative.timeCriticality, params.deadlineOverrideValue)
    : initiative.timeCriticality;

  const costOfDelay = initiative.value + effectiveTimeCriticality + initiative.risk;
  const wsjf = costOfDelay / initiative.size;
  const balanceFactor = clamp(area.balanceFactor, clampMin, clampMax);
  const scored = wsjf * balanceFactor;

  const factors: Record<string, number> = {
    value: initiative.value,
    timeCriticality: initiative.timeCriticality,
    effectiveTimeCriticality,
    risk: initiative.risk,
    size: initiative.size,
    costOfDelay,
    wsjf,
    balanceFactor,
  };
  if (daysLeft !== undefined) factors['daysUntilDeadline'] = daysLeft;

  const explain =
    `Cost of delay ${String(costOfDelay)} = value ${String(initiative.value)} + time criticality ` +
    `${String(effectiveTimeCriticality)} + risk ${String(initiative.risk)}; over size ` +
    `${String(initiative.size)} that is WSJF ${display(wsjf)}, ${balancePhrase(balanceFactor)}, ` +
    `giving ${display(scored)}.` +
    (overrideApplies && daysLeft !== undefined
      ? deadlinePhrase(daysLeft, effectiveTimeCriticality)
      : '');

  return { score: scored, factors, explain };
}

export const wsjfBalanced: ScoringMethod<WsjfBalancedParams> = {
  id: WSJF_BALANCED_ID,
  /**
   * **Bump on any behaviour change**, and the golden file in
   * `fixtures/scoring/` must move with it — `scripts/check-golden-fixtures.py`
   * fails the build when one moves without the other.
   */
  version: 1,
  paramsSchema: wsjfBalancedParamsSchema,
  defaultParams: WSJF_BALANCED_DEFAULTS,
  score,
};
