import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  desiredOf,
  lastAppliedOf,
  observedOf,
  PROJECT,
  SECTION,
  taskOf,
} from '../test-support/builders.js';
import { keyResultLine } from './description.js';
import { plan } from './plan.js';
import type { DesiredKeyResultAnchor, DesiredState } from './types.js';

/**
 * A key result's anchor (ADR-0012, S15): created when it has neither a task
 * nor a link, bound when a link was decided, and converged — statement,
 * deadline, the key-result label, the backlink — once it has one. Never a
 * priority, and a hand edit is a review, not a conflict. Invented ids.
 */

const KR = 'kr-0001';
const OBJECTIVE = 'obj-0001';
/** The task the objective holds (ADR-0038); a key result's task is made beneath it. */
const OBJECTIVE_TASK = 'task-objective';

function objectiveTask(overrides: Parameters<typeof taskOf>[0] = {}) {
  return taskOf({
    externalId: OBJECTIVE_TASK,
    projectId: PROJECT,
    sectionId: SECTION,
    content: 'Get fit',
    labels: [],
    ...overrides,
  });
}

function subtask(externalId: string, content: string) {
  return taskOf({ externalId, projectId: PROJECT, parentId: OBJECTIVE_TASK, content, labels: [] });
}

function keyResultOf(overrides: Partial<DesiredKeyResultAnchor> = {}): DesiredKeyResultAnchor {
  return {
    keyResultId: KR,
    objectiveId: OBJECTIVE,
    statement: 'Run a 10 km race',
    areaKey: 'craft',
    deadline: '2026-12-31' as DesiredKeyResultAnchor['deadline'],
    objectiveTaskId: OBJECTIVE_TASK,
    ...overrides,
  };
}

function withKeyResults(
  keyResults: readonly DesiredKeyResultAnchor[],
  boundElsewhere: readonly string[] = [],
): DesiredState {
  return { ...desiredOf([], undefined, boundElsewhere), keyResultAnchors: keyResults };
}

function krTask(overrides: Parameters<typeof taskOf>[0] = {}) {
  return taskOf({
    externalId: 'task-kr',
    content: 'Run a 10 km race',
    labels: ['prisme:kr'],
    priority: 'lowest',
    deadline: '2026-12-31' as ReturnType<typeof taskOf>['deadline'],
    description: { text: keyResultLine(CONFIG.baseUrl, OBJECTIVE, KR), segments: [], urls: [] },
    ...overrides,
  });
}

