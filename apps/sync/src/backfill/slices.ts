/**
 * Cutting a multi-year range into windows, and deciding where to resume.
 *
 * Pure, and separate from the fetch for the usual reason: this is the part that
 * is wrong in interesting ways, and it should be possible to prove it right
 * without a network.
 *
 * Two things make the slicing necessary rather than tidy. Offset paging into
 * completion history is deliberately bounded (`MAX_COMPLETION_PAGES`), so a
 * history longer than that bound cannot be read at all in one call. And a
 * multi-year backfill will hit a rate limit somewhere in the middle — the brief
 * says so — after which a run that restarts from the beginning is a run that
 * never finishes.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Days per window.
 *
 * Wide enough that a decade is a few dozen requests rather than hundreds;
 * narrow enough that 200-per-page offset paging is nowhere near its bound for
 * any plausible number of completions in four weeks.
 */
export const SLICE_DAYS = 28;

export interface Slice {
  /** Inclusive. */
  readonly since: Date;
  /** Exclusive, so two adjacent slices never fetch the same completion twice. */
  readonly until: Date;
}

/**
 * Half-open windows covering `[from, to)`, oldest first.
 *
 * Oldest first is the direction that makes a partial run useful: the cursor
 * advances through history, so an interrupted run has covered a *prefix* of the
 * range and the next one continues it. Newest-first would leave a hole in the
 * middle after every interruption, and a hole nothing revisits is the failure
 * mode this table exists to avoid.
 */
export function sliceRange(from: Date, to: Date, days: number = SLICE_DAYS): readonly Slice[] {
  if (days <= 0) {
    throw new Error(`a backfill slice must span at least one day, not ${String(days)}`);
  }

  const slices: Slice[] = [];
  let cursor = from.getTime();
  const end = to.getTime();

  while (cursor < end) {
    const until = Math.min(cursor + days * MS_PER_DAY, end);
    slices.push({ since: new Date(cursor), until: new Date(until) });
    cursor = until;
  }

  return slices;
}

export interface Cursor {
  readonly coveredFrom: Date;
  readonly coveredThrough: Date;
}

export interface ResumePlan {
  /** What to fetch now. Empty when the cursor already covers the request. */
  readonly slices: readonly Slice[];
  /** Why, in one phrase, for the report. */
  readonly reason: 'first run' | 'resumed' | 'extended backwards' | 'already covered';
  /** The range the cursor will describe once these slices land. */
  readonly covers: { readonly from: Date; readonly to: Date };
}

/**
 * What a run asked for `[from, to)` still has to fetch, given the cursor.
 *
 * The case worth stating is **extending backwards**. A cursor says "everything
 * from X to Y is here"; asking for a `from` earlier than X does not mean
 * resuming at Y, because the stretch before X was never fetched. Treating it as
 * a resume would advance the cursor over a range nothing had read, and the hole
 * would be permanent — the next run would resume past it too. So an earlier
 * `from` re-fetches the whole range. That is slower and it is the only answer
 * that cannot lose history; re-fetching costs requests, and the primary key
 * means it cannot cost correctness.
 */
export function planResume(
  request: { readonly from: Date; readonly to: Date },
  cursor: Cursor | undefined,
  days: number = SLICE_DAYS,
): ResumePlan {
  if (cursor === undefined) {
    return {
      slices: sliceRange(request.from, request.to, days),
      reason: 'first run',
      covers: { from: request.from, to: request.to },
    };
  }

  if (request.from.getTime() < cursor.coveredFrom.getTime()) {
    return {
      slices: sliceRange(request.from, request.to, days),
      reason: 'extended backwards',
      covers: {
        from: request.from,
        to: new Date(Math.max(request.to.getTime(), cursor.coveredThrough.getTime())),
      },
    };
  }

  const resumeAt = new Date(
    Math.max(
      cursor.coveredThrough.getTime(),
      Math.min(request.from.getTime(), request.to.getTime()),
    ),
  );
  const covers = {
    from: cursor.coveredFrom,
    to: new Date(Math.max(request.to.getTime(), cursor.coveredThrough.getTime())),
  };

  if (resumeAt.getTime() >= request.to.getTime()) {
    return { slices: [], reason: 'already covered', covers };
  }

  return { slices: sliceRange(resumeAt, request.to, days), reason: 'resumed', covers };
}
