import type { DocToolClient } from '@prisme/connectors';
import { materialise, type MaterialiseResult } from './backfill/run.js';
import type { BackfillStore } from './backfill/ports.js';
import type { UnreadReason } from './unread.js';

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
 * Nothing here is outward: the store port has no method that could reach an
 * API, and with `docClient` absent the run reads no page either.
 */

export interface CapacityRefreshOptions {
  readonly store: BackfillStore;
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
    weeks: materialised.weeks.length,
    attributed: materialised.attribution.attributed.length,
    documentToolRead: materialised.documentToolRead,
    ...(materialised.documentToolUnread === undefined
      ? {}
      : { documentToolUnread: materialised.documentToolUnread }),
  };
}
