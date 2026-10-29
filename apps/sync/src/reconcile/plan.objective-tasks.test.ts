import { describe, expect, it } from 'vitest';
import { CONFIG, desiredOf, lastAppliedOf, observedOf, taskOf } from '../test-support/builders.js';
import { managedLine, objectiveLine } from './description.js';
import { plan } from './plan.js';
import type { DesiredObjectiveTask, DesiredState } from './types.js';

/**
 * An objective's own task (ADR-0038): prisme converges its deadline, swaps the
 * anchor label it arrived with for the objective label, and writes the
 * backlink — and leaves its title, priority and place alone. Invented ids.
 */

const OBJECTIVE = 'obj-0001';
const TASK = 'task-objective';

function objectiveTaskOf(overrides: Partial<DesiredObjectiveTask> = {}): DesiredObjectiveTask {
  return {
    objectiveId: OBJECTIVE,
    title: 'Get fit',
    deadline: '2026-12-31' as DesiredObjectiveTask['deadline'],
    externalTaskId: TASK,
    ...overrides,
  };
}

/** The objective's task is held by it, so it is taken in the intent channel's sense. */
function withObjectiveTasks(tasks: readonly DesiredObjectiveTask[]): DesiredState {
  return { ...desiredOf([], undefined, [TASK]), objectiveTasks: tasks };
}

function heldTask(overrides: Parameters<typeof taskOf>[0] = {}) {
  return taskOf({
    externalId: TASK,
    content: 'Get fit',
    labels: ['prisme:objective'],
    priority: 'high',
    deadline: '2026-12-31' as ReturnType<typeof taskOf>['deadline'],
    description: { text: objectiveLine(CONFIG.baseUrl, OBJECTIVE), segments: [], urls: [] },
    ...overrides,
  });
}

describe('an objective’s own task', () => {
  it('trades the anchor label and the initiative’s backlink for the objective’s, and sets the deadline', () => {
    const result = plan(
      withObjectiveTasks([objectiveTaskOf()]),
      observedOf([
        heldTask({
          labels: ['errand', 'prisme'],
          deadline: undefined,
          description: {
            text: `${managedLine(CONFIG.baseUrl, 'init-001')}\nMy notes`,
            segments: [],
            urls: [],
          },
        }),
      ]),
      new Map(),
      CONFIG,
    );

    const [action] = result.actions;
    expect(action).toMatchObject({ tag: 'update', subject: 'objective', objectiveId: OBJECTIVE });
    const operation = action?.operations[0];
    if (operation?.type !== 'update_task') throw new Error('expected an update');
    expect(operation.patch).toEqual({
      deadline: '2026-12-31',
      labels: ['errand', 'prisme:objective'],
      description: `${objectiveLine(CONFIG.baseUrl, OBJECTIVE)}\nMy notes`,
    });
  });

  it('never touches its title or priority, and is a skip once it matches', () => {
    const result = plan(
      withObjectiveTasks([objectiveTaskOf()]),
      observedOf([heldTask({ content: 'My own wording', priority: 'lowest' })]),
      new Map(),
      CONFIG,
    );
    expect(result.actions.map((action) => action.tag)).toEqual(['skip']);
  });

  it('turns a hand edit of its deadline into a review that writes nothing', () => {
    const result = plan(
      withObjectiveTasks([objectiveTaskOf()]),
      observedOf([heldTask({ deadline: '2027-03-01' as ReturnType<typeof taskOf>['deadline'] })]),
      lastAppliedOf([['objective_task', TASK, 'deadline', '2026-12-31']]),
      CONFIG,
    );
    expect(result.actions).toEqual([
      expect.objectContaining({ tag: 'review', subject: 'objective', operations: [] }),
    ]);
  });

  it('is never recreated when its task is gone', () => {
    const result = plan(withObjectiveTasks([objectiveTaskOf()]), observedOf([]), new Map(), CONFIG);
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]?.tag).toBe('review');
  });

  it('is not made an initiative by the anchor label it still wears', () => {
    const result = plan(
      withObjectiveTasks([objectiveTaskOf()]),
      observedOf([heldTask({ labels: ['prisme'] })]),
      new Map(),
      CONFIG,
    );
    expect(result.actions.some((action) => action.subject === 'initiative')).toBe(false);
  });
});
