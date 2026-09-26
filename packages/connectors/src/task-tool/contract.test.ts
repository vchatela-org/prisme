import { describe, expect, it } from 'vitest';
import { isConnectorError } from '../errors.js';
import { loadFixture } from '../test-support/fixtures.js';
import { createRecordedTaskToolClient } from '../testing/recorded.js';
import { createTaskToolClient } from './client.js';
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
const completionsPage2 = loadFixture('task-tool.completions-page2.json');

function client() {
  return createRecordedTaskToolClient({
    fullSync,
    incrementalSync,
    completions: [completions, completionsPage2],
  });
}

function taskById(tasks: readonly ExternalTask[], id: string): ExternalTask {
  const found = tasks.find((task) => task.externalId === id);
  if (found === undefined) throw new Error(`the fixture has no ${id}`);
  return found;
}

describe('the location read', () => {
  it('reads projects and sections, and asks for nothing else', async () => {
    const recorded = client();
    const locations = await recorded.client.fetchLocations();
    expect(locations.projects).toHaveLength(3);
    expect(locations.sections).toHaveLength(2);

    // A Settings screen lists where work can live. Asking the tool for every
    // task to render a few dozen names would be the wrong trade.
    const form = new URLSearchParams(recorded.transport.requests[0]?.body ?? '');
    expect(JSON.parse(form.get('resource_types') ?? '[]')).toEqual(['projects', 'sections']);
  });
});

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

  it('follows the cursor even when the page was shorter than the page size', async () => {
    // The defect this pins: the endpoint may hand back fewer items than `limit`
    // **and** a `next_cursor`. Ending on "short page" instead of "no cursor"
    // truncates completion history, and capacity actuals are built from it.
    const recorded = client();
    const result = await recorded.client.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));
    expect(result).toHaveLength(4);
    expect(recorded.transport.requests).toHaveLength(2);
  });

  it('passes the cursor back, and asks for the next page by it rather than by an offset', async () => {
    const recorded = client();
    await recorded.client.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));
    const [first, second] = recorded.transport.requests;
    expect(new URL(first?.url ?? '').searchParams.get('cursor')).toBeNull();
    expect(new URL(second?.url ?? '').searchParams.get('cursor')).toBe('completion-cursor-0002');
    // An offset survived the v9 reader and means nothing to this endpoint; a
    // request carrying one would be paging a parameter the tool ignores.
    for (const request of recorded.transport.requests) {
      expect(new URL(request.url).searchParams.get('offset')).toBeNull();
    }
  });

  it('reads the window off the query string, as a GET, with `since` and `until` both set', async () => {
    const recorded = client();
    await recorded.client.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));
    const request = recorded.transport.requests[0];
    const url = new URL(request?.url ?? '');
    expect(request?.method).toBe('GET');
    expect(url.pathname).toBe('/api/v1/tasks/completed/by_completion_date');
    expect(url.searchParams.get('since')).toBe('2026-09-14T00:00:00.000Z');
    // `until` is required by the endpoint — omitting it is a 400, not a default.
    expect(url.searchParams.get('until')).not.toBeNull();
  });

  it('bounds an open-ended window at now, so a caller that omits `until` still sends one', async () => {
    const recorded = client();
    const bounded = createTaskToolClient({
      token: 'recorded-fixture-token',
      transport: recorded.transport.transport,
      now: () => new Date('2026-09-21T12:00:00.000Z'),
    });

    await bounded.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));

    expect(new URL(recorded.transport.requests[0]?.url ?? '').searchParams.get('until')).toBe(
      '2026-09-21T12:00:00.000Z',
    );
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

  it("fails on a completion still carrying v9's `task_id`, rather than losing the task it names", async () => {
    // The replacement endpoint returns the task, so the id field is `id`. A
    // reader that had not been moved would fail every page; this pins the move.
    const recorded = createRecordedTaskToolClient({
      fullSync,
      completions: [loadFixture('malformed/task-tool.completion-v9-shape.json')],
    });
    try {
      await recorded.client.fetchCompletions(new Date('2026-09-14T00:00:00.000Z'));
      expect.unreachable('the run should have failed');
    } catch (error) {
      expect(isConnectorError(error) && error.failure).toBe('invalid_shape');
      expect((error as Error).message).toMatch(/\bid\b/);
    }
  });
});
