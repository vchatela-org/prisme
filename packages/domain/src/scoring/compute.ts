import { InvariantError } from '../entities/errors.js';
import { type Initiative, isClosed } from '../entities/initiative.js';
import type {
  AreaScoringContext,
  InitiativeScoreRow,
  ScoredInitiative,
  ScoringMethod,
} from './types.js';

/**
 * Scoring, applied to a set of initiatives.
 *
 * Ranks, and nothing more. Selection is a separate step on purpose
 * (docs/12-scoring.md §5) — scoring answers "in what order", selection answers
 * "what now", and conflating them is how the top of a list thrashes every time
 * a score shifts.
 *
 * **Cross-area comparability comes from the balance factor and nowhere else.**
 * The ordering returned here is global because selection needs a queue to draw
 * from, but the merits of a home repair against a relationship goal were
 * settled once a year as a weight (ADR-0005), not inferred here.
 */

/**
 * Deterministic order: score descending, then cost of delay descending, then
 * the smaller next slice, then id. Ties are common on a Fibonacci scale, and an
 * unstable tie-break means a list that reshuffles between two identical runs.
 */
function compareScored(left: ScoredInitiative, right: ScoredInitiative): number {
  if (left.score !== right.score) return right.score - left.score;

  const leftCod = left.factors['costOfDelay'] ?? 0;
  const rightCod = right.factors['costOfDelay'] ?? 0;
  if (leftCod !== rightCod) return rightCod - leftCod;

  const leftSize = left.factors['size'] ?? 0;
  const rightSize = right.factors['size'] ?? 0;
  if (leftSize !== rightSize) return leftSize - rightSize;

  return left.initiativeId < right.initiativeId
    ? -1
    : left.initiativeId > right.initiativeId
      ? 1
      : 0;
}

export interface ComputeScoresOptions {
  /**
   * Score initiatives whose status is `done` or `dropped`. Off by default:
   * closed work has no ranking question left to answer. A backfill that needs
   * historical scores turns it on deliberately.
   */
  readonly includeClosed?: boolean | undefined;
}

/**
 * Scores every initiative whose area is present in `areas`, in the ranked lane.
 *
 * An initiative in an area with no context is an error rather than a silent
 * skip — a missing area context means the capacity computation did not see that
 * area, and quietly dropping the work hides it from every surface at once.
 * Lanes (Run, Signals) are simply not in `areas`, and that is how they stay out
 * of the ranking (ADR-0014).
 */
export function computeScores<Params>(
  initiatives: readonly Initiative[],
  areas: readonly AreaScoringContext[],
  method: ScoringMethod<Params>,
  params: Params,
  now: Date,
  options: ComputeScoresOptions = {},
): readonly ScoredInitiative[] {
  const parsedParams = method.paramsSchema.parse(params);

  const contextByKey = new Map<string, AreaScoringContext>();
  for (const area of areas) contextByKey.set(area.key, area);

  const scored: ScoredInitiative[] = [];

  for (const initiative of initiatives) {
    if (!options.includeClosed && isClosed(initiative)) continue;

    const area = contextByKey.get(initiative.areaKey);
    if (!area) continue;

    const result = method.score({ initiative, area, now }, parsedParams);

    if (!Number.isFinite(result.score)) {
      throw new InvariantError(
        'invalid_share',
        `scoring method "${method.id}" produced a non-finite score for ${initiative.id}`,
      );
    }

    scored.push({
      ...result,
      initiativeId: initiative.id,
      areaKey: initiative.areaKey,
      methodId: method.id,
      methodVersion: method.version,
    });
  }

  return scored.sort(compareScored);
}

/**
 * Turns results into `initiative_score` rows.
 *
 * Append-only, never a column on `initiative` — a score column loses the
 * history, and the history is the interesting part.
 */
export function toScoreRows(
  scored: readonly ScoredInitiative[],
  options: { readonly computedAt: Date; readonly activeMethodId: string },
): readonly InitiativeScoreRow[] {
  return scored.map((result) => ({
    initiativeId: result.initiativeId,
    methodId: result.methodId,
    methodVersion: result.methodVersion,
    score: result.score,
    factors: result.factors,
    explain: result.explain,
    computedAt: options.computedAt,
    isActiveMethod: result.methodId === options.activeMethodId,
  }));
}
