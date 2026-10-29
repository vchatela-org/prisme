import { describe, expect, it } from 'vitest';
import type { Completion, CompletionEvent } from '@prisme/connectors';

import { mergeCompletions, READ_MARGIN_MS, standingCompletions } from './completions.js';
import { backfill } from './run.js';
import { createFakeStore, createFakeTaskClient } from './test-support/fakes.js';

/**
 * Completions from two records (ADR-0040): the completion history, which lists
 * a task once it is checked, and the activity log, which has one entry per
 * completion — a recurring task's occurrences included.
 *
 * The properties pinned here, in the order they would hurt:
 *
 *   1. a re-run never double-counts, including over rows the earlier,
 *      history-only reader stored;
 *   2. a recurring task completed three times is three completions;
 *   3. a completion taken back is not counted;
 *   4. history the log no longer reaches is not dropped.
 *
 * All synthetic: invented task ids, projects and sections.
 */

const SINCE = new Date('2026-09-07T00:00:00Z');
const UNTIL = new Date('2026-09-14T00:00:00Z');

function listed(
  externalTaskId: string,
  at: string,
  overrides: Partial<Completion> = {},
): Completion {
  return { externalTaskId, completedAt: new Date(at), projectId: 'p-alpha', ...overrides };
}

function logged(
  externalTaskId: string,
  at: string,
  overrides: Partial<CompletionEvent> = {},
): CompletionEvent {
  return {
    kind: 'completed',
    externalTaskId,
    at: new Date(at),
    projectId: 'p-alpha',
    ...overrides,
  };
}

function retracted(externalTaskId: string, at: string): CompletionEvent {
  return { kind: 'uncompleted', externalTaskId, at: new Date(at), projectId: 'p-alpha' };
}

const merge = (
  history: readonly Completion[],
  events: readonly CompletionEvent[],
  openTasks: ReadonlyMap<string, { projectId: string; sectionId?: string }> = new Map(),
) => mergeCompletions({ history, events, openTasks, since: SINCE, until: UNTIL });

const keys = (completions: readonly Completion[]) =>
  completions.map((c) => `${c.externalTaskId}@${c.completedAt.toISOString()}`);

describe('a recurring task', () => {
  it('is one completion per occurrence, though the history never lists it', () => {
    const result = merge(
      [],
      [
        logged('r-sweep', '2026-09-08T07:00:00Z'),
        logged('r-sweep', '2026-09-09T07:05:00Z'),
        logged('r-sweep', '2026-09-10T06:55:00Z'),
      ],
    );
    expect(keys(result.completions)).toEqual([
      'r-sweep@2026-09-08T07:00:00.000Z',
      'r-sweep@2026-09-09T07:05:00.000Z',
      'r-sweep@2026-09-10T06:55:00.000Z',
    ]);
    expect(result.fromLogOnly).toBe(3);
  });

  it('keeps its earlier occurrences when its last is listed, completed for good', () => {
    const result = merge(
      [listed('r-sweep', '2026-09-10T06:55:00Z', { recordedMinutes: 15 })],
      [
        logged('r-sweep', '2026-09-08T07:00:00Z'),
        logged('r-sweep', '2026-09-09T07:05:00Z'),
        logged('r-sweep', '2026-09-10T06:55:00Z'),
      ],
    );
    expect(result.completions).toHaveLength(3);
    expect(result.fromLogOnly).toBe(2);
    // The listed one is the history's entry, with what only the history carries.
    expect(result.completions.at(-1)?.recordedMinutes).toBe(15);
  });
});

