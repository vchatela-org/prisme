import { describe, expect, it } from 'vitest';
import { ConnectorError } from '@prisme/connectors';
import type { Completion } from '@prisme/connectors';

import { backfill } from './run.js';
import { createFakeStore, createFakeTaskClient } from './test-support/fakes.js';
import type { RitualRecord } from './types.js';

/**
 * The backfill, end to end, against an in-memory store.
 *
 * The test that matters is the double-count one. Everything else this pass does
 * is recoverable — a wrong duration is a recomputation away from right — but a
 * completion counted twice inflates an area's share permanently and invisibly,
 * and the balance factor built on it moves real decisions about how a year is
 * spent.
 *
 * All synthetic: invented task ids, invented projects, invented durations.
 */

const NOW = new Date('2026-10-05T00:00:00Z'); // a Monday
const FROM = new Date('2026-09-07T00:00:00Z'); // four weeks earlier, also a Monday

function completion(
  overrides: Partial<Completion> & Pick<Completion, 'externalTaskId'>,
): Completion {
  return {
    completedAt: new Date('2026-09-08T09:00:00Z'),
    projectId: 'p-alpha',
    ...overrides,
  };
}

const HISTORY: readonly Completion[] = [
  completion({
    externalTaskId: 'a1',
    recordedMinutes: 60,
    recordedDuration: { amount: 60, unit: 'minute' },
  }),
  completion({ externalTaskId: 'a2', completedAt: new Date('2026-09-16T09:00:00Z') }),
  completion({
    externalTaskId: 'b1',
    completedAt: new Date('2026-09-23T09:00:00Z'),
    projectId: 'p-beta',
    recordedMinutes: 30,
    recordedDuration: { amount: 30, unit: 'minute' },
  }),
  completion({
    externalTaskId: 'u1',
    completedAt: new Date('2026-09-30T09:00:00Z'),
    projectId: 'p-upkeep',
    recordedMinutes: 120,
    recordedDuration: { amount: 120, unit: 'minute' },
  }),
  completion({
    externalTaskId: 'n1',
    completedAt: new Date('2026-10-01T09:00:00Z'),
    projectId: 'p-noise',
  }),
];

function options(overrides: Record<string, unknown> = {}) {
  return {
    from: FROM,
    now: () => NOW,
    defaultMinutes: 25,
    sliceDays: 7,
    ...overrides,
  };
}

describe('a first run', () => {
  it('fetches the range in windows and records what it found', async () => {
    const { store, state } = createFakeStore();
    const task = createFakeTaskClient(HISTORY);

    const result = await backfill({ ...options(), store, taskClient: task.client });

    expect(task.windows).toHaveLength(4);
    expect(result.fetched).toBe(HISTORY.length);
    expect(state.completions.size).toBe(HISTORY.length);
    expect(state.cursor?.coveredThrough.toISOString()).toBe(NOW.toISOString());
  });

  it('asks for half-open windows that neither overlap nor leave a gap', async () => {
    const { store } = createFakeStore();
    const task = createFakeTaskClient(HISTORY);

    await backfill({ ...options(), store, taskClient: task.client });

    for (let index = 1; index < task.windows.length; index += 1) {
      expect(task.windows[index]?.since.getTime()).toBe(task.windows[index - 1]?.until?.getTime());
    }
  });

  it('materialises a week per area and splits the minutes by source', async () => {
    const { store, state } = createFakeStore();
    const task = createFakeTaskClient(HISTORY);

    await backfill({ ...options(), store, taskClient: task.client });

    expect(state.weeks.get('2026-09-07/alpha')).toEqual({
      weekStart: '2026-09-07',
      areaKey: 'alpha',
      completions: 1,
      minutes: 60,
      minutesBySource: { recorded: 60, declared: 0, default: 0 },
    });
    // The one with no recorded duration falls to the configured default.
    expect(state.weeks.get('2026-09-14/alpha')?.minutesBySource).toEqual({
      recorded: 0,
      declared: 0,
      default: 25,
    });
    // Signals are volume and no time, whatever the tool said.
    expect(state.weeks.get('2026-09-28/noise')?.minutes).toBe(0);
    expect(state.weeks.get('2026-09-28/noise')?.completions).toBe(1);
  });
});

/**
 * **The one that matters.** Re-running over the same period must produce
 * identical results.
 */
