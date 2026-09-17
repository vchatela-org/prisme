import type { ExternalTask } from '@prisme/connectors';
import type { Rollup } from './types.js';

/**
 * Subtrees and the roll-up derived from them.
 *
 * The walk is here rather than imported from `@prisme/connectors` on purpose:
 * this directory holds **no value import from the I/O packages**, so the
 * planner's purity is a property of the import graph and not of a promise. The
 * connectors package has the same walk for the read path (`task-tool/tree.ts`);
 * both are twenty lines of breadth-first search over `parentId`, and the
 * duplication buys a guarantee that a lint rule can check.
 *
 * prisme **counts** subtasks and never copies them (docs/10-model.md §5).
 * Everything below counts.
 */

export type TaskIndex = ReadonlyMap<string, readonly ExternalTask[]>;

/** Children by parent id, each list in the tool's own order then by id. */
export function indexChildren(tasks: readonly ExternalTask[]): TaskIndex {
  const byParent = new Map<string, ExternalTask[]>();
  for (const task of tasks) {
    if (task.parentId === undefined) continue;
    const siblings = byParent.get(task.parentId);
    if (siblings === undefined) byParent.set(task.parentId, [task]);
    else siblings.push(task);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) =>
      left.order === right.order
        ? left.externalId.localeCompare(right.externalId)
        : left.order - right.order,
    );
  }
  return byParent;
}

/**
 * Every descendant of `rootId`, breadth-first, root excluded.
 *
 * The visited set matters: a parent chain that loops is impossible through a
 * UI and perfectly possible in a malformed response, and a hang here holds the
 * advisory lock and blocks every later pass.
 */
export function descendantsOf(index: TaskIndex, rootId: string): readonly ExternalTask[] {
  const collected: ExternalTask[] = [];
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of index.get(current) ?? []) {
      if (visited.has(child.externalId)) continue;
      visited.add(child.externalId);
      collected.push(child);
      queue.push(child.externalId);
    }
  }

  return collected;
}

/**
 * Progress, open count and last activity for one anchor.
 *
 * An anchor with no subtasks is 0% rather than 100%: an initiative nobody has
 * broken down is not finished work, and reporting it as complete would put it
 * at the top of every "nearly done" view in the product.
 *
 * *Last activity* is the most recent completion in the subtree. It is not the
 * most recent *edit*, because the task tool reports no edit timestamp on a
 * task — and inventing one from the fetch time would make every pass look like
 * activity.
 */
export function rollupOf(subtree: readonly ExternalTask[]): Rollup {
  const lastActivity = subtree
    .map((task) => task.completedAt)
    .filter((at): at is Date => at !== undefined)
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return rollupFromCounts(
    subtree.length,
    subtree.filter((task) => task.completed).length,
    lastActivity,
  );
}

/**
 * The same arithmetic, from counts.
 *
 * The state layer reads totals out of `task_mirror` rather than rebuilding the
 * subtree, and the two results are compared on every pass — so they have to
 * round identically. One function, used by both, is the only way to be sure of
 * that: a second rounding rule somewhere else is a roll-up that never converges
 * and writes itself every fifteen minutes.
 */
export function rollupFromCounts(
  total: number,
  completed: number,
  lastActivity: Date | undefined,
): Rollup {
  return {
    progress: total === 0 ? 0 : Math.round((completed / total) * 100),
    openTaskCount: total - completed,
    ...(lastActivity === undefined ? {} : { lastActivity }),
  };
}

/**
 * Whether prisme already believes `right`.
 *
 * An anchor prisme has never mirrored, whose subtree is empty, counts as
 * agreeing: there is nothing to record, and writing an empty mirror on first
 * sight would put a line in every plan that changes nothing.
 */
export function sameRollup(left: Rollup | undefined, right: Rollup): boolean {
  if (left === undefined) {
    return right.progress === 0 && right.openTaskCount === 0 && right.lastActivity === undefined;
  }
  return (
    left.progress === right.progress &&
    left.openTaskCount === right.openTaskCount &&
    (left.lastActivity?.getTime() ?? 0) === (right.lastActivity?.getTime() ?? 0)
  );
}
