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

function keyResultOf(overrides: Partial<DesiredKeyResultAnchor> = {}): DesiredKeyResultAnchor {
  return {
    keyResultId: KR,
    objectiveId: OBJECTIVE,
    statement: 'Run a 10 km race',
    areaKey: 'craft',
    deadline: '2026-12-31' as DesiredKeyResultAnchor['deadline'],
    location: { projectId: PROJECT, sectionId: SECTION },
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
  it('is created at its area’s home when it has neither a task nor a link', () => {
    const result = plan(withKeyResults([keyResultOf()]), observedOf([]), new Map(), CONFIG);

    expect(result.counts.create).toBe(1);
    const [action] = result.actions;
    expect(action).toMatchObject({ tag: 'create', subject: 'key_result', keyResultId: KR });
    expect(action?.operations[0]).toMatchObject({
      type: 'create_key_result_anchor',
      keyResultId: KR,
      draft: {
        projectId: PROJECT,
        sectionId: SECTION,
        content: 'Run a 10 km race',
        labels: ['prisme:kr'],
        priority: 'lowest',
        deadline: '2026-12-31',
      },
    });
  });

  it('is never created with no area home, and says so', () => {
    const result = plan(
      withKeyResults([keyResultOf({ location: undefined })]),
      observedOf([]),
      new Map(),
      CONFIG,
    );
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