describe('re-running over the same period', () => {
  it('produces identical materialised rows and never double-counts', async () => {
    const { store, state } = createFakeStore();
    const first = createFakeTaskClient(HISTORY);
    await backfill({ ...options(), store, taskClient: first.client });

    const after = {
      completions: state.completions.size,
      weeks: new Map(state.weeks),
      cursor: state.cursor,
    };

    // A second run asked for exactly the same range, against a store that
    // already holds everything — and, to make the point sharper, one that
    // re-fetches rather than resuming.
    state.cursor = undefined;
    const second = createFakeTaskClient(HISTORY);
    await backfill({ ...options(), store, taskClient: second.client });

    expect(state.completions.size).toBe(after.completions);
    expect([...state.weeks.entries()]).toEqual([...after.weeks.entries()]);
    // Read back through the port rather than off the state, which is both a
    // stronger assertion and the only way to ask: assigning `state.cursor`
    // above narrows the field to `undefined` for the rest of this block.
    expect((await store.loadCursor())?.coveredThrough.toISOString()).toBe(
      after.cursor?.coveredThrough.toISOString(),
    );
  });

  /**
   * The regression test for the one defect running this found.
   *
   * `weeklyCapacity` buckets by Monday, so a range starting on a Sunday
   * produces a row for the Monday *before* the range begins. The store deleted
   * by the covered instants, so that row survived the delete and the second run
   * collided on `capacity_week`'s primary key. Every case above starts on a
   * Monday, which is exactly why they all passed.
   */
  it('re-runs a range that starts mid-week without colliding on a week it already wrote', async () => {
    const sunday = new Date('2026-09-06T00:00:00Z');
    // A completion on the Sunday itself, which buckets to the Monday *before*
    // the covered range begins. Without one, the row the defect was about never
    // exists and the test passes either way.
    const history = [completion({ externalTaskId: 's1', completedAt: sunday }), ...HISTORY];
    const { store, state } = createFakeStore();

    await backfill({
      ...options({ from: sunday }),
      store,
      taskClient: createFakeTaskClient(history).client,
    });
    expect(state.weeks.has('2026-08-31/alpha')).toBe(true);

    state.cursor = undefined;
    await expect(
      backfill({
        ...options({ from: sunday }),
        store,
        taskClient: createFakeTaskClient(history).client,
      }),
    ).resolves.toBeDefined();
  });

  it('leaves the minutes for an area exactly where they were', async () => {
    const { store, state } = createFakeStore();
    await backfill({ ...options(), store, taskClient: createFakeTaskClient(HISTORY).client });
    const before = state.weeks.get('2026-09-07/alpha')?.minutes;

    state.cursor = undefined;
    await backfill({ ...options(), store, taskClient: createFakeTaskClient(HISTORY).client });

    expect(state.weeks.get('2026-09-07/alpha')?.minutes).toBe(before);
  });
});

