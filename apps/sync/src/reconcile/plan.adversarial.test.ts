import { describe, expect, it } from 'vitest';
import { INITIATIVE_STATUSES, ORIGINS } from '@prisme/domain';
import {
  anchorOf,
  CONFIG,
  convergedAnchorState,
  desiredOf,
  observedOf,
  taskOf,
} from '../test-support/builders.js';
import { plan } from './plan.js';
import { changesOf } from './types.js';

/**
 * **The adversarial test** (docs/13-migration.md §8, W04 *Definition of done*).
 *
 * > An adopted entity, through the planner, produces **zero** `create` actions.
 *
 * This file is the executable form of guard 2 (ADR-0010). It exists so that
 * deleting the provenance check in `plan.ts` as "redundant" fails loudly rather
 * than quietly duplicating someone's real task list.
 *
 * It is exhaustive rather than sampled: the input space is closed — two
 * origins, eight statuses, three link states, present or absent, labelled or
 * not — so every one of the 192 combinations is run. A sampled version of this
 * test would pass on the day the bug was introduced.
 */

type LinkState = 'unlinked' | 'pending' | 'bound';

const LINK_STATES: readonly LinkState[] = ['unlinked', 'pending', 'bound'];

function caseFor(
  origin: (typeof ORIGINS)[number],
  status: (typeof INITIATIVE_STATUSES)[number],
  link: LinkState,
  taskPresent: boolean,
  labelled: boolean,
) {
  const desired = desiredOf([
    anchorOf({
      origin,
      status,
      ...(link === 'bound' ? { externalAnchorId: 'task-0001' } : {}),
      ...(link === 'pending' ? { pendingExternalId: 'task-0001' } : {}),
    }),
  ]);
  const observed = observedOf(
    taskPresent ? [taskOf({ labels: labelled ? [CONFIG.anchorLabel] : [] })] : [],
  );
  return plan(desired, observed, convergedAnchorState(), CONFIG);
}

describe('an adopted entity can never produce a create', () => {
  it('holds for every status, link state and observation', () => {
    for (const status of INITIATIVE_STATUSES) {
      for (const link of LINK_STATES) {
        for (const taskPresent of [true, false]) {
          for (const labelled of [true, false]) {
            const result = caseFor('adopted', status, link, taskPresent, labelled);
            expect(
              result.counts.create,
              `adopted/${status}/${link}/${taskPresent ? 'present' : 'absent'}/${labelled ? 'labelled' : 'unlabelled'}`,
            ).toBe(0);
            expect(
              result.actions.flatMap((action) => action.operations),
              'no create_anchor operation may appear for an adopted entity',
            ).not.toContainEqual(expect.objectContaining({ type: 'create_anchor' }));
          }
        }
      }
    }
  });

  it('is the only rule that lets a create through, for either origin', () => {
    for (const origin of ORIGINS) {
      for (const status of INITIATIVE_STATUSES) {
        for (const link of LINK_STATES) {
          for (const taskPresent of [true, false]) {
            for (const labelled of [true, false]) {
              const result = caseFor(origin, status, link, taskPresent, labelled);
              if (result.counts.create === 0) continue;

              // The guard, restated as an assertion about the *input* that
              // produced the create: prisme made this entity, and nothing is
              // linked to it.
              expect(origin).toBe('created_in_prisme');
              expect(link).toBe('unlinked');
            }
          }
        }
      }
    }
  });
});

describe('an existing external object is linked, never duplicated', () => {
  it('adopts a hand-labelled task instead of making another one', () => {
    const result = plan(
      desiredOf([]),
      observedOf([taskOf({ externalId: 'task-0500', labels: [CONFIG.anchorLabel] })]),
      new Map(),
      CONFIG,
    );

    expect(result.counts.create).toBe(0);
    expect(result.counts.adopt).toBe(1);
    expect(changesOf(result)[0]?.operations[0]).toMatchObject({
      type: 'capture_initiative',
      externalId: 'task-0500',
    });
  });

  it('refuses to guess an area for a labelled task in an unmapped project', () => {
    const result = plan(
      desiredOf([], []),
      observedOf([taskOf({ externalId: 'task-0500', labels: [CONFIG.anchorLabel] })]),
      new Map(),
      CONFIG,
    );

    expect(result.counts.create).toBe(0);
    expect(result.counts.adopt).toBe(0);
    expect(result.counts.review).toBe(1);
  });

  it('leaves a labelled task alone once it is bound to an initiative', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([taskOf()]),
      convergedAnchorState(),
      CONFIG,
    );

    expect(result.counts.adopt).toBe(0);
    expect(result.counts.create).toBe(0);
  });
});
