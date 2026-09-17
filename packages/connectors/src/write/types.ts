import type { CalendarDate, TaskPriority } from '@prisme/domain';

/**
 * The write path to the task tool — **the only code in this package that can
 * change someone's real task list.**
 *
 * Read docs/11-ownership.md §4–5 beside this file. What is absent here is the
 * specification:
 *
 * | Not here | Why |
 * |---|---|
 * | `due` | The task tool's. prisme writes `deadline` and never `due` (ADR-0003) |
 * | `completeTask` | Completion is the task tool's; it flows *inward* and moves the initiative to `review` |
 * | `deleteTask`, `archive` | prisme never destroys an external object. Adoption is reversible because of that |
 * | subtask content, description, `due` | Subtasks are counted, never authored |
 *
 * There is no method for any of them, so no bug can reach for one. The one
 * field prisme writes that it does not own is a **subtask's priority**, under
 * the overwrite guard (docs/16-sync.md §5) — and the guard is enforced by the
 * planner, which is the only thing that produces these calls.
 */

/** A new anchor task. Only ever produced for `origin = created_in_prisme` with no external ref. */
export interface AnchorDraft {
  readonly projectId: string;
  readonly sectionId?: string | undefined;
  /** The initiative's title. prisme owns it (docs/11-ownership.md §4). */
  readonly content: string;
  /** First line is the backlink; the last line is the managed-fields marker. */
  readonly description: string;
  readonly labels: readonly string[];
  readonly priority: TaskPriority;
  readonly deadline?: CalendarDate | undefined;
}

/**
 * A change to an existing task. Every field is optional; only what is present
 * is sent, so an update never restates a value it did not decide to change.
 *
 * `deadline: null` clears the deadline. `undefined` leaves it alone — the
 * distinction matters, because "prisme has no deadline for this" is a decision
 * and must be able to reach the tool.
 */
export interface TaskPatch {
  readonly content?: string | undefined;
  readonly description?: string | undefined;
  readonly labels?: readonly string[] | undefined;
  readonly priority?: TaskPriority | undefined;
  readonly deadline?: CalendarDate | null | undefined;
}

/** Where the anchor lives. Derived from the initiative's area or project mapping. */
export interface TaskLocation {
  readonly projectId: string;
  readonly sectionId?: string | undefined;
}

/**
 * A client-generated key, stable for one logical write within one pass.
 *
 * The tool treats it as the command's identity, so a retry after a timeout
 * cannot apply the same change twice (docs/16-sync.md §3). It is derived, never
 * random: a random key regenerated on retry is no key at all.
 */
export type IdempotencyKey = string;

export interface TaskToolWriter {
  /**
   * Creates an anchor and returns its external id.
   *
   * The **only** creating method in this package, and the planner emits the
   * action behind it solely for `origin = created_in_prisme AND external_ref IS
   * NULL` (ADR-0010, guard 2).
   */
  createTask(draft: AnchorDraft, key: IdempotencyKey): Promise<{ readonly externalId: string }>;
  updateTask(externalId: string, patch: TaskPatch, key: IdempotencyKey): Promise<void>;
  /** Project and section only. A move never touches a field. */
  moveTask(externalId: string, location: TaskLocation, key: IdempotencyKey): Promise<void>;
}
