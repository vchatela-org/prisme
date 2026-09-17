import type { ExternalTask } from '@prisme/connectors';
import type { AnchorDraft, TaskLocation, TaskPatch } from '@prisme/connectors/write';
import type {
  CalendarDate,
  InitiativeId,
  InitiativeStatus,
  LastApplied,
  Origin,
  TaskPriority,
} from '@prisme/domain';

/**
 * The vocabulary of a reconciler pass.
 *
 * Three inputs, one output, no I/O in between:
 *
 * ```
 * plan(desired, observed, lastApplied, config) → Plan
 * ```
 *
 * **Desired** is what prisme's database says the world should look like.
 * **Observed** is what the task tool says it does look like. **lastApplied** is
 * what prisme last wrote into fields it does not own, and is the only thing
 * that can tell "prisme changed its mind" apart from "someone edited this by
 * hand" (docs/16-sync.md §5).
 *
 * Nothing in this file has a clock, a connection or a random number. That is
 * what makes the difficult half of this application exhaustively testable —
 * every rule in docs/11-ownership.md is decided here, against JSON.
 */

/** Where prisme keeps its side of a value it wrote outward. */
export type LastAppliedIndex = ReadonlyMap<string, LastApplied>;

export function lastAppliedKey(entityKind: string, entityId: string, field: string): string {
  return `${entityKind}:${entityId}:${field}`;
}

/** The roll-up prisme derives from an anchor's subtree (docs/10-model.md §5, *Derived*). */
export interface Rollup {
  /** Completed descendants as a percentage of all descendants, 0–100. No subtasks means 0. */
  readonly progress: number;
  readonly openTaskCount: number;
  readonly lastActivity?: Date | undefined;
}

/**
 * One initiative, as prisme intends it to appear in the task tool.
 *
 * `origin` and `externalAnchorId` are here because guard 2 is decided from
 * them and nothing else: a `create` is emitted only for
 * `origin = 'created_in_prisme' AND externalAnchorId === undefined`
 * (ADR-0010).
 */
export interface DesiredAnchor {
  readonly initiativeId: InitiativeId;
  readonly title: string;
  readonly areaKey: string;
  readonly status: InitiativeStatus;
  readonly origin: Origin;
  readonly deadline?: CalendarDate | undefined;
  /** From the now-set: top 3 `now` → highest, rest → high, `next` → medium, else lowest. */
  readonly priority: TaskPriority;
  /** The anchor's project and section, from the initiative's project or its area mapping. */
  readonly location?: TaskLocation | undefined;
  /** The external task bound to this initiative — `entity_external_ref`. */
  readonly externalAnchorId?: string | undefined;
  /**
   * A link decided in the adoption queue and not yet bound. Produces an `adopt`,
   * which creates nothing (W12 writes these rows; W04 honours them).
   */
  readonly pendingExternalId?: string | undefined;
  /** What prisme currently believes about the subtree, from `task_mirror`. */
  readonly rollup?: Rollup | undefined;
}

export interface DesiredState {
  readonly anchors: readonly DesiredAnchor[];
  /**
   * `area_mapping`, keyed by {@link locationKey}. Many external locations fold
   * into one area; one location belongs to exactly one area.
   */
  readonly areaByLocation: ReadonlyMap<string, string>;
}

export function locationKey(projectId: string, sectionId?: string): string {
  return `${projectId}/${sectionId ?? ''}`;
}

/**
 * What the task tool reports.
 *
 * Every task prisme fetched: the anchors and their subtrees, at any depth. It
 * is deliberately the raw external view — no prisme identifier appears in it,
 * so the planner cannot accidentally read prisme's intent out of the tool's
 * answer.
 */
export interface ObservedState {
  readonly tasks: readonly ExternalTask[];
}

export type ActionTag = 'create' | 'adopt' | 'update' | 'skip' | 'review' | 'conflict';

export const ACTION_TAGS = ['create', 'adopt', 'update', 'skip', 'review', 'conflict'] as const;

/** What a plan line is about, for the plan's second column. */
export type Subject = 'anchor' | 'subtree' | 'initiative' | 'prisme';