describe('a key result’s anchor', () => {
  it('is created beneath its objective’s task when it has neither a task nor a link', () => {
    const result = plan(
      withKeyResults([keyResultOf()]),
      observedOf([objectiveTask()]),
      new Map(),
      CONFIG,
    );

    expect(result.counts.create).toBe(1);
    const [action] = result.actions;
    expect(action).toMatchObject({ tag: 'create', subject: 'key_result', keyResultId: KR });
    const operation = action?.operations[0];
    expect(operation).toMatchObject({
      type: 'create_key_result_anchor',
      keyResultId: KR,
      draft: {
        projectId: PROJECT,
        parentId: OBJECTIVE_TASK,
        content: 'Run a 10 km race',
        labels: ['prisme:kr'],
        priority: 'lowest',
        deadline: '2026-12-31',
      },
    });
    if (operation?.type === 'create_key_result_anchor') {
      expect(operation.draft).not.toHaveProperty('sectionId');
    }
  });

  it('takes the objective’s subtask with exactly its statement, and creates nothing (ADR-0038)', () => {
    const result = plan(
      withKeyResults([keyResultOf()]),
      observedOf([objectiveTask(), subtask('task-sub', '  Run a 10 km race ')]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]).toMatchObject({
      tag: 'adopt',
      externalId: 'task-sub',
      operations: [
        {
          type: 'bind_key_result_ref',
          keyResultId: KR,
          externalId: 'task-sub',
          match: 'exact_title',
        },
      ],
    });
  });

  it('gives one subtask to one key result, even when two share a statement', () => {
    const result = plan(
      withKeyResults([keyResultOf(), keyResultOf({ keyResultId: 'kr-0002' })]),
      observedOf([objectiveTask(), subtask('task-sub', 'Run a 10 km race')]),
      new Map(),
      CONFIG,
    );
    expect(result.actions.map((action) => action.tag)).toEqual(['adopt', 'create']);
  });

  it('asks rather than guesses when a subtask is only close to its statement', () => {
    const result = plan(
      withKeyResults([keyResultOf()]),
      observedOf([objectiveTask(), subtask('task-sub', '1. run a 10-km race')]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]).toMatchObject({ tag: 'review', operations: [] });
  });

  it('never takes a subtask something else holds', () => {
    const result = plan(
      withKeyResults([keyResultOf()], ['task-sub']),
      observedOf([objectiveTask(), subtask('task-sub', 'Run a 10 km race')]),
      new Map(),
      CONFIG,
    );
    expect(result.actions[0]?.tag).toBe('create');
  });

  it('gets no task when its objective holds none, and says so without asking', () => {
    const result = plan(
      withKeyResults([keyResultOf({ objectiveTaskId: undefined })]),
      observedOf([]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]?.tag).toBe('skip');
  });

  it('is never created when its objective’s task is gone', () => {
    const result = plan(withKeyResults([keyResultOf()]), observedOf([]), new Map(), CONFIG);
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]?.tag).toBe('review');
  });

  it('binds a decided link and creates nothing', () => {
    const result = plan(
      withKeyResults([keyResultOf({ pendingExternalId: 'task-kr' })]),
      observedOf([krTask()]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]).toMatchObject({
      tag: 'adopt',
      operations: [{ type: 'bind_key_result_ref', keyResultId: KR, externalId: 'task-kr' }],
    });
  });

  it('refuses a link to a task something else holds', () => {
    const result = plan(
      withKeyResults([keyResultOf({ pendingExternalId: 'task-kr' })], ['task-kr']),
      observedOf([krTask()]),
      new Map(),
      CONFIG,
    );
    expect(result.actions[0]?.tag).toBe('review');
  });

  it('converges the statement, deadline, label and backlink — and leaves the priority alone', () => {
    const result = plan(
      withKeyResults([keyResultOf({ externalAnchorId: 'task-kr' })]),
      observedOf([
        krTask({
          content: 'Old wording',
          labels: ['prisme'],
          priority: 'highest',
          deadline: undefined,
          description: { text: 'Notes', segments: [], urls: [] },
        }),
      ]),
      new Map(),
      CONFIG,
    );
    const [action] = result.actions;
    expect(action?.tag).toBe('update');
    const operation = action?.operations[0];
    expect(operation?.type).toBe('update_task');
    if (operation?.type !== 'update_task') return;
    expect(operation.patch).toMatchObject({
      content: 'Run a 10 km race',
      deadline: '2026-12-31',
      // The anchor label a converted initiative kept is prisme's, and now false.
      labels: ['prisme:kr'],
    });
    expect(operation.patch).not.toHaveProperty('priority');
    expect(operation.patch.description).toContain(`#kr-${KR}`);
    expect(operation.patch.description).toContain('Notes');
  });

  it('is a skip once it matches', () => {
    const result = plan(
      withKeyResults([keyResultOf({ externalAnchorId: 'task-kr' })]),
      observedOf([krTask()]),
      new Map(),
      CONFIG,
    );
    expect(result.actions.map((action) => action.tag)).toEqual(['skip']);
  });

  it('turns a hand edit of a managed field into a review that writes nothing', () => {
    const result = plan(
      withKeyResults([keyResultOf({ externalAnchorId: 'task-kr' })]),
      observedOf([krTask({ content: 'Edited by hand' })]),
      lastAppliedOf([['key_result_anchor', 'task-kr', 'title', 'Run a 10 km race']]),
      CONFIG,
    );
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ tag: 'review', operations: [] });
  });

  it('is never recreated when its bound task is gone', () => {
    const result = plan(
      withKeyResults([keyResultOf({ externalAnchorId: 'task-gone' })]),
      observedOf([]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]?.tag).toBe('review');
  });

  it('keeps the intent channel off a key result’s task, even with the anchor label', () => {
    const result = plan(
      withKeyResults([keyResultOf({ externalAnchorId: 'task-kr' })], ['task-kr']),
      observedOf([krTask({ labels: ['prisme', 'prisme:kr'] })]),
      new Map(),
      CONFIG,
    );
    expect(result.actions.some((action) => action.subject === 'initiative')).toBe(false);
  });
});

/**
 * ADR-0039: key results kept by hand one level down, under a sub-objective,
 * with the owner's own markup. The failure this guards against made one new
 * task per key result beside the one already there.
 */
