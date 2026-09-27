import { hashPlan } from '../auth/confirmation.js';
import type { AdoptionCandidateRecord } from '../store/types.js';

/**
 * The adoption queue as a screen reads it: filtered, counted and paged, in one
 * pure function over the whole undecided set.
 *
 * ## Why here and not in SQL
 *
 * Every filter has to be counted as well as applied — the screen shows "Ended
 * (37)" beside the filter that would show them — and a count computed by one
 * query while the list comes from another is two implementations of the same
 * rule, which drift. The set is small (only adoptable kinds, minus everything
 * decided), so it is read once and both answers come from here.
 *
 * ## What "ended" means
 *
 * A candidate is dated when its store has a date property chosen on Settings →
 * Notion (`role_binding.date_property`), and its period is the one that
 * property names. A period that ended **before today, in the instance's
 * timezone,** is history: an objective for a year long gone is not archived in
 * the tool, it is simply over. The default view (`open`) leaves those out. They
 * are hidden rather than removed — still mirrored, still decidable, counted on
 * the screen, and back the moment the setting is cleared. Hiding is not
 * deciding, though, and a hidden row still keeps the queue from reaching zero:
 * an ended row is closed by ignoring it, one at a time or all at once
 * ({@link endedSelection}, docs/13-migration.md §4).
 *
 * Each facet is counted over the candidates that match every *other* filter,
 * which is what makes the number beside a filter the number of rows choosing it
 * would show.
 */

export const QUEUE_WHEN = ['open', 'current', 'upcoming', 'undated', 'ended', 'all'] as const;
export type QueueWhen = (typeof QUEUE_WHEN)[number];

/** The four periods a candidate falls in. `open` is the first three; `all` is every one. */
export type QueuePeriod = 'current' | 'upcoming' | 'undated' | 'ended';

/** The `areaKey` value that asks for candidates outside every mapped area. */
export const NO_AREA = '_none';

export interface QueueFilter {
  readonly when: QueueWhen;
  /** A document-tool role key, or a task-tool kind (`project`, `task`). */
  readonly source?: string | undefined;
  /** An area key, or {@link NO_AREA}. */
  readonly areaKey?: string | undefined;
  readonly kind?: string | undefined;
}

export interface QueueFacets {
  readonly when: Readonly<Record<QueueWhen, number>>;
  readonly source: readonly { readonly key: string; readonly count: number }[];
  /** `key: null` counts the candidates outside every mapped area. */
  readonly area: readonly { readonly key: string | null; readonly count: number }[];
}

export interface QueueView {
  readonly items: readonly AdoptionCandidateRecord[];
  readonly total: number;
  readonly facets: QueueFacets;
}

/** Where a candidate was read from: its document-tool store, or the task tool's kind. */
export function sourceOf(record: Pick<AdoptionCandidateRecord, 'sourceRole' | 'externalKind'>) {
  return record.sourceRole ?? record.externalKind;
}

/** Which period a candidate falls in, on `today` (`YYYY-MM-DD`). */
export function periodOf(
  record: Pick<AdoptionCandidateRecord, 'startsOn' | 'endsOn'>,
  today: string,
): QueuePeriod {
  if (record.endsOn === null) return 'undated';
  if (record.endsOn < today) return 'ended';
  if (record.startsOn !== null && record.startsOn > today) return 'upcoming';
  return 'current';
}

function matchesWhen(period: QueuePeriod, when: QueueWhen): boolean {
  if (when === 'all') return true;
  if (when === 'open') return period !== 'ended';
  return period === when;
}

function matchesArea(record: AdoptionCandidateRecord, areaKey: string | undefined): boolean {
  if (areaKey === undefined) return true;
  return areaKey === NO_AREA ? record.areaKey === null : record.areaKey === areaKey;
}

type Dimension = 'when' | 'source' | 'area' | 'kind';

interface Row {
  readonly record: AdoptionCandidateRecord;
  readonly period: QueuePeriod;
}

/**
 * Whether a row passes every filter — or every one but `except`, which is how a
 * facet is counted. The one predicate the list, the counts and the bulk ignore
 * all read.
 */
function matches(row: Row, filter: QueueFilter, except?: Dimension): boolean {
  return (
    (except === 'when' || matchesWhen(row.period, filter.when)) &&
    (except === 'source' ||
      filter.source === undefined ||
      sourceOf(row.record) === filter.source) &&
    (except === 'area' || matchesArea(row.record, filter.areaKey)) &&
    (except === 'kind' || filter.kind === undefined || row.record.proposedKind === filter.kind)
  );
}

