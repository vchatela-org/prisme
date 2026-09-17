import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  CONFIG,
  convergedAnchorState,
  desiredOf,
  observedOf,
  plus,
  taskOf,
} from '../test-support/builders.js';
import { plan } from './plan.js';
import { changesOf } from './types.js';

/**
 * **Overwrite protection** (docs/16-sync.md §5, W04 *Definition of done*).
 *
 * > prisme may overwrite an externally-owned-but-prisme-propagated field only
 * > if its current value equals the value prisme last wrote.
 *
 * This is the single field in the system that prisme writes without owning
 * (docs/11-ownership.md §5), and the rule is the whole reason `last_applied`
 * exists. The tests below are the four states a subtask's priority can be in.
 */

const ANCHOR = anchorOf({ externalAnchorId: 'task-0001', priority: 'highest' });

function subtaskPlan(
  subtask: {
    readonly priority: 'highest' | 'high' | 'medium' | 'lowest';
    readonly completed?: boolean;
  },
  lastAppliedPriority?: string,
) {
  const lastApplied =
    lastAppliedPriority === undefined
      ? convergedAnchorState()
      : plus(convergedAnchorState(), [['subtask', 'task-0002', 'priority', lastAppliedPriority]]);

  return plan(
    desiredOf([ANCHOR]),
    observedOf([
      taskOf(),
      taskOf({
        externalId: 'task-0002',
        parentId: 'task-0001',
        content: 'A subtask somebody wrote',
        labels: [],
        priority: subtask.priority,
        completed: subtask.completed ?? false,
      }),
    ]),
    lastApplied,
    CONFIG,
  );
}

function priorityUpdates(result: ReturnType<typeof subtaskPlan>) {
  return changesOf(result).filter((action) => action.subject === 'subtree');
}

describe('a subtask’s priority', () => {
  it('is claimed once when it still sits at the tool’s default', () => {
    const result = subtaskPlan({ priority: 'lowest' });

    const action = priorityUpdates(result)[0];
    expect(action?.operations).toEqual([
      {
        type: 'update_task',
        externalId: 'task-0002',
        patch: { priority: 'highest' },
        initiativeId: 'init-001',
      },
    ]);
    expect(action?.lastApplied).toEqual([
      { entityKind: 'subtask', entityId: 'task-0002', field: 'priority', value: 'highest' },
    ]);
  });

  it('survives when it was set by hand and prisme has never written it', () => {
    const result = subtaskPlan({ priority: 'medium' });

    expect(priorityUpdates(result)).toHaveLength(0);
  });

  it('is updated when it still holds the value prisme last wrote', () => {
    const result = subtaskPlan({ priority: 'high' }, 'high');

    expect(priorityUpdates(result)[0]?.operations).toHaveLength(1);
  });

  it('becomes permanently the owner’s once it is edited away from prisme’s value', () => {
    const result = subtaskPlan({ priority: 'medium' }, 'high');

    expect(priorityUpdates(result)).toHaveLength(0);
  });

  it('is left alone on work that is already finished', () => {
    const result = subtaskPlan({ priority: 'lowest', completed: true });

    expect(priorityUpdates(result)).toHaveLength(0);
  });
});

describe('a subtree', () => {
  it('is one action, however many subtasks inherit', () => {
    const result = plan(
      desiredOf([ANCHOR]),
      observedOf([
        taskOf(),
        taskOf({ externalId: 'task-0002', parentId: 'task-0001', labels: [], priority: 'lowest' }),
        taskOf({ externalId: 'task-0003', parentId: 'task-0002', labels: [], priority: 'lowest' }),
        taskOf({ externalId: 'task-0004', parentId: 'task-0003', labels: [], priority: 'lowest' }),
      ]),
      convergedAnchorState(),
      CONFIG,
    );

    const action = priorityUpdates(result)[0];
    expect(action?.detail).toContain('3 subtasks inherit priority highest');
    expect(action?.operations).toHaveLength(3);
  });
});
