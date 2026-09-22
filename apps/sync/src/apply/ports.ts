import type { ExternalTask } from '@prisme/connectors';
import type { InitiativeId, InitiativeStatus, MatchConfidence, MatchRule } from '@prisme/domain';
import type {
  ConflictRecord,
  DesiredState,
  LastAppliedIndex,
  LastAppliedWrite,
  Rollup,
} from '../reconcile/types.js';

/**
 * Everything the reconciler needs from the outside, as interfaces.
 *
 * The planner is pure and the writer is one HTTP client; this file is the third
 * side — prisme's own database. Stating it as a port rather than importing
 * `@prisme/db` into the apply path means every test of the apply path runs
 * against an in-memory implementation, and the one implementation that speaks
 * SQL lives in `../state/` where it can be read on its own.
 */

/** Where the incremental read left off. All of it in PostgreSQL (ADR-0018). */
export interface SyncCursor {
  /** The task tool's opaque sync token. The next incremental read is only as good as this. */
  readonly taskToolToken?: string | undefined;
  /** The document tool's change-timestamp watermark, already overlapped by two minutes. */
  readonly docWatermark?: Date | undefined;
  readonly lastFullPassAt?: Date | undefined;
}

/**
 * What a pass did, kept so that something scrapeable can say so.
 *
 * The reconciler runs as a CronJob pod: no Service, no ServiceMonitor, alive
 * for seconds. Prometheus never scrapes it, so a gauge it sets in its own
 * process is a number nobody ever reads. The pass therefore records its outcome
 * in PostgreSQL — where ADR-0018 already puts every other piece of sync state —
 * and the long-lived API republishes it on `/metrics`.
 *
 * Written by `apply` passes only. A `plan` has no side effects, and recording
 * is one.
 */
export interface PassOutcome {
  /** When the pass finished. */
  readonly at: Date;
  /**
   * The pass was neither refused nor stopped part-way.
   *
   * The same definition `apps/sync/src/main.ts` already used for its in-process
   * gauge, kept deliberately: with the write freeze on, every pass is refused
   * and none is a success. An absent `prisme_sync_last_success_timestamp` is
   * the truthful reading of that, and a far better one than a zero.
   */
  readonly succeeded: boolean;
  /** Objects the full view found changed that the incremental stream missed. */
  readonly drift: number;
  readonly full: boolean;
}

export interface SyncEvent {
  readonly kind: 'sync_action' | 'status_changed' | 'adoption_decision';
  readonly entityKind: string;
  readonly entityId: string;
  readonly field?: string | undefined;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly occurredAt: Date;
}

export interface BindRefInput {
  readonly initiativeId: InitiativeId;
  readonly externalId: string;
  /**
   * The adoption decision behind the binding, when there is one. A create has
   * none: nothing was matched, prisme made the object.
   */
  readonly link?:
    | {
        readonly matchRule: MatchRule;
        readonly confidence: MatchConfidence;
        readonly decidedBy: 'auto' | 'human';
      }
    | undefined;
  readonly at: Date;
}

export interface CaptureInput {
  readonly externalId: string;
  readonly title: string;
  readonly areaKey: string;
  readonly at: Date;
}

export interface ReconcilerStore {
  loadDesired(): Promise<DesiredState>;
  loadLastApplied(): Promise<LastAppliedIndex>;
  loadCursor(): Promise<SyncCursor>;
  saveCursor(cursor: SyncCursor): Promise<void>;

  /** Binds an existing external object to an entity. **Creates nothing outward.** */
  bindExternalRef(input: BindRefInput): Promise<void>;
  /** The intent channel's capture: a prisme row for a task that already exists. */
  captureInitiative(input: CaptureInput): Promise<InitiativeId>;
  setStatus(input: {
    readonly initiativeId: InitiativeId;
    readonly from: InitiativeStatus;
    readonly to: InitiativeStatus;
    readonly at: Date;
  }): Promise<void>;
  /** The mirrored subtree and what prisme derives from it. Counted, never copied. */
  recordRollup(input: {
    readonly initiativeId: InitiativeId;
    readonly areaKey: string;
    readonly rollup: Rollup;
    readonly anchorTask: ExternalTask;
    readonly subtree: readonly ExternalTask[];
    readonly at: Date;
  }): Promise<void>;
  recordLastApplied(writes: readonly LastAppliedWrite[], at: Date): Promise<void>;
  recordConflict(conflict: ConflictRecord, at: Date): Promise<void>;
  recordEvent(event: SyncEvent): Promise<void>;
  /** The pass's own outcome, so `/metrics` on the API can republish it. */
  recordPassOutcome(outcome: PassOutcome): Promise<void>;
}
