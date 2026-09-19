import type { AuditableEntity } from './coverage.js';
import type { Candidate, DecidedSet, MatchTarget } from './types.js';

/**
 * Everything the adoption scan needs from prisme's own database, as interfaces.
 *
 * Same reasoning as `apply/ports.ts`: the scan is decided in pure functions,
 * and stating the database as a port means the pass can be tested end to end
 * against an in-memory implementation, with the one that speaks SQL readable on
 * its own in `store.ts`.
 *
 * Note what is **absent**. There is no `adopt`, no `ignore` and no `link` here.
 * A scan proposes; it does not decide. The decisions arrive through the API,
 * from a human, and the only thing this port writes is the candidate mirror —
 * which is derived data that can be thrown away and rebuilt.
 */

export interface AdoptionStore {
  /**
   * The unbound prisme entities an external object might already be.
   *
   * Unbound only: an entity already carrying an `entity_external_ref` cannot be
   * the answer, because guard 1 would refuse the second binding at the database
   * and proposing it would be proposing a failure.
   */
  loadTargets(): Promise<readonly MatchTarget[]>;

  /** `entity_link` and `adoption_ignore` — what a human has already settled. */
  loadDecided(): Promise<DecidedSet>;

  /** Every entity, with its provenance, for the create audit. */
  loadAuditable(): Promise<readonly AuditableEntity[]>;

  /** `area_mapping` and each area's lane, for the adapter. */
  loadAreaMap(): Promise<{
    readonly areaByLocation: ReadonlyMap<string, string>;
    readonly laneByArea: ReadonlyMap<string, 'area' | 'run' | 'signals'>;
  }>;

  /**
   * Replace the candidate mirror with this scan's result.
   *
   * Wholesale, in one transaction, because it is level-triggered: the queue is
   * what the world looks like *now*, and a merge would leave rows describing
   * objects that no longer exist. A candidate for a deleted task is a question
   * nobody can answer.
   */
  replaceCandidates(candidates: readonly Candidate[], scannedAt: Date): Promise<void>;
}
