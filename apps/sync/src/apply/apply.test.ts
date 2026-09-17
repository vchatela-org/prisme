import { describe, expect, it } from 'vitest';
import { ConnectorError } from '@prisme/connectors';
import { createFrozenWriter, createRecordingWriter } from '@prisme/connectors/write';
import type { TaskToolWriter } from '@prisme/connectors/write';
import {
  anchorOf,
  CONFIG,
  convergedAnchorState,
  desiredOf,
  observedOf,
  plus,
  taskOf,
} from '../test-support/builders.js';
import { createRecordingStore } from '../test-support/store.js';
import { plan } from '../reconcile/plan.js';
import type { Plan } from '../reconcile/types.js';
import { apply } from './apply.js';

const NOW = new Date('2026-09-17T09:30:00Z');

function optionsFor(
  writer: TaskToolWriter,
  store: ReturnType<typeof createRecordingStore>,
  overrides: Partial<Parameters<typeof apply>[1]> = {},
) {
  return {
    writer,
    store,
    now: () => NOW,
    runId: 'run-0001',
    writeEnabled: true,
    createThreshold: 0,
    ...overrides,
  };
}

const CREATE_PLAN: Plan = plan(
  desiredOf([anchorOf({ status: 'next', priority: 'medium' })]),
  observedOf([]),
  new Map(),
  CONFIG,
);

const CONFLICT_PLAN: Plan = plan(
  desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
  observedOf([taskOf({ content: 'Renamed by hand' })]),
  convergedAnchorState(),
  CONFIG,
);

describe('the guards, which run before anything is written', () => {
  it('refuses a plan whose creates exceed the threshold, and writes nothing', async () => {
    const writer = createRecordingWriter();
    const store = createRecordingStore();

    const result = await apply(CREATE_PLAN, optionsFor(writer.writer, store));

    expect(result.refused).toMatch(/SYNC_CREATE_THRESHOLD/);
    expect(result.applied).toBe(0);
    expect(writer.writes).toHaveLength(0);
  });

  it('is a no-op that says so when the write freeze is on', async () => {
    const store = createRecordingStore();

    const result = await apply(
      CONFLICT_PLAN,
      optionsFor(createFrozenWriter(), store, { writeEnabled: false }),
    );

    expect(result.refused).toMatch(/SYNC_WRITE_ENABLED is false/);
    expect(result.applied).toBe(0);
    expect(store.lastAppliedWrites).toHaveLength(0);
  });

  it('applies a create once the threshold allows it, and links what came back', async () => {
    const writer = createRecordingWriter({ createdIds: ['task-9001'] });
    const store = createRecordingStore();

    const result = await apply(
      CREATE_PLAN,
      optionsFor(writer.writer, store, { createThreshold: 1 }),
    );

    expect(result.applied).toBe(1);
    expect(store.binds[0]).toMatchObject({ initiativeId: 'init-001', externalId: 'task-9001' });
    // The bookkeeping a create asks for is resolved against the id the tool gave.
    expect(store.lastAppliedWrites.every((write) => write.entityId === 'task-9001')).toBe(true);
  });
});

