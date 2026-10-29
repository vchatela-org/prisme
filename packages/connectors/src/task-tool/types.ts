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
  /**
   * The user's own Inbox — where a task with no project of its own lands, and
   * which belongs to no area (S11). Absent on every other project.
   */
  readonly inbox?: boolean | undefined;
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
 * Where work can live in the task tool, and nothing else.
 *
 * What a person picks an area mapping from. A separate read from
 * {@link TaskSnapshot} because it is asked on a Settings screen, where fetching
 * every task to list a few dozen project names would be the wrong trade.
 */
export interface TaskLocations {
  readonly projects: readonly ExternalProject[];
  readonly sections: readonly ExternalSection[];
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
  /**
   * The task's title as it read when it was completed, sanitised to plain text.
   *
   * Carried so the capacity figures can be itemised — which tasks an area's
   * observed share was made of — and for nothing else. It is the task tool's
   * field, read and never written, and it is the only part of a task's content
   * prisme keeps: description, subtasks and comments are still never read into
   * history ([ADR-0032](../../../../docs/20-decisions/0032-completed-task-titles-are-recorded.md)).
   * Absent when the tool sent none.
   */
  readonly content?: string | undefined;
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
  /**
   * The task's labels as it was completed, sorted. The task tool's field, read
   * and never written. Read so a configured label can place a completion in
   * the Signals lane wherever it sat
   * ([ADR-0041](../../../../docs/20-decisions/0041-a-label-can-put-a-task-in-the-signals-lane.md)).
   * Absent when the tool sent none — which is *not known*, not *no labels*.
   */
  readonly labels?: readonly string[] | undefined;
}

/**
 * One completion — or its retraction — from the task tool's activity log.
 *
 * The record a **recurring** task's completions live in: completing one moves
 * its date rather than checking it, so it never reaches the completion history
 * {@link Completion} is read from, and each occurrence is an event here and
 * nowhere else ([ADR-0040](../../../../docs/20-decisions/0040-completions-are-read-from-the-activity-log.md)).
 *
 * An `uncompleted` event is carried rather than dropped because it is the only
 * thing that says a completion in the same log was taken back. Pairing the two
 * is a decision, so the caller makes it, not this package.
 */
export interface CompletionEvent {
  readonly kind: 'completed' | 'uncompleted';
  readonly externalTaskId: ExternalTaskId;
  /** When the tool logged it. */
  readonly at: Date;
  /** The project the task was in, as the log records it. */
  readonly projectId?: ExternalTaskId | undefined;
  /**
   * The section, when the log's entry carries one. The tool documents it on
   * completion entries; an entry without one is located by project only,
   * unless the caller can say more.
   */
  readonly sectionId?: ExternalTaskId | undefined;
  /** The title as logged, sanitised to plain text (ADR-0032). Absent when none was sent. */
  readonly content?: string | undefined;
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
   * Completion history over the window `[since, until]` — **inclusive at both
   * ends**, which is the endpoint's own semantics and not a choice made here.
   *
   * Two consequences worth stating rather than rediscovering. Adjacent slices
   * that meet on an instant both return a completion sitting exactly on it, so
   * the caller's dedupe (W13's `(task, completed_at)`) is what makes a sliced
   * backfill correct — not the window arithmetic. And `until` is now
   * **required** by the endpoint: omitting it is a 400, not an open window, so
   * a caller that leaves it out gets "up to now" rather than everything.
   *
   * `until` is what makes a multi-year backfill possible at all (W13). Paging
   * is bounded — a tool that keeps saying "there is more" must not spin inside
   * a pass holding the advisory lock — so a history longer than that bound can
   * only be read as a series of windows. Without `until`, each window would
   * re-page everything after its start, which is quadratic in the number of
   * windows and gives a resumed run nothing to resume *from*.
   *
   * Paging itself is by the tool's cursor, and it ends when the tool stops
   * handing one out — never when a page comes back shorter than the page size.
   */
  fetchCompletions(since: Date, until?: Date): Promise<Completion[]>;
  /**
   * Completion and un-completion events from the activity log over
   * `[since, until)` — **half-open**, which is the log's own `date_from` /
   * `date_to` semantics and differs from {@link fetchCompletions}.
   *
   * The read that sees a recurring task's occurrences (ADR-0040). It is two
   * filtered reads, `completed` and `uncompleted` items, each paged by the
   * tool's cursor and bounded like completion history; the events come back
   * oldest first. How far back the log reaches depends on the account's plan:
   * a window older than that returns nothing rather than an error.
   */
  fetchCompletionEvents(since: Date, until: Date): Promise<CompletionEvent[]>;
  /** Projects and sections, archived ones included and marked. Reads no task. */
  fetchLocations(): Promise<TaskLocations>;
}
