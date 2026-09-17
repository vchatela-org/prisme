import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  CONFIG,
  convergedAnchorState,
  day,
  desiredOf,
  lastAppliedOf,
  observedOf,
  PROJECT,
  SECTION,
  taskOf,
} from '../test-support/builders.js';
import { managedLine } from './description.js';
import { plan } from './plan.js';
import { changesOf, type Action, type Plan } from './types.js';

const NOTHING_APPLIED = new Map();

function tagsOf(result: Plan): string[] {
  return changesOf(result).map((action) => action.tag);
}

function only(result: Plan, tag: string): Action {
  const matching = changesOf(result).filter((action) => action.tag === tag);
  expect(matching).toHaveLength(1);
  return matching[0] as Action;
}

describe('an initiative with no anchor', () => {
  it('creates one when prisme made it and it has reached `next`', () => {
    const result = plan(
      desiredOf([anchorOf({ status: 'next', priority: 'medium' })]),
      observedOf([]),
      NOTHING_APPLIED,
      CONFIG,
    );

    expect(result.counts.create).toBe(1);
    const action = only(result, 'create');
    expect(action.operations[0]).toMatchObject({
      type: 'create_anchor',
      draft: {
        projectId: PROJECT,
        sectionId: SECTION,
        content: 'Ship the first slice',
        labels: ['prisme'],
        priority: 'medium',
      },
    });
  });

  it('creates nothing before `next`: an idea in the inbox has no anchor', () => {
    for (const status of ['inbox', 'later'] as const) {
      const result = plan(
        desiredOf([anchorOf({ status })]),
        observedOf([]),
        NOTHING_APPLIED,
        CONFIG,
      );
      expect(result.counts.create).toBe(0);
      expect(result.counts.skip).toBe(1);
    }
  });

  it('asks for a human rather than guessing a location when no area is mapped', () => {
    const result = plan(
      desiredOf([anchorOf({ location: undefined })]),
      observedOf([]),
      NOTHING_APPLIED,
      CONFIG,
    );

    expect(result.counts.create).toBe(0);
    expect(only(result, 'review').detail).toMatch(/no area mapping/);
  });

  it('honours a link the adoption queue decided, and creates nothing for it', () => {
    const result = plan(
      desiredOf([anchorOf({ pendingExternalId: 'task-0001' })]),
      observedOf([taskOf({ labels: [] })]),
      NOTHING_APPLIED,
      CONFIG,
    );

    expect(result.counts.create).toBe(0);
    expect(only(result, 'adopt').operations[0]).toEqual({
      type: 'bind_ref',
      initiativeId: 'init-001',
      externalId: 'task-0001',
    });
  });

  it('refuses a decided link that would bind a task already bound elsewhere', () => {
    const result = plan(
      desiredOf([
        anchorOf({ initiativeId: 'init-001', externalAnchorId: 'task-0001' }),
        anchorOf({ initiativeId: 'init-002', pendingExternalId: 'task-0001' }),
      ]),
      observedOf([taskOf()]),
      convergedAnchorState(),
      CONFIG,
    );

    expect(result.counts.adopt).toBe(0);
    expect(only(result, 'review').detail).toMatch(/already bound/);
  });
});