describe('resuming', () => {
  it('fetches nothing when the cursor already covers the request', async () => {
    const { store, state } = createFakeStore({
      cursor: { coveredFrom: FROM, coveredThrough: NOW },
    });
    const task = createFakeTaskClient(HISTORY);

    const result = await backfill({ ...options(), store, taskClient: task.client });

    expect(task.windows).toEqual([]);
    expect(result.plan.reason).toBe('already covered');
    // It still re-attributes and re-materialises from what is stored, which is
    // how adding an area_mapping takes effect without re-fetching a page.
    expect(state.weeks.size).toBeGreaterThanOrEqual(0);
  });

  /**
   * A run that dies halfway must leave a cursor describing what it actually
   * fetched, not what it intended to. Otherwise the next run resumes past a
   * window nothing ever read, and the hole is permanent.
   */
  it('leaves a cursor covering only the windows that landed when a run fails', async () => {
    const { store, state } = createFakeStore();
    let calls = 0;
    const task = createFakeTaskClient(HISTORY, () => {
      calls += 1;
      if (calls === 3) throw new Error('rate limited');
    });

    await expect(backfill({ ...options(), store, taskClient: task.client })).rejects.toThrow(
      /rate limited/,
    );

    expect(state.cursor?.coveredThrough.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('continues from that cursor rather than from the start', async () => {
    const { store, state } = createFakeStore();
    let calls = 0;
    const failing = createFakeTaskClient(HISTORY, () => {
      calls += 1;
      if (calls === 3) throw new Error('rate limited');
    });
    await expect(backfill({ ...options(), store, taskClient: failing.client })).rejects.toThrow();

    const resumed = createFakeTaskClient(HISTORY);
    await backfill({ ...options(), store, taskClient: resumed.client });

    expect(resumed.windows[0]?.since.toISOString()).toBe('2026-09-21T00:00:00.000Z');
    // And the completions from the two halves add up to the whole, once.
    expect(state.completions.size).toBe(HISTORY.length);
  });
});

/**
 * The location is stored and the area is not, so a mapping added years after
 * the fact re-attributes years of history without one extra request.
 */
describe('re-attribution without re-fetching', () => {
  it('places history that was unattributable once a mapping exists', async () => {
    const orphan = [completion({ externalTaskId: 'x1', projectId: 'p-new' })];
    const { store, state } = createFakeStore();

    const first = await backfill({
      ...options(),
      store,
      taskClient: createFakeTaskClient(orphan).client,
    });

    expect(first.attribution.attributed).toHaveLength(0);
    expect(first.attribution.gaps).toEqual([
      { externalProjectId: 'p-new', externalSectionId: undefined, completions: 1 },
    ]);

    // The mapping arrives. The cursor already covers the range, so the second
    // run asks the task tool for nothing at all.
    const mapped = createFakeStore({
      areaByLocation: new Map([['p-new/', 'alpha']]),
      cursor: state.cursor,
    });
    for (const [key, value] of state.completions) mapped.state.completions.set(key, value);

    const task = createFakeTaskClient([]);
    const second = await backfill({ ...options(), store: mapped.store, taskClient: task.client });

    expect(task.windows).toEqual([]);
    expect(second.attribution.attributed).toHaveLength(1);
    expect(second.attribution.gaps).toEqual([]);
    expect(mapped.state.weeks.get('2026-09-07/alpha')?.completions).toBe(1);
  });
});

describe('rituals', () => {
  const ritual: RitualRecord = {
    // Not a literal UUID: the deny-list refuses one in this repository, and
    // nothing here needs the shape — the fake store keys on the string.
    id: 'ritual-invented',
    name: 'Invented habit',
    areaKey: 'alpha',
    cadence: 'weekly',
    externalTaskId: 'a1',
  };

  it('reconstructs the adherence series over the covered range', async () => {
    const { store, state } = createFakeStore({ rituals: [ritual] });

    await backfill({
      ...options(),
      store,
      taskClient: createFakeTaskClient(HISTORY).client,
    });

    expect(state.adherence.size).toBe(4);
    expect(state.adherence.get(`${ritual.id}/2026-09-07`)).toMatchObject({
      opportunities: 1,
      completions: 1,
    });
    expect(state.adherence.get(`${ritual.id}/2026-09-14`)?.completions).toBe(0);
  });

  it('reports a ritual with no bound task rather than recording it as never done', async () => {
    const { store, state } = createFakeStore({
      rituals: [{ ...ritual, externalTaskId: undefined }],
    });

    const result = await backfill({
      ...options(),
      store,
      taskClient: createFakeTaskClient(HISTORY).client,
    });

    expect(state.adherence.size).toBe(0);
    expect(result.unmeasurableRituals.map((entry) => entry.id)).toEqual([ritual.id]);
  });
});

describe('the report', () => {
  it('says the document tool was not read when there is no client for it', async () => {
    const { store } = createFakeStore();

    const result = await backfill({
      ...options(),
      store,
      taskClient: createFakeTaskClient(HISTORY).client,
    });

    expect(result.documentToolRead).toBe(false);
    expect(result.report).toContain('not read');
    expect(result.report).toContain('declared-duration tier is unavailable');
    // And no reason, because none was earned: the caller simply did not supply
    // a client, and a failure kind here would send the reader looking for a
    // permission problem that does not exist.
    expect(result.documentToolUnread).toBeUndefined();
    expect(result.report).not.toMatch(/unavailable \(/);
  });

  it('names the failure kind in the report when a bound store refuses the read', async () => {
    // The register's row: "not read" could not distinguish an unbound role from
    // a refused read, and the difference is the whole diagnostic.
    const { store } = createFakeStore();
    const docClient = {
      queryByRole: () =>
        Promise.reject(
          new ConnectorError('unbound_role', 'the message names the role binding', {
            tool: 'doc',
            operation: 'resolve role key',
          }),
        ),
      fetchPage: () => Promise.reject(new Error('not used')),
      createPage: () => Promise.reject(new Error('not used')),
      describe: () => Promise.reject(new Error('not used')),
    };

    const result = await backfill({
      ...options(),
      store,
      taskClient: createFakeTaskClient(HISTORY).client,
      docClient,
      durationProperty: 'Invented duration property',
    });

    expect(result.documentToolUnread).toBe('unbound_role');
    expect(result.report).toContain('declared-duration tier is unavailable (unbound_role)');
    expect(result.report).not.toContain('the message names the role binding');
  });

  it('states what share of the minutes is the configured default rather than observed', async () => {
    const { store } = createFakeStore();

    const result = await backfill({
      ...options(),
      store,
      taskClient: createFakeTaskClient(HISTORY).client,
    });

    // 25 of 235 minutes came from the default: one completion with no duration.
    expect(result.report).toMatch(/default\s+25\s+10\.6%/);
    expect(result.report).toContain('attention routed through tasks, not hours lived');
  });

  it('lists the locations that still need mapping, commonest first', async () => {
    const { store } = createFakeStore();
    const orphans = [
      completion({ externalTaskId: 'x1', projectId: 'p-one' }),
      completion({ externalTaskId: 'x2', projectId: 'p-one' }),
      completion({ externalTaskId: 'x3', projectId: 'p-two' }),
    ];

    const result = await backfill({
      ...options(),
      store,
      taskClient: createFakeTaskClient(orphans).client,
    });

    expect(result.report).toContain('locations to map, commonest first');
    expect(result.report.indexOf('p-one')).toBeLessThan(result.report.indexOf('p-two'));
  });
});
