import type { CalendarDate, TaskPriority } from '@prisme/domain';
import type { SanitisedText } from '../sanitise.js';

/**
 * What the task tool looks like once it has been through the boundary.
 *
 * These are **wire records**, not domain entities: they describe what the tool
 * said, not what prisme concludes. Nothing here is scored, nothing here is
 * ranked, and no field of prisme's own appears (packages/connectors/CLAUDE.md
 * §4). W04 turns these into decisions; this package only reports.
 *
 * Read docs/11-ownership.md §5 beside this file. Everything the task tool owns
 * is here and is read-only; `due` in particular is read for planned-versus-done
 * and **never written back**.
 */

export type ExternalTaskId = string;

export interface ExternalProject {
  readonly externalId: ExternalTaskId;
  readonly name: string;
  readonly parentId?: ExternalTaskId | undefined;
  readonly archived: boolean;
  readonly order: number;
}

export interface ExternalSection {
  readonly externalId: ExternalTaskId;
  readonly projectId: ExternalTaskId;
  readonly name: string;
  readonly archived: boolean;
  readonly order: number;
}

export interface ExternalLabel {
  readonly externalId: ExternalTaskId;
  readonly name: string;
  readonly order: number;
}

/** `due` as the task tool holds it. Owned by the task tool; prisme never writes it. */
export interface ExternalDue {
  readonly date: CalendarDate;
  readonly isRecurring: boolean;
}

/**
 * A recorded duration.
 *
 * Kept in the tool's own unit rather than flattened to minutes, because they
 * are not the same measurement: a duration in minutes is "this took 45
 * minutes", and a duration in days is a block-out in a calendar. Converting the
 * second into 1440 minutes of capacity would make one all-day task outweigh a
 * fortnight of real work — so {@link ExternalTask.recordedMinutes} is populated
 * only for the minute form, and the raw value stays here for W13 to decide on.
 */
export interface ExternalDuration {
  readonly amount: number;
  readonly unit: 'minute' | 'day';
}

export interface ExternalTask {
  readonly externalId: ExternalTaskId;
  readonly projectId: ExternalTaskId;
  readonly sectionId?: ExternalTaskId | undefined;
  /** Set on a subtask. Subtrees nest to any depth — see `collectSubtree`. */
  readonly parentId?: ExternalTaskId | undefined;
  readonly content: string;
  readonly description: SanitisedText;
  readonly labels: readonly string[];
  readonly priority: TaskPriority;
  readonly completed: boolean;
  readonly completedAt?: Date | undefined;
  /** **The task tool's.** Read for planned-versus-done only (docs/11-ownership.md §5). */
  readonly due?: ExternalDue | undefined;
  /** prisme's field, read back so the reconciler can tell what is already applied. */
  readonly deadline?: CalendarDate | undefined;
  readonly recordedDuration?: ExternalDuration | undefined;
  /** Minutes, and only when the tool recorded minutes. The raw material for capacity actuals. */
  readonly recordedMinutes?: number | undefined;
  readonly order: number;
  /** Collected from the description. Never fetched (docs/14-threat-model.md §5). */
  readonly urls: readonly string[];
  readonly contentHash: string;
}

export type TaskChange =
  | { readonly kind: 'task'; readonly deleted: boolean; readonly task: ExternalTask }
  | { readonly kind: 'project'; readonly deleted: boolean; readonly project: ExternalProject }
  | { readonly kind: 'section'; readonly deleted: boolean; readonly section: ExternalSection }
  | { readonly kind: 'label'; readonly deleted: boolean; readonly label: ExternalLabel };

export interface SyncResult {
  readonly changes: TaskChange[];
  /** Opaque. Store it; the next incremental read is only as good as this value. */
  readonly token: string;
}

export interface TaskSnapshot {
  readonly token: string;
  readonly projects: readonly ExternalProject[];
  readonly sections: readonly ExternalSection[];
  readonly labels: readonly ExternalLabel[];
  readonly tasks: readonly ExternalTask[];
}

/**
 * A completed task, from the completion history.
 *
 * The one thing neither tool computes and prisme cannot do without: per-area
 * capacity actuals (docs/10-model.md §3, *Derived*) are built from these.
 */
export interface Completion {
  readonly externalTaskId: ExternalTaskId;
  readonly projectId?: ExternalTaskId | undefined;
  readonly sectionId?: ExternalTaskId | undefined;
  readonly completedAt: Date;
  readonly recordedMinutes?: number | undefined;
  /**
   * The duration as the tool stated it, unit included.
   *
   * {@link ExternalTask.recordedDuration} carries the same value for an open
   * task and says why the unit is kept. W13 reads it to count what it could not
   * measure: a day-scale duration is a block-out rather than an effort, so it
   * leaves `recordedMinutes` unset and falls through the preference order — and
   * a backfill that silently treated it as absent would report the resulting
   * estimates as if nothing had been known at all.
   */
  readonly recordedDuration?: ExternalDuration | undefined;
}

/**
 * The read path to the task tool.
 *
 * The signatures are the contract in docs/40-workstreams/W03-connectors.md;
 * every implementation, recorded or live, satisfies exactly this.
 */
export interface TaskToolClient {
  /** Omit the token for the first ever run; the tool then returns everything. */
  syncIncremental(token?: string): Promise<SyncResult>;
  /** The daily full pass. What answers "did the incremental path miss something?" */
  fetchAll(): Promise<TaskSnapshot>;
  /**
   * Completion history in `[since, until)`.
   *
   * `until` is what makes a multi-year backfill possible at all (W13). Offset
   * paging is bounded — a tool that keeps saying "there is more" must not spin
   * inside a pass holding the advisory lock — so a history longer than that
   * bound can only be read as a series of windows. Without `until`, each window
   * would re-page everything after its start, which is quadratic in the number
   * of windows and gives a resumed run nothing to resume *from*.
   */
  fetchCompletions(since: Date, until?: Date): Promise<Completion[]>;
}
