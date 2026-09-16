import { describe, expect, it } from 'vitest';
import { contentHash } from './hash.js';
import {
  nextWatermark,
  suppressUnchanged,
  WATERMARK_OVERLAP_SECONDS,
  watermarkFloor,
} from './watermark.js';

/**
 * The watermark trap, reproduced.
 *
 * This is the test the W03 brief singles out, and it is worth being explicit
 * about *why* it is written the way it is: the naive query is not merely less
 * good, it is **silently wrong**. It returns a clean result, the run succeeds,
 * the metrics stay green, and the edit is gone for ever. So the first test
 * below asserts the bug exists — that `>= last_run` really does miss the edit —
 * before asserting that the overlap catches it. Without the first half, the
 * second half would still pass on an implementation that had quietly dropped
 * the overlap and simply queried from the beginning of time.
 */

/** The document tool reports change timestamps rounded **down** to the minute. */
function asTheToolReportsIt(actualEdit: Date): Date {
  const rounded = new Date(actualEdit);
  rounded.setUTCSeconds(0, 0);
  return rounded;
}

describe('the two-minute overlap', () => {
  const lastRunStartedAt = new Date('2026-09-16T08:58:30.000Z');
  const editedAt = new Date('2026-09-16T08:58:45.000Z');
  const reportedAt = asTheToolReportsIt(editedAt);

  it('reproduces the bug: a same-minute edit is invisible to a naive `>= last_run`', () => {
    expect(editedAt.getTime()).toBeGreaterThan(lastRunStartedAt.getTime());
    // …and yet:
    expect(reportedAt.getTime()).toBeLessThan(lastRunStartedAt.getTime());
  });

  it('catches that edit once the floor is overlapped', () => {
    const floor = watermarkFloor(lastRunStartedAt);
    expect(reportedAt.getTime()).toBeGreaterThanOrEqual(floor.getTime());
  });

  it('overlaps by exactly two minutes', () => {
    expect(WATERMARK_OVERLAP_SECONDS).toBe(120);
    expect(lastRunStartedAt.getTime() - watermarkFloor(lastRunStartedAt).getTime()).toBe(120_000);
  });

  it('covers a full minute of rounding even for a run at the very start of a minute', () => {
    const atMinuteStart = new Date('2026-09-16T08:58:00.000Z');
    const editedJustBefore = asTheToolReportsIt(new Date('2026-09-16T08:57:59.000Z'));
    expect(editedJustBefore.getTime()).toBeGreaterThanOrEqual(
      watermarkFloor(atMinuteStart).getTime(),
    );
  });

  it('stores the run start, not the newest timestamp it saw', () => {
    // Deriving the watermark from the data would re-introduce the rounding, and
    // would stall for ever on a store with no recent edits.
    const runStartedAt = new Date('2026-09-16T09:00:00.000Z');
    expect(nextWatermark(runStartedAt)).toEqual(runStartedAt);
  });
});

describe('content hashing suppresses what the overlap re-reads', () => {
  const records = [
    { externalId: 'doc-page-0001', contentHash: contentHash({ title: 'unchanged' }) },
    { externalId: 'doc-page-0002', contentHash: contentHash({ title: 'also unchanged' }) },
  ];

  it('reports every record as changed on the first run', () => {
    const first = suppressUnchanged(records, new Map());
    expect(first.changed).toHaveLength(2);
    expect(first.unchanged).toHaveLength(0);
  });

  it('reports zero changes when the same data is read again', () => {
    const first = suppressUnchanged(records, new Map());
    const second = suppressUnchanged(records, first.hashes);

    expect(second.changed).toEqual([]);
    expect(second.unchanged).toHaveLength(2);
    // The overlap is only affordable because of this: it widens the read
    // without widening the work.
    expect(second.hashes).toEqual(first.hashes);
  });

  it('reports a record whose content actually moved', () => {
    const first = suppressUnchanged(records, new Map());
    const edited = [
      records[0] as (typeof records)[number],
      { externalId: 'doc-page-0002', contentHash: contentHash({ title: 'edited' }) },
    ];

    const second = suppressUnchanged(edited, first.hashes);
    expect(second.changed.map((record) => record.externalId)).toEqual(['doc-page-0002']);
    expect(second.hashes.get('doc-page-0002')).toBe(contentHash({ title: 'edited' }));
  });

  it('treats a record it has never seen as changed', () => {
    const known = new Map([['doc-page-0001', records[0]?.contentHash ?? '']]);
    const result = suppressUnchanged(records, known);
    expect(result.changed.map((record) => record.externalId)).toEqual(['doc-page-0002']);
  });
});
