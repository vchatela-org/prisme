import type { ScanResult } from './queue.js';
import { unresolved } from './queue.js';
import type { Origin } from '@prisme/domain';
import type { CandidateKind } from './types.js';

/**
 * The verification tooling — W12 scope item 7.
 *
 * "A command that reports link coverage, unresolved candidates, and any entity
 * that would produce a `create`."
 *
 * The third of those is the one that matters on the day the write freeze is
 * lifted. Guard 2 (ADR-0010) says the planner emits a `create` **only** for
 * `origin = 'created_in_prisme' AND external_ref IS NULL`. This module applies
 * exactly that predicate, from the outside, to every entity prisme holds — so
 * the number a human reads before step 8 is derived from the same rule the
 * planner uses rather than from a second implementation that could agree by
 * luck.
 *
 * It is an **audit, not a gate**. It reports; `apply` refuses. A check that
 * both measures and enforces is one that can be satisfied by weakening itself.
 */

/**
 * An entity as the audit sees it: provenance, and whether it is bound.
 *
 * **Only entities that carry an `origin` column can appear here** — today,
 * initiatives and projects. A key result or a ritual has no provenance because
 * nothing creates one outward, so it cannot satisfy guard 2's predicate and
 * has nothing for this audit to say. Giving it a fabricated origin to make the
 * table look complete would produce a create count derived from a value nobody
 * set, which is worse than a narrower number that is true.
 */
export interface AuditableEntity {
  readonly prismeId: string;
  readonly kind: CandidateKind;
  readonly origin: Origin;
  readonly bound: boolean;
}

export interface CreateRisk {
  readonly prismeId: string;
  readonly kind: CandidateKind;
  /** Why this one would produce a create, in the predicate's own terms. */
  readonly because: string;
}

export interface CoverageReport {
  /** Entities prisme holds, by provenance. */
  readonly entities: {
    readonly total: number;
    readonly adopted: number;
    readonly createdInPrisme: number;
    readonly bound: number;
    readonly unbound: number;
  };
  /** `bound / total`, as a percentage rounded to one decimal. 100 is the goal. */
  readonly linkCoveragePct: number;
  /**
   * Adopted entities that are **not** bound to anything.
   *
   * Not a create risk — guard 2 excludes them by origin — but a real finding:
   * an adopted entity with no external object is an adoption that lost its
   * subject, and it will sit in the model doing nothing forever.
   */
  readonly adoptedWithoutRef: readonly string[];
  /**
   * Every entity that satisfies guard 2's create predicate.
   *
   * **During adoption this must be empty.** A non-empty list here with the
   * threshold at 0 means `apply` will stop, which is the design working — but
   * it is better read here, before the run, than in a refusal afterwards.
   */
  readonly wouldCreate: readonly CreateRisk[];
  /** The queue, as the scan left it. */
  readonly queue: {
    readonly total: number;
    readonly autoLinkable: number;
    readonly manualRemainder: number;
    readonly byKind: Readonly<Record<string, number>>;
  };
  readonly leftInPlace: Readonly<Record<CandidateKind, number>>;
}

function percentage(part: number, whole: number): number {
  if (whole === 0) return 100;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Guard 2's predicate, written once.
 *
 * An adopted entity cannot produce a create — not "should not". This function
 * returning anything for an `adopted` entity would mean the guard has a hole,
 * and `coverage.test.ts` asserts exhaustively that it never does.
 */
export function wouldProduceCreate(entity: AuditableEntity): CreateRisk | undefined {
  if (entity.origin !== 'created_in_prisme') return undefined;
  if (entity.bound) return undefined;
  return {
    prismeId: entity.prismeId,
    kind: entity.kind,
    because: "origin is 'created_in_prisme' and no external reference is bound",
  };
}

export function coverage(entities: readonly AuditableEntity[], result: ScanResult): CoverageReport {
  const adopted = entities.filter((entity) => entity.origin === 'adopted');
  const bound = entities.filter((entity) => entity.bound);
  const wouldCreate = entities
    .map(wouldProduceCreate)
    .filter((risk): risk is CreateRisk => risk !== undefined);

  const byKind: Record<string, number> = {};
  for (const candidate of result.queue) {
    byKind[candidate.classification.kind] = (byKind[candidate.classification.kind] ?? 0) + 1;
  }

  return {
    entities: {
      total: entities.length,
      adopted: adopted.length,
      createdInPrisme: entities.length - adopted.length,
      bound: bound.length,
      unbound: entities.length - bound.length,
    },
    linkCoveragePct: percentage(bound.length, entities.length),
    adoptedWithoutRef: adopted
      .filter((entity) => !entity.bound)
      .map((entity) => entity.prismeId)
      .sort(),
    wouldCreate,
    queue: {
      total: result.queue.length,
      autoLinkable: result.autoLinkable.length,
      manualRemainder: unresolved(result).length,
      byKind,
    },
    leftInPlace: result.leftInPlace,
  };
}
