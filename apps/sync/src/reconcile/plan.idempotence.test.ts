import { describe, expect, it } from 'vitest';
import {
  anchorOf,
  CONFIG,
  convergedAnchorState,
  day,
  desiredOf,
  observedOf,
  taskOf,
} from '../test-support/builders.js';
import { applyInMemory, type World } from '../test-support/world.js';
import { plan } from './plan.js';
import { changesOf } from './types.js';

/**
 * **Idempotence and convergence** (docs/16-sync.md §8).
 *
 * > `plan` twice over unchanged state yields an empty second plan.
 *
 * The first half is trivially true of a pure function and is asserted anyway.
 * The second half is the one that matters for a level-triggered system: after
 * doing what it said it would do, the next pass must have nothing left to say.
 * A reconciler that fails this rewrites the same field every fifteen minutes
 * and looks perfectly healthy while doing it.
 */

function passes(start: World, rounds: number): { readonly world: World; readonly plans: number[] } {
  let world = start;
  const plans: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const result = plan(world.desired, world.observed, world.lastApplied, CONFIG);
    plans.push(changesOf(result).length);
    world = applyInMemory(world, result);
  }
  return { world, plans };
}

describe('planning the same state twice', () => {
  it('produces the same plan both times', () => {
    const world: World = {
      desired: desiredOf([anchorOf({ externalAnchorId: 'task-0001', title: 'Renamed' })]),
      observed: observedOf([taskOf()]),
      lastApplied: convergedAnchorState(),
    };

    const first = plan(world.desired, world.observed, world.lastApplied, CONFIG);
    const second = plan(world.desired, world.observed, world.lastApplied, CONFIG);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('planning again after applying', () => {
  it('has nothing left to say about a converged anchor', () => {
    const world: World = {
      desired: desiredOf([
        anchorOf({ externalAnchorId: 'task-0001', title: 'Renamed', deadline: day('2026-11-30') }),
      ]),
      observed: observedOf([taskOf({ priority: 'lowest', labels: [] })]),
      lastApplied: convergedAnchorState(),
    };

    const { plans } = passes(world, 2);

    expect(plans[0]).toBeGreaterThan(0);
    expect(plans[1]).toBe(0);
  });

  it('creates an anchor once, and never a second one', () => {
    const world: World = {
      desired: desiredOf([anchorOf({ status: 'next', priority: 'medium' })]),
      observed: observedOf([]),
      lastApplied: new Map(),
    };

    const { world: settled, plans } = passes(world, 3);

    expect(plans).toEqual([1, 0, 0]);
    expect(settled.observed.tasks).toHaveLength(1);
  });

  it('settles a world of conflicts, requests and subtasks rather than oscillating', () => {
    const world: World = {
      desired: desiredOf([
        anchorOf({
          initiativeId: 'init-001',
          externalAnchorId: 'task-0001',
          title: 'The outcome prisme holds',
          deadline: day('2026-10-01'),
        }),
        anchorOf({ initiativeId: 'init-002', status: 'next', priority: 'medium' }),
      ]),
      observed: observedOf([
        // Renamed, de-labelled and re-prioritised by hand: three conflicts.
        taskOf({ content: 'Renamed on a phone', labels: ['errand'], priority: 'lowest' }),
        taskOf({
          externalId: 'task-0002',
          parentId: 'task-0001',
          content: 'A subtask',
          labels: [],
          priority: 'lowest',
        }),
        // Labelled by hand: a capture, which creates nothing.
        taskOf({ externalId: 'task-0500', content: 'Labelled on a train', priority: 'medium' }),
      ]),
      lastApplied: convergedAnchorState('task-0001', { deadline: day('2026-10-01') }),
    };

    const { plans, world: settled } = passes(world, 4);

    expect(plans[0]).toBeGreaterThan(0);
    // Everything is decided within three passes and stays decided.
    expect(plans.at(-1)).toBe(0);
    expect(settled.desired.anchors).toHaveLength(3);
    // The capture linked the existing task; nothing new was created for it.
    expect(
      settled.observed.tasks.filter((task) => task.content === 'Labelled on a train'),
    ).toHaveLength(1);
  });
});
