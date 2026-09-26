import {
  lastAppliedKey,
  type DesiredState,
  type LastAppliedIndex,
  type ObservedState,
  type Plan,
} from '../reconcile/types.js';

/**
 * A world the planner's output can be applied to, in memory.
 *
 * `apply` talks to an HTTP API and a database; this does the same arithmetic
 * with objects, so a test can ask the question that matters about a
 * level-triggered system and cannot be asked of one plan alone:
 *
 * > If prisme does what it just said, does the next pass have anything left to
 * > say?
 *
 * A reconciler that answers "yes, forever" is one that rewrites the same field
 * every fifteen minutes, and nothing in a single-plan assertion would catch it.
 */

export interface World {
  readonly desired: DesiredState;
  readonly observed: ObservedState;
  readonly lastApplied: LastAppliedIndex;
}

let created = 0;

export function applyInMemory(world: World, plan: Plan): World {
  const anchors = world.desired.anchors.map((anchor) => ({ ...anchor }));
  const tasks = world.observed.tasks.map((task) => ({ ...task }));
  const lastApplied = new Map(world.lastApplied);

  const anchorById = (id: string) => anchors.find((anchor) => anchor.initiativeId === id);
  const taskById = (id: string) => tasks.find((task) => task.externalId === id);

  for (const action of plan.actions) {
    let createdId: string | undefined;

    for (const operation of action.operations) {
      switch (operation.type) {
        case 'create_anchor': {
          created += 1;
          createdId = `task-created-${String(created)}`;
          const draft = operation.draft;
          tasks.push({
            externalId: createdId,
            projectId: draft.projectId,
            ...(draft.sectionId === undefined ? {} : { sectionId: draft.sectionId }),
            content: draft.content,
            description: { text: draft.description, segments: [], urls: [] },
            labels: [...draft.labels].sort(),
            priority: draft.priority,
            completed: false,
            ...(draft.deadline === undefined ? {} : { deadline: draft.deadline }),
            order: tasks.length + 1,
            urls: [],
            contentHash: 'hash',
          });
          const anchor = anchorById(operation.initiativeId);
          if (anchor) anchor.externalAnchorId = createdId;
          break;
        }

        case 'update_task': {
          const task = taskById(operation.externalId);
          if (!task) break;
          const patch = operation.patch;
          if (patch.content !== undefined) task.content = patch.content;
          if (patch.description !== undefined) {
            task.description = { text: patch.description, segments: [], urls: [] };
          }
          if (patch.labels !== undefined) task.labels = [...patch.labels];
          if (patch.priority !== undefined) task.priority = patch.priority;
          if (patch.deadline !== undefined) {
            if (patch.deadline === null) delete (task as { deadline?: string }).deadline;
            else task.deadline = patch.deadline;
          }
          break;
        }

        case 'move_task': {
          const task = taskById(operation.externalId);
          if (!task) break;
          task.projectId = operation.location.projectId;
          if (operation.location.sectionId === undefined) {
            delete (task as { sectionId?: string }).sectionId;
          } else {
            task.sectionId = operation.location.sectionId;
          }
          break;
        }

        case 'bind_ref': {
          const anchor = anchorById(operation.initiativeId);
          if (anchor) anchor.externalAnchorId = operation.externalId;
          break;
        }

        case 'adopt_deadline': {
          const anchor = anchorById(operation.initiativeId);
          if (anchor && anchor.deadline === undefined) anchor.deadline = operation.deadline;
          break;
        }

        case 'capture_initiative': {
          const task = taskById(operation.externalId);
          anchors.push({
            initiativeId: `init-captured-${operation.externalId}`,
            title: operation.title,
            areaKey: operation.areaKey,
            status: 'inbox',
            origin: 'adopted',
            priority: 'lowest',
            externalAnchorId: operation.externalId,
            ...(operation.deadline === undefined ? {} : { deadline: operation.deadline }),
            ...(task === undefined
              ? {}
              : {
                  location: {
                    projectId: task.projectId,
                    ...(task.sectionId === undefined ? {} : { sectionId: task.sectionId }),
                  },
                }),
          });
          break;
        }

        case 'set_status': {
          const anchor = anchorById(operation.initiativeId);
          if (anchor) anchor.status = operation.to;
          break;
        }

        case 'record_rollup': {
          const anchor = anchorById(operation.initiativeId);
          if (anchor) anchor.rollup = operation.rollup;
          break;
        }
      }
    }

    for (const write of action.lastApplied) {
      const entityId = write.entityId === '' ? (createdId ?? '') : write.entityId;
      if (entityId === '') continue;
      lastApplied.set(lastAppliedKey(write.entityKind, entityId, write.field), {
        entityKind: write.entityKind,
        entityId,
        field: write.field,
        value: write.value,
        appliedAt: new Date('2026-09-17T09:00:00Z'),
      });
    }
  }

  return {
    desired: { ...world.desired, anchors },
    observed: { tasks },
    lastApplied,
  };
}
