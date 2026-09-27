import type { DocToolClient, TaskToolClient } from '@prisme/connectors';
import { materialise, toStoredCompletion, type MaterialiseResult } from './backfill/run.js';
import type { BackfillStore } from './backfill/ports.js';
import { sliceRange } from './backfill/slices.js';
import { unreadReason, type UnreadReason } from './unread.js';

/**
 * The **bounded capacity refresh**: keep the trailing window of materialised
 * weeks current, from what a pass already has.
 *
 * ## The gap this closes
 *
 * `capacity_week` was materialised only by `prisme-sync backfill --from <date>`,
 * a command a person runs. So the balance factor — declared against observed,
 * the view that exists in no other tool — read correctly on the day of the
 * backfill and drifted from then on, while the screens went on naming
 * `capacity_week` as their source. The register row said it plainly: *"the day
 * the human stops running the command, the balance then reads stale weeks while
 * naming them `capacity_week`."*
 *
 * ## Why the bound is an argument and not a `from` date
 *
 * A narrow `backfill` is **not** a narrow refresh. `planResume` returns the
 * union of the requested range and the cursor's coverage, and the backfill
 * materialises over that union — so asking a backfill for four weeks against a
 * three-year cursor re-materialises three years. This calls
 * [`materialise`](backfill/run.ts) directly, with the range it means, which is
 * what makes the work bounded rather than the request.
 *
 * ## Why it runs on the full pass and not on every one
 *
 * A pass runs every fifteen minutes inside the sync window. The window the
 * balance view reads is `CAPACITY_WINDOW_WEEKS` — four, by default — so a
 * refresh once a day keeps it current with three days and twenty-three hours to
 * spare, and the fifteen-minute passes stay cheap. It also keeps the
 * document-tool read this can make (the declared-duration tier) to about once a
 * day rather than ninety-six times.
 *
 * ## It fetches the trailing window first
 *
 * Materialising re-attributes what `completion_history` holds, and until this
 * the only thing that added to it was the backfill — so the refresh kept the
 * weeks current with a history that had stopped at the last time a person ran
 * the command, and the balance read a frozen month while calling it current.
 * With `taskClient` given, the window is read from the task tool first and
 * recorded through the same `recordSlice` the backfill uses: the same upsert,
 * the same cursor, the same title (ADR-0032).
 *
 * The fetch starts at the **earlier** of the window's start and where the
 * cursor ends. A refresh that did not run for longer than the window would
 * otherwise record the window and advance the cursor over the days before it,
 * and `recordSlice`'s cursor would then claim a stretch nothing ever read —
 * the hole the cursor exists to make impossible.
 *
 * Nothing here is outward: the store port has no method that could reach an
 * API, the task client is the read path and holds no writer, and with
 * `docClient` absent the run reads no page either.
 */

export interface CapacityRefreshOptions {
  readonly store: BackfillStore;
  /**
   * The task tool's read path. Absent re-materialises what is stored without
   * fetching, which is what the refresh did before it fetched at all.
   */
  readonly taskClient?: TaskToolClient | undefined;
  /** Absent leaves the duration preference order two-tier, as any run does. */
  readonly docClient?: DocToolClient | undefined;
  readonly durationProperty?: string | undefined;
  readonly defaultMinutes: number;
  /** The trailing window, in weeks. `CAPACITY_WINDOW_WEEKS`. */
  readonly weeks: number;
  readonly now: Date;
}

export interface CapacityRefreshResult {
  /** The instant range that was asked for. */
  readonly from: Date;
  /** Exclusive, and the instant the window ends at: `now`. */
  readonly to: Date;
  /**
   * Completions read from the task tool, counted across slices — so a
   * completion on a slice boundary counts twice here and once in history.
   * `undefined` when no client was given or the read failed.
   */
  readonly fetched: number | undefined;
  /**
   * The failure kind, when the read was attempted and did not complete — never
   * the error, whose message can name a workspace. The run materialises anyway.
   */
  readonly taskToolUnread?: UnreadReason | undefined;
  /** How many week rows were materialised. */
  readonly weeks: number;
  /** Completions attributed in the window, which is the number worth watching. */
  readonly attributed: number;
  readonly documentToolRead: boolean;
  /** The failure kind, when a read was attempted and did not happen. See `unread.ts`. */
  readonly documentToolUnread?: UnreadReason | undefined;
}

const MS_PER_DAY = 86_400_000;

/**
 * Materialise the trailing `weeks` weeks ending at `now`.
 *
 * `to` is **exclusive** and is `now` itself: the balance view's window is
 * half-open, and a refresh that ended at the start of today would leave today's
 * completions out of a chart that claims to be current.
 */
export async function refreshCapacity(
  options: CapacityRefreshOptions,
): Promise<CapacityRefreshResult> {
  const to = options.now;
  const from = new Date(to.getTime() - options.weeks * 7 * MS_PER_DAY);

  const fetch =
    options.taskClient === undefined
      ? { fetched: undefined }
      : await fetchTrailing(options.store, options.taskClient, from, to);

  const materialised: MaterialiseResult = await materialise({
    store: options.store,
    ...(options.docClient === undefined ? {} : { docClient: options.docClient }),
    ...(options.durationProperty === undefined
      ? {}
      : { durationProperty: options.durationProperty }),
    defaultMinutes: options.defaultMinutes,
    from,
    to,
  });

  return {
    from,
    to,
    ...fetch,
    weeks: materialised.weeks.length,
    attributed: materialised.attribution.attributed.length,
    documentToolRead: materialised.documentToolRead,
    ...(materialised.documentToolUnread === undefined
      ? {}
      : { documentToolUnread: materialised.documentToolUnread }),
  };
}

/**
 * Record `[start, to]` from the task tool, where `start` is the window's start
 * or the end of the cursor, whichever is earlier.
 *
 * A failure is returned rather than thrown: the weeks are still worth
 * re-materialising from what is stored, and the slices that did land have
 * already advanced the cursor through exactly what they covered.
 */
async function fetchTrailing(
  store: BackfillStore,
  taskClient: TaskToolClient,
  from: Date,
  to: Date,
): Promise<{ readonly fetched: number | undefined; readonly taskToolUnread?: UnreadReason }> {
  try {
    const cursor = await store.loadCursor();
    const start =
      cursor === undefined || cursor.coveredThrough >= from ? from : cursor.coveredThrough;

    let fetched = 0;
    for (const slice of sliceRange(start, to)) {
      const completions = await taskClient.fetchCompletions(slice.since, slice.until);
      await store.recordSlice(completions.map(toStoredCompletion), {
        coveredFrom: start,
        coveredThrough: slice.until,
      });
      fetched += completions.length;
    }
    return { fetched };
  } catch (error: unknown) {
    return { fetched: undefined, taskToolUnread: unreadReason(error) };
  }
}
