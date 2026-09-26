import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  CONFIG,
  day,
  desiredOf,
  lastAppliedOf,
  observedOf,
  PROJECT,
  SECTION,
  taskOf,
} from '../test-support/builders.js';
import { applyInMemory, type World } from '../test-support/world.js';
import { plan } from './plan.js';
import { changesOf, type Action } from './types.js';

/**
 * **Adopting a task must not rewrite it** — the user guide's G1, G2 and G3.
 *
 * ADR-0010 says adoption creates nothing. Until this file, it could still
 * *erase*: adoption copied a task's title and area, set the initiative to
 * `inbox`, and the first writing pass after the link then treated every
 * difference as prisme stating its own value for the first time. On a task
 * somebody had carefully set up, that meant
 *
 *   - its deadline **cleared**, because the initiative had none;
 *   - its priority **reset to the lowest**, because `inbox` maps there;
 *   - the task **moved** to the area's first mapping, if it was filed in
 *     another location of the same area.
 *
 * Each is an `update` rather than a conflict, so it would have been applied
 * silently. The tests below run the planner over **two passes** — link, then
 * the pass after — because the damage was always in the second one.
 */

const ADOPTED = 'init-adopted';
const OTHER_PROJECT = 'project-0002';

/** A task as somebody left it: high priority, a deadline, in a second location of its area. */
function handMadeTask() {
  return taskOf({
    externalId: 'task-hand',
    projectId: OTHER_PROJECT,
    sectionId: undefined,
    content: 'Ship the first slice',
    labels: [],
    priority: 'high',
    deadline: day('2026-12-01'),
    description: { text: 'Notes somebody wrote', segments: [], urls: [] },
  });
}

function adoptedAnchor(overrides: Parameters<typeof anchorOf>[0] = {}) {
  return anchorOf({
    initiativeId: ADOPTED,
    origin: 'adopted',
    status: 'inbox',
    priority: 'lowest',
    locationSource: 'area',
    pendingExternalId: 'task-hand',
    ...overrides,
  });
}

/** `craft` maps to two locations: the home, and a second whole project. */
const AREAS = [
  [PROJECT, SECTION, 'craft'],
  [OTHER_PROJECT, undefined, 'craft'],
] as const;

function twoPasses(start: World): { readonly first: Action[]; readonly second: Action[] } {
  const firstPlan = plan(start.desired, start.observed, start.lastApplied, CONFIG);
  const world = applyInMemory(start, firstPlan);
  const secondPlan = plan(world.desired, world.observed, world.lastApplied, CONFIG);
  return { first: changesOf(firstPlan), second: changesOf(secondPlan) };
}

function patchedFields(actions: readonly Action[]): string[] {
  return actions
    .flatMap((action) => action.operations)
    .flatMap((operation) =>
      operation.type === 'update_task' ? Object.keys(operation.patch) : [operation.type],
    );
}

describe('the pass that links an adopted task', () => {
  it('takes over the task’s deadline instead of leaving it to be cleared', () => {
    const result = plan(
      desiredOf([adoptedAnchor()], AREAS),
      observedOf([handMadeTask()]),
      new Map(),
      CONFIG,
    );
    const adopt = changesOf(result).find((action) => action.tag === 'adopt');
    expect(adopt?.operations).toEqual([
      { type: 'bind_ref', initiativeId: ADOPTED, externalId: 'task-hand' },
      { type: 'adopt_deadline', initiativeId: ADOPTED, deadline: '2026-12-01' },
    ]);
    // Still creates nothing, and writes nothing outward.
    expect(result.counts.create).toBe(0);
    expect(patchedFields(changesOf(result))).not.toContain('deadline');
  });

  it('keeps a deadline prisme already holds — that one is prisme’s decision', () => {
    const result = plan(
      desiredOf([adoptedAnchor({ deadline: day('2026-10-15') })], AREAS),
      observedOf([handMadeTask()]),
      new Map(),
      CONFIG,
    );
    const adopt = changesOf(result).find((action) => action.tag === 'adopt');
    expect(adopt?.operations.map((operation) => operation.type)).toEqual(['bind_ref']);
  });
});

describe('the pass after it', () => {
  it('leaves the deadline, the priority and the location exactly as they were', () => {
    const { second } = twoPasses({
      desired: desiredOf([adoptedAnchor()], AREAS),
      observed: observedOf([handMadeTask()]),
      lastApplied: new Map(),
    });

    const fields = patchedFields(second);
    expect(fields).not.toContain('deadline');
    expect(fields).not.toContain('priority');
    expect(fields).not.toContain('move_task');
    // What an anchor always carries, and nothing else: prisme's label and the
    // backlink line above the notes, which are kept.
    expect(fields.sort()).toEqual(['description', 'labels']);
  });

  it('does the same for a task labelled by hand in the task tool', () => {
    const labelled = taskOf({
      externalId: 'task-hand',
      projectId: OTHER_PROJECT,
      sectionId: undefined,
      labels: [CONFIG.anchorLabel],
      priority: 'high',
      deadline: day('2026-12-01'),
    });
    const { first } = twoPasses({
      desired: desiredOf([], AREAS),
      observed: observedOf([labelled]),
      lastApplied: new Map(),
    });
    const capture = first.flatMap((action) => action.operations)[0];
    expect(capture).toMatchObject({ type: 'capture_initiative', deadline: '2026-12-01' });
  });
});

describe('from `next` on, the anchor is prisme’s', () => {
  it('asserts the priority the ranking gives', () => {
    const result = plan(
      desiredOf(
        [
          adoptedAnchor({
            status: 'next',
            priority: 'medium',
            pendingExternalId: undefined,
            externalAnchorId: 'task-hand',
            deadline: day('2026-12-01'),
          }),
        ],
        AREAS,
      ),
      observedOf([handMadeTask()]),
      new Map(),
      CONFIG,
    );
    expect(patchedFields(changesOf(result))).toContain('priority');
  });

  it('lowers a demoted anchor whose priority it had written', () => {
    const result = plan(
      desiredOf(
        [
          adoptedAnchor({
            status: 'later',
            pendingExternalId: undefined,
            externalAnchorId: 'task-hand',
            deadline: day('2026-12-01'),
          }),
        ],
        AREAS,
      ),
      observedOf([handMadeTask()]),
      lastAppliedOf([['anchor', 'task-hand', 'priority', 'high']]),
      CONFIG,
    );
    expect(patchedFields(changesOf(result))).toContain('priority');
  });
});

describe('where a linked anchor lives', () => {
  it('moves a task that has left its area', () => {
    const result = plan(
      desiredOf(
        [adoptedAnchor({ pendingExternalId: undefined, externalAnchorId: 'task-hand' })],
        AREAS,
      ),
      observedOf([{ ...handMadeTask(), projectId: 'project-elsewhere' }]),
      new Map(),
      CONFIG,
    );
    expect(patchedFields(changesOf(result))).toContain('move_task');
  });

  it('holds an initiative’s project as a claim, even within the same area', () => {
    const result = plan(
      desiredOf(
        [
          adoptedAnchor({
            pendingExternalId: undefined,
            externalAnchorId: 'task-hand',
            locationSource: 'project',
          }),
        ],
        AREAS,
      ),
      observedOf([handMadeTask()]),
      new Map(),
      CONFIG,
    );
    expect(patchedFields(changesOf(result))).toContain('move_task');
  });
});
