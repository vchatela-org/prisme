import { z } from 'zod';
import type { AreaKey } from './area.js';
import type { InitiativeId } from './initiative.js';

/**
 * The task mirror — **owned entirely by the task tool** (docs/11-ownership.md §5).
 *
 * prisme mirrors the anchor's subtree read-only and derives progress, open
 * count, last activity and per-area capacity actuals. Subtasks are *counted*,
 * never copied: mirroring is what every off-the-shelf sync product does, and it
 * leaves you maintaining two task lists.
 *
 * Note what is absent. Nothing here is a prisme-owned field, `due` is read and
 * never written, and no task carries a score (ADR-0004).
 */

export type ExternalTaskId = string;

export type TaskPriority = 'highest' | 'high' | 'medium' | 'lowest';

export const TASK_PRIORITIES = ['highest', 'high', 'medium', 'lowest'] as const;

export interface TaskMirror {
  readonly externalId: ExternalTaskId;
  readonly externalParentId?: ExternalTaskId | undefined;
  /** The initiative or key result this subtree hangs beneath, when it has one. */
  readonly anchorFor?: InitiativeId | undefined;
  readonly areaKey?: AreaKey | undefined;
  readonly isAnchor: boolean;
  readonly completed: boolean;
  readonly completedAt?: Date | undefined;
  /** Recorded duration, in minutes. The only real measurement of capacity. */
  readonly recordedMinutes?: number | undefined;
  /** When *you* intend to work on it. Read for planned-versus-done only. */
  readonly due?: Date | undefined;
  readonly priority?: TaskPriority | undefined;
}

export const taskPrioritySchema: z.ZodType<TaskPriority> = z.enum(TASK_PRIORITIES);

/**
 * Priority, derived from the now-set (docs/12-scoring.md §5):
 * top 3 `now` → highest · remaining `now` → high · `next` anchors → medium ·
 * everything else → lowest.
 *
 * Priority flags are typically unused in practice, which is exactly why they
 * can become the one meaningful signal.
 */
export const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
  highest: 0,
  high: 1,
  medium: 2,
  lowest: 3,
};