describe('a one-off task, in both records', () => {
  it('is one completion: the history entry, unchanged', () => {
    const entry = listed('o-plane', '2026-09-09T17:40:00Z', {
      sectionId: 's-bench',
      recordedMinutes: 90,
      recordedDuration: { amount: 90, unit: 'minute' },
      content: 'Plane the bench top',
    });
    const result = merge([entry], [logged('o-plane', '2026-09-09T17:40:00Z')]);
    expect(result.completions).toEqual([entry]);
    expect(result.fromLogOnly).toBe(0);
  });

  it('is still one completion when the two instants disagree by seconds', () => {
    // The key stays the history's — the one the earlier reader stored — so a
    // re-run over that history converges instead of adding a second row.
    const result = merge(
      [listed('o-plane', '2026-09-09T17:40:00.000Z')],
      [logged('o-plane', '2026-09-09T17:40:03.250Z')],
    );
    expect(keys(result.completions)).toEqual(['o-plane@2026-09-09T17:40:00.000Z']);
  });

  it('is never paired across more than the margin', () => {
    const result = merge(
      [listed('o-plane', '2026-09-12T10:00:00Z')],
      [
        logged(
          'o-plane',
          new Date(Date.parse('2026-09-12T10:00:00Z') - READ_MARGIN_MS - 1).toISOString(),
        ),
      ],
    );
    expect(result.completions).toHaveLength(2);
  });
});

describe('an un-completion', () => {
  it('takes back the latest completion of the same task before it', () => {
    const result = merge(
      [],
      [
        logged('o-clamps', '2026-09-09T18:05:00Z'),
        retracted('o-clamps', '2026-09-09T18:06:00Z'),
        logged('o-other', '2026-09-09T18:07:00Z'),
      ],
    );
    expect(keys(result.completions)).toEqual(['o-other@2026-09-09T18:07:00.000Z']);
    expect(result.retracted).toBe(1);
  });

  it('leaves a re-completion standing, paired with the history entry', () => {
    const result = merge(
      [listed('o-clamps', '2026-09-10T08:00:00Z')],
      [
        logged('o-clamps', '2026-09-09T18:05:00Z'),
        retracted('o-clamps', '2026-09-09T18:06:00Z'),
        logged('o-clamps', '2026-09-10T08:00:00Z'),
      ],
    );
    expect(keys(result.completions)).toEqual(['o-clamps@2026-09-10T08:00:00.000Z']);
  });

  it('with nothing before it in the read, takes nothing back', () => {
    const { standing, retracted: count } = standingCompletions([
      retracted('o-clamps', '2026-09-08T08:00:00Z'),
      logged('o-clamps', '2026-09-09T08:00:00Z'),
    ]);
    expect(standing).toHaveLength(1);
    expect(count).toBe(0);
  });
});

describe('where a log-only completion is located', () => {
  it("takes the entry's own section first", () => {
    const [only] = merge(
      [],
      [logged('r-sweep', '2026-09-08T07:00:00Z', { sectionId: 's-floor' })],
      new Map([['r-sweep', { projectId: 'p-alpha', sectionId: 's-elsewhere' }]]),
    ).completions;
    expect(only?.sectionId).toBe('s-floor');
  });

  it("takes the open task's section while the task is in the same project", () => {
    const [only] = merge(
      [],
      [logged('r-sweep', '2026-09-08T07:00:00Z')],
      new Map([['r-sweep', { projectId: 'p-alpha', sectionId: 's-floor' }]]),
    ).completions;
    expect(only?.projectId).toBe('p-alpha');
    expect(only?.sectionId).toBe('s-floor');
  });

  it('is located by project alone once the task has moved, rather than guessed back', () => {
    const [only] = merge(
      [],
      [logged('r-sweep', '2026-09-08T07:00:00Z')],
      new Map([['r-sweep', { projectId: 'p-beta', sectionId: 's-floor' }]]),
    ).completions;
    expect(only?.projectId).toBe('p-alpha');
    expect(only?.sectionId).toBeUndefined();
  });
});

describe('the window', () => {
  it('keeps a history entry the log does not reach', () => {
    // The log's reach depends on the plan; history older than it must not
    // vanish because a newer reader looked.
    const result = merge([listed('o-old', '2026-09-08T09:00:00Z')], []);
    expect(result.completions).toHaveLength(1);
  });

  it('returns only what is keyed inside it, at both ends inclusive', () => {
    const result = merge(
      [],
      [
        logged('r-a', '2026-09-06T23:59:59Z'),
        logged('r-b', SINCE.toISOString()),
        logged('r-c', UNTIL.toISOString()),
        logged('r-d', '2026-09-14T00:00:01Z'),
      ],
    );
    expect(result.completions.map((c) => c.externalTaskId)).toEqual(['r-b', 'r-c']);
  });
});

