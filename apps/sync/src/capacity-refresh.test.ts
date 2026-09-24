import { describe, expect, it } from 'vitest';
import { backfill } from './backfill/run.js';
import type { StoredCompletion } from './backfill/types.js';
import { createFakeStore, createFakeTaskClient } from './backfill/test-support/fakes.js';
import { refreshCapacity } from './capacity-refresh.js';

/**
 * The bounded capacity refresh.
 *
 * Two properties, and the second is the reason this is a module of its own
 * rather than a call to `backfill` with a narrow `from`:
 *
 * 1. **The window is the trailing `weeks` weeks, ending now** — half-open, so
 *    today's completions are inside a chart that claims to be current.
 * 2. **The work is bounded by that window even when the cursor covers years.**
 *    A `backfill` asked for four weeks against a three-year cursor
 *    re-materialises three years, because `planResume` returns the union of the
 *    request and the coverage. That is the defect this test pins.
 *
 * All synthetic: invented ids, invented projects, invented durations.
 */

const NOW = new Date('2026-10-05T00:00:00Z'); // a Monday
const FOUR_WEEKS_BACK = new Date('2026-09-07T00:00:00Z'); // also a Monday

function stored(
  externalTaskId: string,
  completedAt: string,
  externalProjectId = 'p-alpha',
): StoredCompletion {
  return {
    externalTaskId,
    completedAt: new Date(completedAt),
    externalProjectId,
    recordedMinutes: 30,
  };
}

/** A week row as a previous backfill would have left it, months ago. */
const OLD_WEEK = {
  weekStart: '2026-07-13',
  areaKey: 'alpha',
  completions: 4,
  minutes: 120,
  minutesBySource: { recorded: 120, declared: 0, default: 0 },
} as const;

function options(overrides: Record<string, unknown> = {}) {
  return { defaultMinutes: 25, weeks: 4, now: NOW, ...overrides };
}

describe('the window', () => {
  it('is the trailing `weeks` weeks, ending at now and half-open', async () => {
    const { store } = createFakeStore();

    const refreshed = await refreshCapacity({ ...options(), store });

    expect(refreshed.from.toISOString()).toBe(FOUR_WEEKS_BACK.toISOString());
    expect(refreshed.to.toISOString()).toBe(NOW.toISOString());
  });

  it('carries the days either side of a four-week window', async () => {
    const { store } = createFakeStore();

    const three = await refreshCapacity({ ...options({ weeks: 3 }), store });

    expect(three.from.toISOString()).toBe(new Date('2026-09-14T00:00:00Z').toISOString());
  });
});

describe('the bound', () => {
  it('rewrites the window and leaves every older week exactly as it was', async () => {
    const { store, state } = createFakeStore();
    state.weeks.set(`${OLD_WEEK.weekStart}/${OLD_WEEK.areaKey}`, { ...OLD_WEEK });
    state.completions.set('in-1@2026-09-08T09:00:00.000Z', stored('in-1', '2026-09-08T09:00:00Z'));
    state.completions.set('in-2@2026-09-29T09:00:00.000Z', stored('in-2', '2026-09-29T09:00:00Z'));

    const refreshed = await refreshCapacity({ ...options(), store });

    // The window's own weeks, and only those.
    expect([...state.weeks.keys()].sort()).toEqual([
      '2026-07-13/alpha',
      '2026-09-07/alpha',
      '2026-09-28/alpha',
    ]);
    // Untouched, not re-derived: a refresh is not a re-materialisation of
    // history, and a week outside the window keeps the numbers a backfill gave
    // it.
    expect(state.weeks.get('2026-07-13/alpha')).toEqual(OLD_WEEK);
    expect(refreshed.attributed).toBe(2);
  });

  /**
   * **The regression test for the design.** The store's cursor covers more than
   * a year, which is the normal state of an instance that has been backfilled —
   * and a `backfill` asked for four weeks would materialise everything the
   * cursor covers. Nothing outside the window appears here.
   */
  it('is bounded by the window, not by how far the cursor reaches', async () => {
    const { store, state } = createFakeStore({
      cursor: {
        coveredFrom: new Date('2025-01-06T00:00:00Z'),
        coveredThrough: new Date('2026-10-01T00:00:00Z'),
      },
    });
    state.completions.set('old@2026-06-10T09:00:00.000Z', stored('old', '2026-06-10T09:00:00Z'));
    state.completions.set('in@2026-10-01T09:00:00.000Z', stored('in', '2026-10-01T09:00:00Z'));

    await refreshCapacity({ ...options(), store });

    // A year and a half of cursor, and the June completion is not in any row.
    expect([...state.weeks.keys()]).toEqual(['2026-09-28/alpha']);
    expect(state.weeks.get('2026-09-28/alpha')?.completions).toBe(1);
  });

  /**
   * **The control, and the reason this module is not a call to `backfill`.**
   *
   * Same store, same cursor, same narrow `from` — asked of the backfill instead.
   * It materialises the June completion, because `planResume` answers a request
   * narrower than the cursor with the **union** of the two: the work is bounded
   * by what the cursor covers, not by what was asked for. If this test ever
   * starts failing, `planResume` has changed and the refresh may be able to
   * become a thin wrapper — but nothing else would have told us.
   */
  it('names the hazard: the same request through a backfill is not bounded', async () => {
    const { store, state } = createFakeStore({
      cursor: {
        coveredFrom: new Date('2025-01-06T00:00:00Z'),
        coveredThrough: new Date('2026-10-01T00:00:00Z'),
      },
    });
    state.completions.set('old@2026-06-10T09:00:00.000Z', stored('old', '2026-06-10T09:00:00Z'));
    state.completions.set('in@2026-10-01T09:00:00.000Z', stored('in', '2026-10-01T09:00:00Z'));

    const task = createFakeTaskClient([]);
    await backfill({
      store,
      taskClient: task.client,
      from: FOUR_WEEKS_BACK,
      now: () => NOW,
      defaultMinutes: 25,
    });

    expect([...state.weeks.keys()].sort()).toEqual(['2026-06-08/alpha', '2026-09-28/alpha']);
  });
});

describe('an instance with nothing to refresh', () => {
  it('writes nothing and does not fail', async () => {
    const { store, state } = createFakeStore();

    const refreshed = await refreshCapacity({ ...options(), store });

    expect(state.weeks.size).toBe(0);
    expect(refreshed.weeks).toBe(0);
    expect(refreshed.attributed).toBe(0);
    // And it reached no API: with no document-tool client the run reads no
    // page, which is what keeps this step inside the read-only phase.
    expect(refreshed.documentToolRead).toBe(false);
  });
});
