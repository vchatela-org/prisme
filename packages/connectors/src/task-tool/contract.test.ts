import { describe, expect, it } from 'vitest';
import { isConnectorError } from '../errors.js';
import { loadFixture } from '../test-support/fixtures.js';
import { createRecordedTaskToolClient } from '../testing/recorded.js';
import { collectSubtree, indexByParent, rootsOf } from './tree.js';
import type { ExternalTask } from './types.js';

/**
 * Contract tests for the task tool, against the recorded responses in
 * `fixtures/connectors/`.
 *
 * These run the **real client** over a recorded transport, so they exercise the
 * schemas, the mapping, the priority table, the pagination and the hashing —
 * everything except the socket. A hand-written fake would satisfy the interface
 * and keep passing for months after the wire format moved.
 */

const fullSync = loadFixture('task-tool.sync-full.json');
const incrementalSync = loadFixture('task-tool.sync-incremental.json');
const completions = loadFixture('task-tool.completions.json');

function client() {
  return createRecordedTaskToolClient({ fullSync, incrementalSync, completions: [completions] });
}

function taskById(tasks: readonly ExternalTask[], id: string): ExternalTask {
  const found = tasks.find((task) => task.externalId === id);
  if (found === undefined) throw new Error(`the fixture has no ${id}`);
  return found;
}

describe('the full fetch', () => {
  it('reads projects, sections, labels and tasks', async () => {
    const snapshot = await client().client.fetchAll();
    expect(snapshot.token).toBe('sync-token-full-0001');
    expect(snapshot.projects).toHaveLength(3);
    expect(snapshot.sections).toHaveLength(2);
    expect(snapshot.labels).toHaveLength(2);
    expect(snapshot.tasks).toHaveLength(6);
  });

  it("maps the tool's priority scale, which counts the other way round", async () => {
    const { tasks } = await client().client.fetchAll();
    expect(taskById(tasks, 'task-0001').priority).toBe('highest');
    expect(taskById(tasks, 'task-0005').priority).toBe('high');
    expect(taskById(tasks, 'task-0003').priority).toBe('medium');
    expect(taskById(tasks, 'task-0006').priority).toBe('lowest');
  });

  it("reads `due` as the task tool's, and `deadline` as prisme's", async () => {
    const { tasks } = await client().client.fetchAll();
    const anchor = taskById(tasks, 'task-0001');
    expect(anchor.due?.date).toBe('2026-09-18');
    expect(anchor.deadline).toBe('2026-10-31');
  });

  it('reduces a due timestamp to a calendar day, and keeps recurrence', async () => {
    const { tasks } = await client().client.fetchAll();
    const recurring = taskById(tasks, 'task-0005');
    expect(recurring.due?.date).toBe('2026-09-20');
    expect(recurring.due?.isRecurring).toBe(true);
  });

  it('keeps minutes as capacity, and refuses to turn a day into 1440 of them', async () => {
    const { tasks } = await client().client.fetchAll();
    expect(taskById(tasks, 'task-0002').recordedMinutes).toBe(45);

    const allDay = taskById(tasks, 'task-0005');
    expect(allDay.recordedDuration).toEqual({ amount: 1, unit: 'day' });
    expect(allDay.recordedMinutes).toBeUndefined();
  });

  it('carries the archived flag rather than dropping the project', async () => {
    const { projects } = await client().client.fetchAll();
    expect(projects.find((project) => project.externalId === 'project-0003')?.archived).toBe(true);
  });

  it('collects URLs from a description and never a javascript: one', async () => {
    const { tasks } = await client().client.fetchAll();
    expect(taskById(tasks, 'task-0005').urls).toEqual(['https://example.invalid/bench']);
  });

  it('sorts labels, so a reordering in the tool is not a change', async () => {
    const { tasks } = await client().client.fetchAll();
    expect(taskById(tasks, 'task-0005').labels).toEqual(['errand', 'prisme-anchor']);
  });

  it('hashes content but not position', async () => {
    const { tasks } = await client().client.fetchAll();
    const again = await client().client.fetchAll();
    expect(taskById(tasks, 'task-0001').contentHash).toBe(
      taskById(again.tasks, 'task-0001').contentHash,
    );
  });
});