describe('applying an action', () => {
  it('writes outward first and records last-applied only after the tool accepted it', async () => {
    const order: string[] = [];
    const store = createRecordingStore();
    const writer: TaskToolWriter = {
      createTask: () => Promise.reject(new Error('not in this plan')),
      moveTask: () => Promise.reject(new Error('not in this plan')),
      updateTask: () => {
        order.push('write');
        return Promise.resolve();
      },
    };
    const recording = {
      ...store,
      recordLastApplied: (writes: Parameters<typeof store.recordLastApplied>[0]) => {
        order.push('last_applied');
        return store.recordLastApplied(writes, NOW);
      },
    };

    await apply(CONFLICT_PLAN, optionsFor(writer, recording));

    expect(order).toEqual(['write', 'last_applied']);
  });

  it('records a conflict in the ledger and an event for the log', async () => {
    const writer = createRecordingWriter();
    const store = createRecordingStore();

    const result = await apply(CONFLICT_PLAN, optionsFor(writer.writer, store));

    expect(result.conflicts).toBe(1);
    expect(store.conflicts[0]).toMatchObject({
      entityId: 'init-001',
      field: 'title',
      resolution: 'prisme_wins',
    });
    expect(store.events[0]).toMatchObject({
      kind: 'sync_action',
      before: { title: 'Renamed by hand' },
    });
  });

  it('carries one idempotency key per write, and the same key on a retry of that write', async () => {
    const first = createRecordingWriter();
    const second = createRecordingWriter();
    const store = createRecordingStore();

    await apply(CONFLICT_PLAN, optionsFor(first.writer, store));
    await apply(CONFLICT_PLAN, optionsFor(second.writer, store));

    expect(first.writes[0]?.key).toBe(second.writes[0]?.key);
  });

  it('gives the next pass a different key, so the tool does not discard it as a duplicate', async () => {
    const first = createRecordingWriter();
    const second = createRecordingWriter();
    const store = createRecordingStore();

    await apply(CONFLICT_PLAN, optionsFor(first.writer, store));
    await apply(CONFLICT_PLAN, optionsFor(second.writer, store, { runId: 'run-0002' }));

    expect(first.writes[0]?.key).not.toBe(second.writes[0]?.key);
  });

  it('honours a status request by applying it and consuming the label', async () => {
    const writer = createRecordingWriter();
    const store = createRecordingStore();
    const requested = plan(
      desiredOf([anchorOf({ externalAnchorId: 'task-0001' })]),
      observedOf([taskOf({ labels: ['prisme', 'prisme:status:waiting'] })]),
      convergedAnchorState(),
      CONFIG,
    );

    await apply(requested, optionsFor(writer.writer, store));

    expect(store.statuses[0]).toEqual({ initiativeId: 'init-001', to: 'waiting' });
    expect(writer.writes[0]).toMatchObject({ kind: 'update', patch: { labels: ['prisme'] } });
    expect(store.events.some((event) => event.kind === 'status_changed')).toBe(true);
  });

  it('captures a hand-labelled task as an initiative bound to it, creating nothing', async () => {
    const writer = createRecordingWriter();
    const store = createRecordingStore();
    const captured = plan(
      desiredOf([]),
      observedOf([taskOf({ externalId: 'task-0500', labels: ['prisme'] })]),
      new Map(),
      CONFIG,
    );

    await apply(captured, optionsFor(writer.writer, store));

    expect(writer.writes).toHaveLength(0);
    expect(store.captures[0]).toMatchObject({ externalId: 'task-0500', areaKey: 'craft' });
    expect(store.binds[0]).toMatchObject({ externalId: 'task-0500' });
    expect(store.events.some((event) => event.kind === 'adoption_decision')).toBe(true);
  });
});

describe('when a write fails', () => {
  it('records the failure and carries on with the rest of the plan', async () => {
    const store = createRecordingStore();
    const twoAnchors = plan(
      desiredOf([
        anchorOf({ initiativeId: 'init-001', externalAnchorId: 'task-0001' }),
        anchorOf({ initiativeId: 'init-002', externalAnchorId: 'task-0002' }),
      ]),
      observedOf([
        taskOf({ content: 'Renamed by hand' }),
        taskOf({ externalId: 'task-0002', content: 'Also renamed' }),
      ]),
      plus(convergedAnchorState(), [
        ['anchor', 'task-0002', 'title', 'Ship the first slice'],
        ['anchor', 'task-0002', 'priority', 'highest'],
        ['anchor', 'task-0002', 'deadline', null],
        ['anchor', 'task-0002', 'label', 'present'],
      ]),
      CONFIG,
    );
    const writer = createRecordingWriter({
      failOn: (write) => write.kind === 'update' && write.externalId === 'task-0001',
    });

    const result = await apply(twoAnchors, optionsFor(writer.writer, store));

    expect(result.failures).toHaveLength(1);
    expect(result.applied).toBeGreaterThan(0);
    expect(result.failures[0]?.reason).not.toContain('Renamed by hand');
  });

  it('stops the pass on a rejected credential rather than retrying into a lockout', async () => {
    const store = createRecordingStore();
    const writer: TaskToolWriter = {
      createTask: () => Promise.reject(new Error('not in this plan')),
      moveTask: () => Promise.reject(new Error('not in this plan')),
      updateTask: () =>
        Promise.reject(
          new ConnectorError('invalid_token', 'the credential was rejected', {
            tool: 'task',
            operation: 'update task',
          }),
        ),
    };

    const result = await apply(CONFLICT_PLAN, optionsFor(writer, store));

    expect(result.stopped).toMatch(/credential was rejected/);
    expect(result.applied).toBe(0);
    expect(store.lastAppliedWrites).toHaveLength(0);
  });
});
