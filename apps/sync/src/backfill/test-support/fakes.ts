import type { AreaKey, AreaKind } from '@prisme/domain';
import type { Completion, TaskToolClient } from '@prisme/connectors';
import { locationKey } from '../../reconcile/types.js';
import type { BackfillStore } from '../ports.js';
import type { Cursor } from '../slices.js';
import type { AdherencePeriod, CapacityWeek, RitualRecord, StoredCompletion } from '../types.js';

/**
 * An in-memory {@link BackfillStore}, and a task client that answers from a
 * list of completions.
 *
 * The store is a real implementation of the port rather than a stub with
 * assertions in it: `recordSlice` upserts on the same key the table's primary
 * key uses, and `replaceCapacityWeeks` deletes its range before inserting. That
 * is what makes the idempotence test in `run.test.ts` mean something — a fake
 * that merely counted calls would pass whether or not the pass double-counts.
 *
 * Everything constructed here is synthetic.
 */

export interface FakeStoreState {
  cursor?: Cursor | undefined;
  readonly completions: Map<string, StoredCompletion>;
  readonly weeks: Map<string, CapacityWeek>;
  readonly adherence: Map<string, AdherencePeriod>;
  /** How many times each write method was called, for the resume assertions. */
  readonly calls: { recordSlice: number };
}

export interface FakeStoreOptions {
  readonly areaByLocation?: ReadonlyMap<string, AreaKey> | undefined;
  readonly kindByArea?: ReadonlyMap<AreaKey, AreaKind> | undefined;
  readonly rituals?: readonly RitualRecord[] | undefined;
  readonly cursor?: Cursor | undefined;
}

const DEFAULT_LOCATIONS = new Map<string, AreaKey>([
  [locationKey('p-alpha'), 'alpha'],
  [locationKey('p-beta'), 'beta'],
  [locationKey('p-upkeep'), 'upkeep'],
  [locationKey('p-noise'), 'noise'],
]);

const DEFAULT_KINDS = new Map<AreaKey, AreaKind>([
  ['alpha', 'area'],
  ['beta', 'area'],
  ['upkeep', 'run'],
  ['noise', 'signals'],
]);

function completionKey(completion: StoredCompletion): string {
  return `${completion.externalTaskId}@${completion.completedAt.toISOString()}`;
}

export function createFakeStore(options: FakeStoreOptions = {}): {
  readonly store: BackfillStore;
  readonly state: FakeStoreState;
} {
  const state: FakeStoreState = {
    cursor: options.cursor,
    completions: new Map(),
    weeks: new Map(),
    adherence: new Map(),
    calls: { recordSlice: 0 },
  };

  const store: BackfillStore = {
    loadCursor: () => Promise.resolve(state.cursor),

    recordSlice(completions, covers) {
      state.calls.recordSlice += 1;
      // The primary key, in a Map. This is the whole idempotence guarantee.
      for (const completion of completions) {
        state.completions.set(completionKey(completion), completion);
      }
      state.cursor = {
        coveredFrom:
          state.cursor === undefined
            ? covers.coveredFrom
            : new Date(Math.min(state.cursor.coveredFrom.getTime(), covers.coveredFrom.getTime())),
        coveredThrough:
          state.cursor === undefined
            ? covers.coveredThrough
            : new Date(
                Math.max(state.cursor.coveredThrough.getTime(), covers.coveredThrough.getTime()),
              ),
      };
      return Promise.resolve();
    },

    loadCompletions(from, to) {
      return Promise.resolve(
        [...state.completions.values()]
          .filter((completion) => completion.completedAt >= from && completion.completedAt < to)
          .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime()),
      );
    },

    loadAreaMap: () =>
      Promise.resolve({
        areaByLocation: options.areaByLocation ?? DEFAULT_LOCATIONS,
        kindByArea: options.kindByArea ?? DEFAULT_KINDS,
      }),

    loadRituals: () => Promise.resolve(options.rituals ?? []),

    /**
     * Delete the range, then insert — and **refuse a row that is already
     * there**, the way `capacity_week`'s primary key does.
     *
     * The refusal is the point. This fake originally mirrored the real store's
     * off-by-one (both took the covered *instants* as week bounds), so the unit
     * tests agreed with the SQL and neither noticed that a range starting
     * mid-week left the first week's row undeleted. Only a real second run
     * found it. A fake that silently overwrites cannot catch a key collision,
     * so this one does not.
     */
    replaceCapacityWeeks(rows, fromWeek, toWeek) {
      for (const [key, row] of state.weeks) {
        if (row.weekStart >= fromWeek && row.weekStart < toWeek) state.weeks.delete(key);
      }
      for (const row of rows) {
        const key = `${row.weekStart}/${row.areaKey}`;
        if (state.weeks.has(key)) {
          return Promise.reject(
            new Error(`capacity_week_pkey: (week_start, area_key)=(${key}) already exists`),
          );
        }
        state.weeks.set(key, row);
      }
      return Promise.resolve();
    },

    recordAdherence(periods) {
      for (const period of periods) {
        state.adherence.set(`${period.ritualId}/${period.periodStart}`, period);
      }
      return Promise.resolve();
    },
  };

  return { store, state };
}

export interface FakeTaskClient {
  readonly client: TaskToolClient;
  /** Every window asked for, in order — the resume assertions read this. */
  readonly windows: { since: Date; until: Date | undefined }[];
}

/**
 * A task client that serves completions out of a list, windowed.
 *
 * Windowing is applied here rather than ignored, because a client that returned
 * everything regardless of `until` would make the slicing look correct while
 * the real one double-counted at every boundary.
 */
export function createFakeTaskClient(
  completions: readonly Completion[],
  onFetch?: () => void,
): FakeTaskClient {
  const windows: { since: Date; until: Date | undefined }[] = [];

  const client: TaskToolClient = {
    syncIncremental: () => Promise.resolve({ changes: [], token: 'fake' }),
    fetchAll: () =>
      Promise.resolve({ token: 'fake', projects: [], sections: [], labels: [], tasks: [] }),
    fetchCompletions: (since, until) => {
      windows.push({ since, until });
      onFetch?.();
      return Promise.resolve(
        completions.filter(
          (completion) =>
            completion.completedAt >= since &&
            (until === undefined || completion.completedAt < until),
        ),
      );
    },
  };

  return { client, windows };
}