describe('tasks at any depth', () => {
  it('walks a four-level chain', async () => {
    const { tasks } = await client().client.fetchAll();
    const subtree = collectSubtree(tasks, 'task-0001');
    expect(subtree.map((task) => task.externalId)).toEqual(['task-0002', 'task-0003', 'task-0004']);
  });

  it('excludes the root, which is the anchor and not part of its own subtree', async () => {
    const { tasks } = await client().client.fetchAll();
    expect(collectSubtree(tasks, 'task-0001').map((task) => task.externalId)).not.toContain(
      'task-0001',
    );
  });

  it('returns nothing for a leaf', async () => {
    const { tasks } = await client().client.fetchAll();
    expect(collectSubtree(tasks, 'task-0004')).toEqual([]);
  });

  it('identifies the roots of a batch', async () => {
    const { tasks } = await client().client.fetchAll();
    expect(rootsOf(tasks).map((task) => task.externalId)).toEqual([
      'task-0001',
      'task-0005',
      'task-0006',
    ]);
  });

  it('terminates on a parent chain that loops, rather than hanging the pass', async () => {
    const { tasks } = await client().client.fetchAll();
    const looped = tasks.map((task) =>
      task.externalId === 'task-0001' ? { ...task, parentId: 'task-0004' } : task,
    );
    // A loop is impossible through the UI and perfectly possible in a
    // malformed response; a hang would hold the advisory lock for ever.
    expect(collectSubtree(looped, 'task-0001')).toHaveLength(3);
  });

  it('orders siblings deterministically', async () => {
    const { tasks } = await client().client.fetchAll();
    expect([...indexByParent(tasks).keys()].sort()).toEqual([
      'task-0001',
      'task-0002',
      'task-0003',
    ]);
  });
});

describe('the incremental sync', () => {
  it('returns the new token, which is the only thing the next run has', async () => {
    const result = await client().client.syncIncremental('sync-token-full-0001');
    expect(result.token).toBe('sync-token-incremental-0002');
  });

  it('reports a deletion as a change rather than an absence', async () => {
    const result = await client().client.syncIncremental('sync-token-full-0001');
    const deleted = result.changes.filter((change) => change.deleted);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.kind).toBe('task');
  });

  it('reports the collections the tool sent, and invents nothing for the ones it omitted', async () => {
    const result = await client().client.syncIncremental('sync-token-full-0001');
    const kinds = result.changes.map((change) => change.kind);
    expect(kinds.filter((kind) => kind === 'label')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'project')).toHaveLength(0);
    expect(kinds.filter((kind) => kind === 'section')).toHaveLength(0);
  });

  it('asks for a full sync when it has no token', async () => {
    const recorded = client();
    const result = await recorded.client.syncIncremental();
    expect(result.token).toBe('sync-token-full-0001');
    const sent = new URLSearchParams(recorded.transport.requests[0]?.body ?? '');
    expect(sent.get('sync_token')).toBe('*');
  });

  it("changes a task's hash when its content moved, and only then", async () => {
    const before = await client().client.fetchAll();
    const after = await client().client.syncIncremental('sync-token-full-0001');

    const edited = after.changes.find(
      (change) => change.kind === 'task' && change.task.externalId === 'task-0001',
    );
    expect(edited?.kind).toBe('task');
    expect(edited && edited.kind === 'task' && edited.task.contentHash).not.toBe(
      taskById(before.tasks, 'task-0001').contentHash,
    );
  });
});

describe('completion history', () => {
  it('reads completions with their durations', async () => {
    const result = await client().client.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));
    expect(result).toHaveLength(4);
    expect(result[0]?.externalTaskId).toBe('task-0003');
    expect(result[0]?.recordedMinutes).toBe(10);
  });

  it('leaves recordedMinutes absent when the tool recorded nothing', async () => {
    const result = await client().client.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));
    expect(result[2]?.recordedMinutes).toBeUndefined();
  });

  it('parses a timestamp with more fractional digits than Date promises to accept', async () => {
    const result = await client().client.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));
    expect(result[0]?.completedAt.toISOString()).toBe('2026-09-14T09:12:00.000Z');
  });

  it('stops at the first short page rather than paging for ever', async () => {
    const recorded = client();
    await recorded.client.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));
    expect(recorded.transport.requests).toHaveLength(1);
  });
});

describe('a response that does not match', () => {
  const failing = async (fixture: string, expected: RegExp) => {
    const recorded = createRecordedTaskToolClient({ fullSync: loadFixture(fixture) });
    try {
      await recorded.client.fetchAll();
      expect.unreachable('the run should have failed');
    } catch (error) {
      expect(isConnectorError(error) && error.failure).toBe('invalid_shape');
      expect((error as Error).message).toMatch(expected);
    }
  };

  it('fails on a priority outside the documented range, rather than clamping it', async () => {
    await failing('malformed/task-tool.priority-out-of-range.json', /priority/);
  });

  it('fails on is_deleted as an integer, rather than trusting truthiness', async () => {
    await failing('malformed/task-tool.deleted-as-integer.json', /is_deleted.*expected boolean/);
  });

  it('fails on a missing sync token, rather than silently re-reading the world', async () => {
    await failing('malformed/task-tool.no-sync-token.json', /sync_token/);
  });
});