/**
 * Through the backfill and its in-memory store, whose upsert uses the table's
 * key: the double-count tests have to run where the count is made.
 */
describe('a backfill reading both records', () => {
  const NOW = new Date('2026-10-05T00:00:00Z');
  const FROM = new Date('2026-09-07T00:00:00Z');
  const options = { from: FROM, now: () => NOW, defaultMinutes: 25, sliceDays: 7 };

  const history = [
    listed('o-plane', '2026-09-09T17:40:00Z'),
    listed('o-tidy', '2026-09-22T10:00:00Z'),
  ];
  const events = [
    logged('o-plane', '2026-09-09T17:40:00Z'),
    logged('o-tidy', '2026-09-22T10:00:00Z'),
    logged('r-sweep', '2026-09-08T07:00:00Z'),
    logged('r-sweep', '2026-09-15T07:00:00Z'),
    logged('r-sweep', '2026-09-29T07:00:00Z'),
  ];

  it('records each recurring occurrence once and each one-off once', async () => {
    const { store, state } = createFakeStore();
    const task = createFakeTaskClient(history, undefined, { events });
    const result = await backfill({ ...options, store, taskClient: task.client });

    expect([...state.completions.keys()].sort()).toEqual([
      'o-plane@2026-09-09T17:40:00.000Z',
      'o-tidy@2026-09-22T10:00:00.000Z',
      'r-sweep@2026-09-08T07:00:00.000Z',
      'r-sweep@2026-09-15T07:00:00.000Z',
      'r-sweep@2026-09-29T07:00:00.000Z',
    ]);
    expect(result.fromLogOnly).toBe(3);
  });

  it('reads both records a margin wider than each window', async () => {
    const task = createFakeTaskClient(history, undefined, { events });
    await backfill({ ...options, store: createFakeStore().store, taskClient: task.client });
    expect(task.requests[0]?.since.toISOString()).toBe(
      new Date(FROM.getTime() - READ_MARGIN_MS).toISOString(),
    );
    expect(task.eventRequests[0]?.since.toISOString()).toBe(
      new Date(FROM.getTime() - READ_MARGIN_MS).toISOString(),
    );
    expect(task.eventRequests).toHaveLength(task.requests.length);
  });

  it('is idempotent: a second run over the same period adds nothing', async () => {
    const { store, state } = createFakeStore();
    await backfill({
      ...options,
      store,
      taskClient: createFakeTaskClient(history, undefined, { events }).client,
    });
    const first = [...state.completions.keys()].sort();

    state.cursor = undefined;
    await backfill({
      ...options,
      store,
      taskClient: createFakeTaskClient(history, undefined, { events }).client,
    });
    expect([...state.completions.keys()].sort()).toEqual(first);
  });

  it('adds only the occurrences to history the earlier reader stored, even when the instants disagree', async () => {
    const { store, state } = createFakeStore();
    // The earlier reader: completion history only.
    await backfill({ ...options, store, taskClient: createFakeTaskClient(history).client });
    expect(state.completions.size).toBe(2);

    // The log stamps a one-off a few seconds after the history does. Keyed by
    // the log's instant it would be a second row for the same completion.
    const drifted = events.map((event) =>
      event.externalTaskId.startsWith('o-')
        ? { ...event, at: new Date(event.at.getTime() + 4_000) }
        : event,
    );
    state.cursor = undefined;
    await backfill({
      ...options,
      store,
      taskClient: createFakeTaskClient(history, undefined, { events: drifted }).client,
    });
    expect(state.completions.size).toBe(5);
  });

  it('counts a pair straddling a window boundary once', async () => {
    // Slices are a week long from a Monday; this one-off is checked a second
    // before one boundary and logged a second after it.
    const { store, state } = createFakeStore();
    const boundary = Date.parse('2026-09-14T00:00:00Z');
    const task = createFakeTaskClient(
      [listed('o-edge', new Date(boundary - 1_000).toISOString())],
      undefined,
      { events: [logged('o-edge', new Date(boundary + 1_000).toISOString())] },
    );
    await backfill({ ...options, store, taskClient: task.client });
    expect([...state.completions.keys()]).toEqual(['o-edge@2026-09-13T23:59:59.000Z']);
  });
});
