import { describe, expect, it } from 'vitest';
import { createRecordedTaskToolClient } from '@prisme/connectors/testing';
import { createFrozenWriter, createRecordingWriter } from '@prisme/connectors/write';
import { anchorOf, CONFIG, desiredOf, taskOf } from './test-support/builders.js';
import { createRecordingStore } from './test-support/store.js';
import { isFullPassDue, reconcile } from './run.js';

/**
 * The pass, end to end, over a recorded transport and an in-memory store.
 *
 * **No test may call a real external API** (docs/16-sync.md §8): the client
 * here is the real one, over a transport that cannot open a socket.
 */

const NOW = new Date('2026-09-17T09:00:00Z');

/** A synthetic sync response holding one labelled task in a mapped project. */
const FULL_SYNC = {
  sync_token: 'sync-token-0002',
  full_sync: true,
  items: [
    {
      id: 'task-0001',
      project_id: 'project-0001',
      section_id: 'section-0001',
      content: 'Renamed by hand',
      description: '',
      priority: 4,
      labels: ['prisme'],
      checked: false,
      is_deleted: false,
    },
  ],
  projects: [],
  sections: [],
  labels: [],
};

function optionsFor(overrides: Record<string, unknown> = {}) {
  const store = createRecordingStore(
    desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
    new Map(),
  );
  const recorded = createRecordedTaskToolClient({ fullSync: FULL_SYNC });
  const writer = createRecordingWriter();

  return {
    store,
    recorded,
    writer,
    options: {
      mode: 'plan' as const,
      store,
      taskClient: recorded.client,
      writer: writer.writer,
      writeEnabled: true,
      createThreshold: 0,
      baseUrl: CONFIG.baseUrl,
      runId: 'run-0001',
      now: () => NOW,
      ...overrides,
    },
  };
}

describe('a `plan` pass', () => {
  it('writes nothing — not outward, not to the cursor', async () => {
    const { options, store, writer } = optionsFor();

    const result = await reconcile(options);

    expect(result.report).toContain('Plan:');
    expect(writer.writes).toHaveLength(0);
    expect(store.cursors).toHaveLength(0);
    expect(store.lastAppliedWrites).toHaveLength(0);
  });

  it('does not advance the tool’s cursor either, because that is a side effect', async () => {
    const { options, recorded } = optionsFor();

    await reconcile(options);

    const tokens = recorded.transport.requests.map((request) =>
      new URLSearchParams(request.body ?? '').get('sync_token'),
    );
    expect(tokens).toEqual(['*']);
  });
});

describe('an `apply` pass', () => {
  it('applies, then advances the cursor it just acted on', async () => {
    const { options, store, writer } = optionsFor({ mode: 'apply' });

    const result = await reconcile(options);

    expect(result.applied?.applied).toBeGreaterThan(0);
    expect(writer.writes.length).toBeGreaterThan(0);
    expect(store.cursors[0]).toMatchObject({
      taskToolToken: 'sync-token-0002',
      lastFullPassAt: NOW,
    });
  });

  it('leaves the cursor alone when the plan was refused', async () => {
    const { options, store } = optionsFor({
      mode: 'apply',
      writeEnabled: false,
      writer: createFrozenWriter(),
    });

    const result = await reconcile(options);

    expect(result.applied?.refused).toMatch(/SYNC_WRITE_ENABLED/);
    expect(store.cursors).toHaveLength(0);
  });

  it('counts what the incremental view missed as drift', async () => {
    // The recorded incremental response reports nothing changed, while the
    // full view finds a task prisme must act on: that is exactly one object
    // the incremental path would have missed.
    const store = createRecordingStore(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      new Map(),
      // A pass that has run before, so the incremental read has a cursor to
      // read from rather than falling back to everything.
      { taskToolToken: 'sync-token-0001', lastFullPassAt: new Date('2026-09-17T08:00:00Z') },
    );
    const recorded = createRecordedTaskToolClient({
      fullSync: FULL_SYNC,
      incrementalSync: { sync_token: 'sync-token-0002', items: [] },
    });
    const writer = createRecordingWriter();

    const result = await reconcile({
      mode: 'apply',
      store,
      taskClient: recorded.client,
      writer: writer.writer,
      writeEnabled: true,
      createThreshold: 0,
      baseUrl: CONFIG.baseUrl,
      runId: 'run-0001',
      now: () => NOW,
    });

    expect(result.drift).toBe(1);
    expect(result.report).toContain('drift=1');
  });
});

describe('when a full pass is due', () => {
  it('is due on the first run and once a day after that', () => {
    expect(isFullPassDue(undefined, NOW)).toBe(true);
    expect(isFullPassDue(new Date('2026-09-17T08:00:00Z'), NOW)).toBe(false);
    expect(isFullPassDue(new Date('2026-09-16T08:00:00Z'), NOW)).toBe(true);
  });
});

describe('the observed state', () => {
  it('is the whole task tool, because the planner compares full state to full state', async () => {
    const { options, recorded } = optionsFor({ mode: 'apply' });

    await reconcile(options);

    // Two reads: the incremental one that measures drift, and the full one the
    // planner actually decides from.
    const tokens = recorded.transport.requests.map((request) =>
      new URLSearchParams(request.body ?? '').get('sync_token'),
    );
    expect(tokens).toEqual(['*', '*']);
    expect(taskOf().externalId).toBe('task-0001');
  });
});