describe('a linked anchor', () => {
  it('is left alone when everything already matches', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([taskOf()]),
      convergedAnchorState(),
      CONFIG,
    );

    expect(changesOf(result)).toHaveLength(0);
    expect(result.counts.skip).toBe(1);
  });

  it('collects every prisme-owned change into one update', () => {
    const result = plan(
      desiredOf([
        anchorOf({ externalAnchorId: 'task-0001', title: 'Renamed', deadline: day('2026-10-01') }),
      ]),
      observedOf([taskOf({ priority: 'lowest' })]),
      // prisme last wrote `lowest` here, so raising it is prisme changing its
      // mind rather than someone else's edit being overruled.
      convergedAnchorState('task-0001', { priority: 'lowest' }),
      CONFIG,
    );

    const action = only(result, 'update');
    expect(action.operations).toHaveLength(1);
    expect(action.operations[0]).toMatchObject({
      type: 'update_task',
      patch: { content: 'Renamed', priority: 'highest', deadline: day('2026-10-01') },
    });
    expect(action.lastApplied.map((write) => write.field).sort()).toEqual([
      'deadline',
      'priority',
      'title',
    ]);
  });

  it('clears a deadline prisme no longer holds, rather than leaving a stale one', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([taskOf({ deadline: day('2026-10-01') })]),
      convergedAnchorState('task-0001', { deadline: day('2026-10-01') }),
      CONFIG,
    );

    expect(only(result, 'update').operations[0]).toMatchObject({ patch: { deadline: null } });
  });

  it('keeps the labels the task tool owns when it restores its own', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([taskOf({ labels: ['errand', 'phone'] })]),
      convergedAnchorState(),
      CONFIG,
    );

    const conflict = only(result, 'conflict');
    expect(conflict.operations[0]).toMatchObject({
      patch: { labels: ['errand', 'phone', 'prisme'] },
    });
  });

  it('writes the backlink as the first line and leaves the rest of the description alone', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([
        taskOf({
          description: { text: 'my own notes\nsecond line', segments: [], urls: [] },
        }),
      ]),
      convergedAnchorState(),
      CONFIG,
    );

    const conflict = only(result, 'conflict');
    expect(conflict.operations[0]).toMatchObject({
      patch: {
        description: `${managedLine(CONFIG.baseUrl, 'init-001')}\nmy own notes\nsecond line`,
      },
    });
  });

  it('moves an anchor into its area’s project, and reports a hand move as a conflict', () => {
    const elsewhere = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([taskOf({ projectId: 'project-0009', sectionId: undefined })]),
      convergedAnchorState(),
      CONFIG,
    );

    expect(only(elsewhere, 'update').operations[0]).toMatchObject({
      type: 'move_task',
      location: { projectId: PROJECT, sectionId: SECTION },
    });
  });

  it('leaves the section alone when prisme has no opinion about one', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001', location: { projectId: PROJECT } })]),
      observedOf([taskOf({ sectionId: 'section-0009' })]),
      convergedAnchorState(),
      CONFIG,
    );

    expect(changesOf(result)).toHaveLength(0);
  });

  it('asks a human when the linked anchor is not in what the tool returned', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0404' })]),
      observedOf([]),
      NOTHING_APPLIED,
      CONFIG,
    );

    expect(result.counts.create).toBe(0);
    expect(only(result, 'review').detail).toMatch(/will not recreate/);
  });
});

describe('completion, which arrives inward', () => {
  it('moves the initiative to review and never touches the task', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([taskOf({ completed: true })]),
      convergedAnchorState(),
      CONFIG,
    );

    const action = only(result, 'review');
    expect(action.operations).toEqual([
      { type: 'set_status', initiativeId: 'init-001', from: 'now', to: 'review' },
    ]);
    expect(tagsOf(result)).not.toContain('update');
  });

  it('says nothing more once the initiative is already in review or closed', () => {
    for (const status of ['review', 'done', 'dropped'] as const) {
      const result = plan(
        desiredOf([anchorOf({ externalAnchorId: 'task-0001', status, priority: 'lowest' })]),
        observedOf([taskOf({ completed: true, priority: 'lowest' })]),
        convergedAnchorState('task-0001', { priority: 'lowest' }),
        CONFIG,
      );
      expect(result.counts.review).toBe(0);
    }
  });
});

describe('the roll-up prisme derives from a subtree', () => {
  it('counts subtasks rather than copying them', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([
        taskOf(),
        taskOf({
          externalId: 'task-0002',
          parentId: 'task-0001',
          completed: true,
          priority: 'highest',
        }),
        taskOf({ externalId: 'task-0003', parentId: 'task-0001', priority: 'highest' }),
      ]),
      convergedAnchorState(),
      CONFIG,
    );

    const rollup = changesOf(result).find((action) => action.subject === 'prisme');
    expect(rollup?.operations[0]).toMatchObject({
      type: 'record_rollup',
      rollup: { progress: 50, openTaskCount: 1 },
    });
  });

  it('says nothing when the roll-up is what prisme already believes', () => {
    const result = plan(
      desiredOf([
        anchorOf({
          externalAnchorId: 'task-0001',
          rollup: { progress: 0, openTaskCount: 0 },
        }),
      ]),
      observedOf([taskOf()]),
      convergedAnchorState(),
      CONFIG,
    );

    expect(changesOf(result)).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('produces the same plan, in the same order, from the same state', () => {
    const desired = desiredOf([
      anchorOf({ initiativeId: 'init-003', externalAnchorId: 'task-0003' }),
      anchorOf({ initiativeId: 'init-001', externalAnchorId: 'task-0001' }),
      anchorOf({ initiativeId: 'init-002', status: 'next', priority: 'medium' }),
    ]);
    const observed = observedOf([
      taskOf({ externalId: 'task-0003', content: 'Third', priority: 'lowest' }),
      taskOf({ externalId: 'task-0001' }),
    ]);
    const lastApplied = lastAppliedOf([['anchor', 'task-0003', 'priority', 'lowest']]);

    const first = plan(desired, observed, lastApplied, CONFIG);
    const second = plan(desired, observed, lastApplied, CONFIG);

    expect(JSON.stringify(first.actions)).toBe(JSON.stringify(second.actions));
    expect(first.actions.map((action) => action.initiativeId)).toEqual([
      'init-001',
      'init-002',
      'init-003',
    ]);
  });
});
