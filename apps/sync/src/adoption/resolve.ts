import { exactForm, normalise } from './normalise.js';
import { FUZZY_THRESHOLD, roundSimilarity, similarity } from './similarity.js';
import {
  RULE_CONFIDENCE,
  type Classification,
  type ExternalObject,
  type MatchTarget,
  type Proposal,
} from './types.js';

/**
 * Identity resolution — docs/13-migration.md §3, in its order.
 *
 * | # | Rule | Confidence | Action |
 * |---|---|---|---|
 * | 1 | Existing external-ID mapping | **certain** | Auto-link |
 * | 2 | Exact title match, same area, both open | high | Propose, pre-selected |
 * | 3 | Normalised title match | medium | Propose, not pre-selected |
 * | 4 | Fuzzy title similarity above threshold | low | Suggest, score visible |
 * | 5 | Anything else | none | Manual |
 *
 * "Each step only considers items the previous one did not resolve" — so this
 * returns the **first** rule that fires and stops. A later, weaker rule can
 * never overwrite an earlier, stronger one, which is why the rules are tried in
 * sequence here rather than scored and sorted.
 *
 * **Only rule 1 auto-applies.** Every other result is a proposal that a human
 * accepts, and `entity_link`'s `only_certainty_is_automatic` constraint is the
 * database's copy of that sentence — if this file ever returned an automatic
 * `high`, the insert would fail rather than the corruption succeed.
 */

export interface ResolveOptions {
  /** Rule 4's floor. Raising it is always safe; lowering it is a decision. */
  readonly fuzzyThreshold: number;
}

export const DEFAULT_RESOLVE_OPTIONS: ResolveOptions = { fuzzyThreshold: FUZZY_THRESHOLD };

/**
 * The targets one object may be matched against.
 *
 * Indexed once per scan rather than per object: a scan compares thousands of
 * external objects against hundreds of unbound entities, and rebuilding the
 * index inside the loop turns a linear pass into a quadratic one on the code
 * path a human is waiting at a terminal for.
 */
export interface TargetIndex {
  readonly all: readonly MatchTarget[];
  readonly byExact: ReadonlyMap<string, readonly MatchTarget[]>;
  readonly byNormalised: ReadonlyMap<string, readonly MatchTarget[]>;
  readonly byId: ReadonlyMap<string, MatchTarget>;
}

function push<K>(index: Map<K, MatchTarget[]>, key: K, target: MatchTarget): void {
  const existing = index.get(key);
  if (existing === undefined) index.set(key, [target]);
  else existing.push(target);
}

export function indexTargets(targets: readonly MatchTarget[]): TargetIndex {
  const byExact = new Map<string, MatchTarget[]>();
  const byNormalised = new Map<string, MatchTarget[]>();
  const byId = new Map<string, MatchTarget>();
  for (const target of targets) {
    push(byExact, exactForm(target.title), target);
    push(byNormalised, normalise(target.title), target);
    byId.set(target.prismeId, target);
  }
  return { all: targets, byExact, byNormalised, byId };
}

/**
 * Rules 2 and 3 both require **same area, both open**.
 *
 * The spec states it for rule 2; it holds for rule 3 too, because a weaker
 * title comparison needs more corroboration rather than less. An object with no
 * area matches only a target with no area — "unknown" is not a wildcard, and
 * treating it as one is how a title common to two areas gets bound to the wrong
 * one.
 */
function comparable(object: ExternalObject, target: MatchTarget): boolean {
  return object.areaKey === target.areaKey && object.closed === target.closed;
}

/**
 * Exactly one target, or nothing.
 *
 * An ambiguous match is **not** a match. Two unbound initiatives with the same
 * title in the same area is precisely the situation where picking one is a coin
 * toss recorded as a decision, so the object falls through to the manual
 * remainder and a human reads both.
 */
function theOnlyOne(
  candidates: readonly MatchTarget[] | undefined,
  object: ExternalObject,
  classification: Classification,
): MatchTarget | undefined {
  if (candidates === undefined) return undefined;
  const viable = candidates.filter(
    (target) => target.kind === classification.kind && comparable(object, target),
  );
  return viable.length === 1 ? viable[0] : undefined;
}

/**
 * Resolve one external object against the unbound prisme entities.
 *
 * Returns `undefined` for rule 5 — the manual remainder, which is the number
 * the coverage report exists to keep small.
 */
export function resolve(
  object: ExternalObject,
  classification: Classification,
  targets: TargetIndex,
  options: ResolveOptions = DEFAULT_RESOLVE_OPTIONS,
): Proposal | undefined {
  // Rule 1 — the mapping the workspace already carried (Guard 4). Certain, and
  // the only rule whose result a machine may apply on its own.
  const mapped = object.mappedPrismeId;
  if (mapped !== undefined && targets.byId.has(mapped)) {
    return {
      rule: 'existing_mapping',
      confidence: RULE_CONFIDENCE.existing_mapping,
      prismeId: mapped,
    };
  }

  // Rule 2 — exact title, same area, both open.
  const exact = theOnlyOne(targets.byExact.get(exactForm(object.title)), object, classification);
  if (exact !== undefined) {
    return {
      rule: 'exact_title',
      confidence: RULE_CONFIDENCE.exact_title,
      prismeId: exact.prismeId,
    };
  }

  // Rule 3 — case, accents, punctuation and leading numbering folded away.
  const relaxed = theOnlyOne(
    targets.byNormalised.get(normalise(object.title)),
    object,
    classification,
  );
  if (relaxed !== undefined) {
    return {
      rule: 'normalised_title',
      confidence: RULE_CONFIDENCE.normalised_title,
      prismeId: relaxed.prismeId,
    };
  }

  // Rule 4 — a suggestion with its score visible, never a link.
  const best = bestFuzzy(object, classification, targets, options.fuzzyThreshold);
  if (best !== undefined) {
    return {
      rule: 'fuzzy_title',
      confidence: RULE_CONFIDENCE.fuzzy_title,
      prismeId: best.target.prismeId,
      similarity: roundSimilarity(best.score),
    };
  }

  // Rule 5 — manual.
  return undefined;
}

interface Scored {
  readonly target: MatchTarget;
  readonly score: number;
}

/**
 * The single best fuzzy match above the threshold, or nothing.
 *
 * A tie is no match, for the same reason an ambiguous exact match is no match:
 * two targets the algorithm cannot separate are two targets a human must.
 */
function bestFuzzy(
  object: ExternalObject,
  classification: Classification,
  targets: TargetIndex,
  threshold: number,
): Scored | undefined {
  let best: Scored | undefined;
  let tied = false;

  for (const target of targets.all) {
    if (target.kind !== classification.kind) continue;
    if (!comparable(object, target)) continue;
    const score = similarity(object.title, target.title);
    if (score < threshold) continue;
    if (best === undefined || score > best.score) {
      best = { target, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }

  return tied ? undefined : best;
}
