import type { ExternalTask, ExternalTaskId } from './types.js';

/**
 * Subtrees, at any depth.
 *
 * prisme never mirrors a subtask — it **counts** them (docs/10-model.md §5,
 * *The anchor*). Counting still requires knowing which tasks hang beneath an
 * anchor, and the tool reports only each task's immediate parent, so the walk
 * has to happen somewhere. It happens here, where it is a structural fact about
 * the response rather than a decision about the work.
 *
 * Everything below is ordered deterministically. A count that depends on map
 * iteration order is a count that differs between two runs over identical data.
 */

export function indexByParent(
  tasks: readonly ExternalTask[],
): ReadonlyMap<ExternalTaskId, readonly ExternalTask[]> {
  const byParent = new Map<ExternalTaskId, ExternalTask[]>();
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
 * Every descendant of `rootId`, breadth-first. The root itself is not included.
 *
 * A parent chain that loops back on itself is impossible through the UI and
 * perfectly possible in a malformed response. The visited set means this
 * function returns a wrong answer rather than hanging the reconciler — and a
 * hang during a pass holds the advisory lock and blocks every later run.
 */
export function collectSubtree(
  tasks: readonly ExternalTask[],
  rootId: ExternalTaskId,
): readonly ExternalTask[] {
  const byParent = indexByParent(tasks);
  const collected: ExternalTask[] = [];
  const visited = new Set<ExternalTaskId>([rootId]);
  const queue: ExternalTaskId[] = [rootId];

  while (queue.length > 0) {
    const current = queue.shift() as ExternalTaskId;
    for (const child of byParent.get(current) ?? []) {
      if (visited.has(child.externalId)) continue;
      visited.add(child.externalId);
      collected.push(child);
      queue.push(child.externalId);
    }
  }

  return collected;
}

/** Roots first: the tasks with no parent, or whose parent is not in the batch. */
export function rootsOf(tasks: readonly ExternalTask[]): readonly ExternalTask[] {
  const present = new Set(tasks.map((task) => task.externalId));
  return tasks.filter((task) => task.parentId === undefined || !present.has(task.parentId));
}
