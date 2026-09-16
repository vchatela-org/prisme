/**
 * The watermark, and the bug it exists to prevent.
 *
 * Change timestamps in the document tool are **rounded down to the minute**. A
 * run at 10:00:30 records 10:00:30 as its watermark; an edit made at 10:00:45
 * is reported as `10:00:00`; the next run asks for `>= 10:00:30` and never sees
 * it. Nothing errors. The metric stays green. The edit is simply gone, and it
 * stays gone, because no later run will ever revisit that window.
 *
 * The fix is two things together, and neither works alone (docs/16-sync.md §2):
 *
 *   1. **Overlap the query by two minutes**, so the rounded-down timestamp is
 *      comfortably inside the window;
 *   2. **hash the content**, so the records the overlap re-reads are recognised
 *      as unchanged instead of being reprocessed every single run.
 *
 * Overlapping is cheap. Missing an edit is invisible.
 */

/** Two minutes: one for the rounding, one for clock skew between prisme and the tool. */
export const WATERMARK_OVERLAP_SECONDS = 120;

/**
 * The floor of the next query.
 *
 * `undefined` means no previous run — the caller should do a full pass rather
 * than invent a window, because "since the beginning of time" and "since a
 * watermark we do not have" are different questions.
 */
export function watermarkFloor(
  lastRunStartedAt: Date,
  overlapSeconds: number = WATERMARK_OVERLAP_SECONDS,
): Date {
  return new Date(lastRunStartedAt.getTime() - overlapSeconds * 1000);
}

/**
 * The watermark to store for the next run: **when this run started**, not the
 * newest timestamp it saw.
 *
 * Deriving it from the data would make the watermark depend on rounded values —
 * the very thing that caused the bug — and would stall forever on a store that
 * happens to have no recent edits.
 */
export function nextWatermark(runStartedAt: Date): Date {
  return runStartedAt;
}

export interface Hashable {
  readonly externalId: string;
  readonly contentHash: string;
}

export interface ChangeSet<T extends Hashable> {
  /** New, or genuinely different from the hash held for them. */
  readonly changed: readonly T[];
  /** Re-read by the overlap and identical. The reason this function exists. */
  readonly unchanged: readonly T[];
  /** The hashes to store, merged over the ones passed in. */
  readonly hashes: ReadonlyMap<string, string>;
}

/**
 * Splits a batch into what actually changed and what the overlap merely re-read.
 *
 * `known` is the hash of each record as of the last run, keyed by external ID.
 * A record absent from it is new, and new is always a change.
 */
export function suppressUnchanged<T extends Hashable>(
  records: readonly T[],
  known: ReadonlyMap<string, string>,
): ChangeSet<T> {
  const changed: T[] = [];
  const unchanged: T[] = [];
  const hashes = new Map(known);

  for (const record of records) {
    if (known.get(record.externalId) === record.contentHash) {
      unchanged.push(record);
      continue;
    }
    changed.push(record);
    hashes.set(record.externalId, record.contentHash);
  }

  return { changed, unchanged, hashes };
}
