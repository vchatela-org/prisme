import { describe, expect, it } from 'vitest';
import type { ExternalTask } from '@prisme/connectors';
import {
  anchorOf,
  CONFIG,
  convergedAnchorState,
  day,
  desiredOf,
  observedOf,
  plus,
  PROJECT,
  SECTION,
  taskOf,
} from '../test-support/builders.js';
import { managedLine } from './description.js';
import { plan } from './plan.js';
import { changesOf, type Plan } from './types.js';

/**
 * **The conflict matrix** (W04 *Definition of done*).
 *
 * > Every prisme-owned field edited externally produces a conflict, and every
 * > intent-channel action produces a request instead.
 *
 * Both halves are here, because they are the same question asked twice: what
 * happens when the world changed underneath prisme. The answer is *prisme
 * wins, and says so* — except for the small, deliberate list of edits that are
 * requests (docs/16-sync.md §4). A field that drifts between the two lists is
 * the bug this file catches.
 */

const ANCHORED = anchorOf({ externalAnchorId: 'task-0001', deadline: day('2026-10-01') });

const CONVERGED = convergedAnchorState('task-0001', { deadline: day('2026-10-01') });

function planOf(task: ExternalTask): Plan {
  return plan(desiredOf([ANCHORED]), observedOf([task]), CONVERGED, CONFIG);
}

/** One row per prisme-owned field, with the external edit that breaks it. */
const OWNED_FIELDS: readonly {
  readonly field: string;
  readonly edited: Partial<ExternalTask>;
  readonly restores: (patch: Record<string, unknown>) => void;
}[] = [
  {
    field: 'title',
    edited: { content: 'Renamed in the task tool' },
    restores: (patch) => expect(patch['content']).toBe('Ship the first slice'),
  },
  {
    field: 'priority',
    edited: { priority: 'lowest' },
    restores: (patch) => expect(patch['priority']).toBe('highest'),
  },
  {
    field: 'deadline',
    edited: { deadline: day('2026-12-25') },
    restores: (patch) => expect(patch['deadline']).toBe('2026-10-01'),
  },
  {
    field: 'label',
    edited: { labels: [] },
    restores: (patch) => expect(patch['labels']).toEqual(['prisme']),
  },
  {
    field: 'description',
    edited: { description: { text: 'the backlink was deleted', segments: [], urls: [] } },
    restores: (patch) =>
      expect(String(patch['description'])).toContain(managedLine(CONFIG.baseUrl, 'init-001')),
  },
];

describe('a prisme-owned field edited in the task tool', () => {
  for (const row of OWNED_FIELDS) {
    it(`reports a conflict on ${row.field}, restores prisme's value, and writes the ledger`, () => {
      const result = planOf(taskOf({ deadline: day('2026-10-01'), ...row.edited }));

      const conflicts = changesOf(result).filter((action) => action.tag === 'conflict');
      expect(conflicts).toHaveLength(1);

      const action = conflicts[0];
      expect(action?.conflict).toMatchObject({
        entityId: 'init-001',
        field: row.field,
        resolution: 'prisme_wins',
      });

      const operation = action?.operations[0];
      expect(operation?.type).toBe('update_task');
      row.restores((operation as unknown as { patch: Record<string, unknown> }).patch);
    });
  }

  it('reports a move out of the area as a conflict too, and moves it back', () => {
    const result = plan(
      desiredOf([ANCHORED]),
      observedOf([
        taskOf({ deadline: day('2026-10-01'), projectId: 'project-0009', sectionId: undefined }),
      ]),
      // prisme put the anchor here, so finding it elsewhere is someone's edit.
      plus(CONVERGED, [['anchor', 'task-0001', 'location', `${PROJECT}/${SECTION}`]]),
      CONFIG,
    );

    const conflict = changesOf(result).find((action) => action.tag === 'conflict');
    expect(conflict?.conflict?.field).toBe('location');
    expect(conflict?.operations[0]).toMatchObject({
      type: 'move_task',
      location: { projectId: PROJECT, sectionId: SECTION },
    });
  });

  it('is an update, not a conflict, when the value is the one prisme last wrote', () => {
    // prisme changed its mind: the anchor still holds what prisme put there.
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001', title: 'A better outcome' })]),
      observedOf([taskOf()]),
      convergedAnchorState(),
      CONFIG,
    );

    expect(result.counts.conflict).toBe(0);
    expect(result.counts.update).toBe(1);
  });

  it('is an update, not a conflict, the first time prisme states a value at all', () => {
    const result = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001', title: 'A better outcome' })]),
      observedOf([taskOf()]),
      new Map(),
      CONFIG,
    );

    expect(result.counts.conflict).toBe(0);
    expect(result.counts.update).toBe(1);
  });
});

describe('the intent channel: edits that are requests, not conflicts', () => {
  it('does nothing about a due date, which is the task tool’s', () => {
    const result = planOf(
      taskOf({ deadline: day('2026-10-01'), due: { date: day('2026-09-20'), isRecurring: false } }),
    );

    expect(changesOf(result)).toHaveLength(0);
  });

  it('does nothing about the labels the task tool owns', () => {
    const result = planOf(taskOf({ deadline: day('2026-10-01'), labels: ['errand', 'prisme'] }));

    expect(changesOf(result)).toHaveLength(0);
  });

  it('does nothing about content added below prisme’s first line', () => {
    const result = planOf(
      taskOf({
        deadline: day('2026-10-01'),
        description: {
          text: `${managedLine(CONFIG.baseUrl, 'init-001')}\nmy notes, added on a train`,
          segments: [],
          urls: [],
        },
      }),
    );

    expect(changesOf(result)).toHaveLength(0);
  });

  it('treats a completed anchor as a request to confirm, never as a conflict', () => {
    const result = planOf(taskOf({ deadline: day('2026-10-01'), completed: true }));

    expect(result.counts.conflict).toBe(0);
    expect(changesOf(result)[0]?.operations[0]).toMatchObject({ type: 'set_status', to: 'review' });
  });

  it('honours a status-request label and consumes it in the same action', () => {
    const result = planOf(
      taskOf({ deadline: day('2026-10-01'), labels: ['prisme', 'prisme:status:waiting'] }),
    );

    expect(result.counts.conflict).toBe(0);
    const action = changesOf(result)[0];
    expect(action?.operations[0]).toMatchObject({
      type: 'set_status',
      from: 'now',
      to: 'waiting',
    });
    expect(action?.operations[1]).toMatchObject({
      type: 'update_task',
      patch: { labels: ['prisme'] },
    });
  });

  it('consumes a status-request label that asks for the status already in force', () => {
    const result = planOf(
      taskOf({ deadline: day('2026-10-01'), labels: ['prisme', 'prisme:status:now'] }),
    );

    const action = changesOf(result)[0];
    expect(action?.operations).toHaveLength(1);
    expect(action?.operations[0]).toMatchObject({
      type: 'update_task',
      patch: { labels: ['prisme'] },
    });
  });

  it('ignores a misspelt status label rather than acting on the nearest match', () => {
    const result = planOf(
      taskOf({ deadline: day('2026-10-01'), labels: ['prisme', 'prisme:status:done-ish'] }),
    );

    expect(changesOf(result)).toHaveLength(0);
  });
});