describe('a key result kept under a sub-objective (ADR-0039)', () => {
  const GROUP = 'task-group-1';

  function group(externalId: string, content: string) {
    return subtask(externalId, content);
  }

  function grandchild(externalId: string, parentId: string, content: string) {
    return taskOf({ externalId, projectId: PROJECT, parentId, content, labels: [] });
  }

  it('finds a grandchild that reads as its statement, through the markup, and creates nothing', () => {
    const result = plan(
      withKeyResults([keyResultOf({ statement: 'KR1 : Run a 10 km race' })]),
      observedOf([
        objectiveTask(),
        group(GROUP, 'O1 : **Build endurance**'),
        grandchild('task-kr1', GROUP, '**KR1** : Run a **10 km** race'),
      ]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]).toMatchObject({
      tag: 'adopt',
      externalId: 'task-kr1',
      operations: [{ type: 'bind_key_result_ref', externalId: 'task-kr1', match: 'exact_title' }],
    });
  });

  it('a whole three-level tree of hand-kept key results produces no create', () => {
    const keyResults = [
      keyResultOf({ keyResultId: 'kr-a', statement: 'KR1 : Run a 10 km race' }),
      keyResultOf({ keyResultId: 'kr-b', statement: 'KR2 : Swim twice a week' }),
      keyResultOf({ keyResultId: 'kr-c', statement: 'KR1 : Sleep eight hours' }),
    ];
    const result = plan(
      withKeyResults(keyResults),
      observedOf([
        objectiveTask(),
        group('task-g1', 'O1 : **Build endurance**'),
        grandchild('task-1', 'task-g1', '**KR1** : Run a 10 km race'),
        grandchild('task-2', 'task-g1', '**KR2** : Swim twice a week'),
        group('task-g2', 'O2 : Rest well'),
        grandchild('task-3', 'task-g2', '**KR1** : Sleep eight hours'),
      ]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions.map((action) => [action.tag, action.externalId])).toEqual([
      ['adopt', 'task-1'],
      ['adopt', 'task-2'],
      ['adopt', 'task-3'],
    ]);
  });

  it('refuses to create beside key-result-shaped subtasks none of which reads as it', () => {
    const result = plan(
      withKeyResults([keyResultOf({ statement: 'O1 Build endurance · KR1 : Run a 10 km race' })]),
      observedOf([
        objectiveTask(),
        group(GROUP, 'O1 : **Build endurance**'),
        grandchild('task-kr1', GROUP, '**KR1** : Run a 10 km race, twice'),
      ]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]).toMatchObject({ tag: 'review', operations: [] });
    expect(result.actions[0]?.detail).toContain('key-result-shaped');
  });

  it('a unique near match only is a review, never a bind', () => {
    const result = plan(
      withKeyResults([keyResultOf({ statement: 'Run a 10 km race' })]),
      observedOf([
        objectiveTask(),
        group(GROUP, 'O1 : Build endurance'),
        grandchild('task-near', GROUP, 'run a 10-km race'),
      ]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]).toMatchObject({ tag: 'review', operations: [] });
  });

  it('two subtasks reading as its statement are a review', () => {
    const result = plan(
      withKeyResults([keyResultOf({ statement: 'KR1 : Run' })]),
      observedOf([
        objectiveTask(),
        grandchild('task-x', OBJECTIVE_TASK, 'KR1 : Run'),
        group(GROUP, 'O1 : Build'),
        grandchild('task-y', GROUP, '**KR1** : Run'),
      ]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]?.tag).toBe('review');
  });

  it('gets no task when it is already at 100%', () => {
    const result = plan(
      withKeyResults([keyResultOf({ progressSelf: 100 })]),
      observedOf([objectiveTask()]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]).toMatchObject({ tag: 'skip', operations: [] });
  });

  it('still adopts its open task when it is at 100%', () => {
    const result = plan(
      withKeyResults([keyResultOf({ progressSelf: 100, statement: 'KR1 : Run' })]),
      observedOf([
        objectiveTask(),
        group(GROUP, 'O1 : Build'),
        grandchild('t', GROUP, 'KR1 : Run'),
      ]),
      new Map(),
      CONFIG,
    );
    expect(result.actions[0]).toMatchObject({ tag: 'adopt', externalId: 't' });
  });

  it('a finished key result does not trip the refusal for its siblings', () => {
    const result = plan(
      withKeyResults([keyResultOf({ progressSelf: 100, statement: 'KR2 : Done long ago' })]),
      observedOf([
        objectiveTask(),
        group(GROUP, 'O1 : Build'),
        grandchild('t', GROUP, 'KR1 : Run'),
      ]),
      new Map(),
      CONFIG,
    );
    expect(result.actions[0]?.tag).toBe('skip');
  });

  it('is created beneath the subtask that reads as its sub-objective', () => {
    const result = plan(
      withKeyResults([
        keyResultOf({ statement: 'KR1 : Run', subObjective: 'O1 : Build endurance' }),
      ]),
      observedOf([objectiveTask(), group(GROUP, 'O1 : **Build endurance**')]),
      new Map(),
      CONFIG,
    );
    expect(result.actions[0]).toMatchObject({
      tag: 'create',
      operations: [
        {
          type: 'create_key_result_anchor',
          draft: { parentId: GROUP, projectId: PROJECT, content: 'KR1 : Run' },
        },
      ],
    });
  });

  it('is created beneath the objective’s task when no subtask reads as its sub-objective', () => {
    const result = plan(
      withKeyResults([keyResultOf({ statement: 'KR1 : Run', subObjective: 'O3 : Elsewhere' })]),
      observedOf([objectiveTask(), group(GROUP, 'O1 : Build endurance')]),
      new Map(),
      CONFIG,
    );
    expect(result.actions[0]).toMatchObject({
      tag: 'create',
      operations: [{ draft: { parentId: OBJECTIVE_TASK } }],
    });
  });

  it('asks when two subtasks read as its sub-objective', () => {
    const result = plan(
      withKeyResults([keyResultOf({ statement: 'KR1 : Run', subObjective: 'O1 : Build' })]),
      observedOf([objectiveTask(), group('g1', 'O1 : Build'), group('g2', 'O1 : **Build**')]),
      new Map(),
      CONFIG,
    );
    expect(result.counts.create).toBe(0);
    expect(result.actions[0]?.tag).toBe('review');
  });
});