/**
 * One executable step.
 *
 * `apply` knows how to perform each of these and nothing else. Two are
 * conspicuously missing — completing a task and deleting one — because prisme
 * does neither (docs/11-ownership.md §4).
 */
export type Operation =
  | {
      readonly type: 'create_anchor';
      readonly initiativeId: InitiativeId;
      readonly draft: AnchorDraft;
    }
  | {
      readonly type: 'update_task';
      readonly externalId: string;
      readonly patch: TaskPatch;
      readonly initiativeId?: InitiativeId | undefined;
    }
  | {
      readonly type: 'move_task';
      readonly externalId: string;
      readonly location: TaskLocation;
      readonly initiativeId: InitiativeId;
    }
  /** prisme-side only: bind an existing external object to an entity. Creates nothing. */
  | { readonly type: 'bind_ref'; readonly initiativeId: InitiativeId; readonly externalId: string }
  /** prisme-side only: the intent channel's "this labelled task is an initiative". */
  | {
      readonly type: 'capture_initiative';
      readonly externalId: string;
      readonly title: string;
      readonly areaKey: string;
    }
  | {
      readonly type: 'set_status';
      readonly initiativeId: InitiativeId;
      readonly from: InitiativeStatus;
      readonly to: InitiativeStatus;
    }
  /** prisme-side only: the mirrored subtree, from which progress and activity derive. */
  | {
      readonly type: 'record_rollup';
      readonly initiativeId: InitiativeId;
      /** Carried so the mirror can be counted per area for capacity actuals. */
      readonly areaKey: string;
      readonly rollup: Rollup;
      readonly anchorTask: ExternalTask;
      readonly subtree: readonly ExternalTask[];
    };

/** Bookkeeping that follows a successful write, decided by the planner. */
export interface LastAppliedWrite {
  readonly entityKind: string;
  readonly entityId: string;
  readonly field: string;
  readonly value: string | null;
}

/** A row for the conflict ledger. `detectedAt` is stamped by `apply`, which has a clock. */
export interface ConflictRecord {
  readonly entityId: string;
  readonly field: string;
  readonly prismeValue: string | null;
  readonly externalValue: string | null;
  readonly resolution: 'prisme_wins' | 'external_wins' | 'unresolved';
}

export interface Action {
  readonly tag: ActionTag;
  readonly subject: Subject;
  readonly initiativeId?: InitiativeId | undefined;
  readonly externalId?: string | undefined;
  /**
   * The human label for the line — a title, at runtime. **Instance data.**
   * It is printed to a console and never to this repository (docs/17-privacy.md).
   */
  readonly title: string;
  /** What changes, in prisme's vocabulary: `priority high → highest`. */
  readonly detail: string;
  /** Performed in order. Empty for a `skip` and for anything needing a human. */
  readonly operations: readonly Operation[];
  readonly lastApplied: readonly LastAppliedWrite[];
  readonly conflict?: ConflictRecord | undefined;
  /**
   * The values this action replaces, by field.
   *
   * The event log records before and after for every write, and that is what
   * makes "applied something wrong" recoverable: the log is replayed backwards
   * (docs/13-migration.md §7). A write whose previous value was never recorded
   * is a write that cannot be undone.
   */
  readonly before?: Readonly<Record<string, string | null>> | undefined;
}

export interface Plan {
  readonly actions: readonly Action[];
  readonly counts: Readonly<Record<ActionTag, number>>;
}

/** Everything the planner needs to know that is not state. */
export interface PlannerConfig {
  /** The label that marks an anchor. prisme owns it (docs/11-ownership.md §4). */
  readonly anchorLabel: string;
  /** Prefix of the intent channel's status-request labels: `<prefix><status>`. */
  readonly statusRequestPrefix: string;
  /** `PRISME_BASE_URL`, for the backlink prisme writes into the anchor's first line. */
  readonly baseUrl: string;
}

/** Actions that change something. A plan of pure skips is a converged plan. */
export function changesOf(plan: Plan): readonly Action[] {
  return plan.actions.filter((action) => action.tag !== 'skip');
}