export function queueView(
  records: readonly AdoptionCandidateRecord[],
  filter: QueueFilter,
  today: string,
  page: { readonly limit: number; readonly offset: number },
): QueueView {
  const rows: readonly Row[] = records.map((record) => ({
    record,
    period: periodOf(record, today),
  }));

  const when: Record<QueueWhen, number> = {
    open: 0,
    current: 0,
    upcoming: 0,
    undated: 0,
    ended: 0,
    all: 0,
  };
  const source = new Map<string, number>();
  const area = new Map<string | null, number>();

  for (const row of rows) {
    if (matches(row, filter, 'when')) {
      when[row.period] += 1;
      when.all += 1;
      if (row.period !== 'ended') when.open += 1;
    }
    if (matches(row, filter, 'source')) {
      const key = sourceOf(row.record);
      source.set(key, (source.get(key) ?? 0) + 1);
    }
    if (matches(row, filter, 'area')) {
      area.set(row.record.areaKey, (area.get(row.record.areaKey) ?? 0) + 1);
    }
  }

  const matching = rows.filter((row) => matches(row, filter)).map((row) => row.record);

  // Largest first, then by key, so the order does not move between two reads of
  // an unchanged queue. The unmapped bucket sorts like any other.
  const ranked = <K extends string | null>(counts: Map<K, number>) =>
    [...counts]
      .map(([key, count]) => ({ key, count }))
      .sort(
        (left, right) =>
          right.count - left.count || String(left.key).localeCompare(String(right.key)),
      );

  return {
    items: matching.slice(page.offset, page.offset + page.limit),
    total: matching.length,
    facets: { when, source: ranked(source), area: ranked(area) },
  };
}

/** The filters a bulk ignore of ended candidates narrows by. `when` is not one of them. */
export type EndedFilter = Omit<QueueFilter, 'when'>;

/**
 * Every ended candidate under the queue's other filters, and a digest naming
 * exactly that set.
 */
export interface EndedSelection {
  /** In the queue's own order. */
  readonly candidates: readonly AdoptionCandidateRecord[];
  readonly count: number;
  /** {@link endedDigest} of `candidates`. */
  readonly digest: string;
}

/**
 * What *Ignore all ended* takes: the rows the *Ended* filter shows, under the
 * same source, area and kind, on the same day.
 *
 * It is the queue's own predicate with `when` pinned to `ended` — built here,
 * after the caller's filter is read, so no filter a caller passes can widen it
 * to a candidate that has not ended. The count is therefore the *Ended* facet's
 * count, by construction rather than by agreement.
 */
export function endedSelection(
  records: readonly AdoptionCandidateRecord[],
  filter: EndedFilter,
  today: string,
): EndedSelection {
  const ended: QueueFilter = {
    source: filter.source,
    areaKey: filter.areaKey,
    kind: filter.kind,
    when: 'ended',
  };
  const candidates = records
    .map((record): Row => ({ record, period: periodOf(record, today) }))
    .filter((row) => matches(row, ended))
    .map((row) => row.record);
  return { candidates, count: candidates.length, digest: endedDigest(candidates) };
}

/**
 * The digest of a set of candidates: W14's {@link hashPlan}, over their
 * identities in a fixed order.
 *
 * It names the set and nothing else — not the day, not the filters, not the
 * titles — so it moves exactly when the set does: a rescan that adds, drops or
 * re-dates one, a decision taken elsewhere, or the date turning over and ending
 * another. `external_kind` is a fixed vocabulary without a colon, so
 * `kind:id` cannot be read two ways.
 */
export function endedDigest(
  candidates: readonly Pick<AdoptionCandidateRecord, 'externalKind' | 'externalId'>[],
): string {
  return hashPlan({
    operation: 'adoption:ignore-ended',
    candidates: candidates
      .map((candidate) => `${candidate.externalKind}:${candidate.externalId}`)
      .sort(),
  });
}

/** Today's calendar day in an IANA timezone, as `YYYY-MM-DD`. */
export function calendarDayIn(timezone: string, now: Date): string {
  // `en-CA` formats a date as ISO year-month-day, which is the one shape the
  // rest of this file compares as text.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
