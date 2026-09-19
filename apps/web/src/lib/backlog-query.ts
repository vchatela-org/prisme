import { INITIATIVE_STATUSES, type InitiativeStatus } from './contracts';

/**
 * The backlog's filter state, which lives in the URL.
 *
 * Two things follow from that and both are deliberate.
 *
 * **A filtered backlog is a link.** Sending "the three things in Home with a
 * deadline" to yourself for Monday is the whole reason to filter, and state
 * held in React would make the address bar lie about what is on screen.
 *
 * **Sorting happens in the API, not in the table.** `<DataTable>` can sort its
 * own rows and here it deliberately does not: the API sorts by *rank* — the
 * position in the ordering the active scoring method produced — and a
 * client-side re-sort of the visible page would be a second ordering of the
 * same data, on the one screen where a person is deciding what to do with
 * their week (`apps/api/src/routes/views.ts`, `docs/12-scoring.md`).
 *
 * Everything in this module is pure: parsing a query, and writing it back. The
 * round trip is the test — a filter that cannot survive being turned into a
 * URL and read back is a filter that breaks on the first reload.
 */

export const BACKLOG_SORTS = ['score', 'deadline', 'age', 'title', 'size'] as const;
export type BacklogSort = (typeof BACKLOG_SORTS)[number];

export type SortDirection = 'asc' | 'desc';

/** Mirrors `DEFAULT_PAGE_SIZE` and `MAX_PAGE_SIZE` in the API's DTO vocabulary. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface BacklogQuery {
  readonly areaKeys: readonly string[];
  readonly statuses: readonly InitiativeStatus[];
  readonly projectId: string | undefined;
  readonly hasDeadline: boolean | undefined;
  readonly search: string | undefined;
  readonly sort: BacklogSort;
  readonly direction: SortDirection;
  readonly limit: number;
  readonly offset: number;
}

export const DEFAULT_BACKLOG_QUERY: BacklogQuery = {
  areaKeys: [],
  statuses: [],
  projectId: undefined,
  hasDeadline: undefined,
  search: undefined,
  sort: 'score',
  direction: 'asc',
  limit: DEFAULT_PAGE_SIZE,
  offset: 0,
};

/** What Next hands a page: a value may be absent, single, or repeated. */
export type RawSearchParams = Readonly<Record<string, string | string[] | undefined>>;

function first(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key];
  const found = Array.isArray(value) ? value[0] : value;
  return found === undefined || found.trim() === '' ? undefined : found.trim();
}

function csv(raw: RawSearchParams, key: string): readonly string[] {
  const value = first(raw, key);
  if (value === undefined) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== ''),
    ),
  ];
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const AREA_KEY = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Read a query out of the URL, dropping anything that is not a value the API
 * would accept.
 *
 * Dropping rather than failing: a hand-edited or stale URL should show the
 * backlog it can, not an error page. What must not happen is passing an
 * unchecked string upstream — the API would answer `400` and the reader would
 * see an outage instead of a filter that no longer exists.
 */
export function parseBacklogQuery(raw: RawSearchParams): BacklogQuery {
  const statuses = csv(raw, 'status').filter((value): value is InitiativeStatus =>
    (INITIATIVE_STATUSES as readonly string[]).includes(value),
  );

  const sortValue = first(raw, 'sort');
  const sort = (BACKLOG_SORTS as readonly string[]).includes(sortValue ?? '')
    ? (sortValue as BacklogSort)
    : 'score';

  const directionValue = first(raw, 'direction');
  const direction: SortDirection = directionValue === 'desc' ? 'desc' : 'asc';

  const deadline = first(raw, 'hasDeadline');

  return {
    areaKeys: csv(raw, 'areaKey').filter((key) => AREA_KEY.test(key)),
    statuses,
    projectId: first(raw, 'projectId'),
    hasDeadline: deadline === 'true' ? true : deadline === 'false' ? false : undefined,
    // Bounded to the API's own limit so a pasted essay is trimmed here rather
    // than refused there.
    search: first(raw, 'q')?.slice(0, 200),
    sort,
    direction,
    limit: boundedInt(first(raw, 'limit'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    offset: boundedInt(first(raw, 'offset'), 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/**
 * The query as the API's parameters.
 *
 * Only what differs from the default is sent. A request carrying every
 * parameter at its default value makes a log line unreadable and hides which
 * filter a reader actually chose.
 */
export function toApiQuery(query: BacklogQuery): Record<string, string | undefined> {
  return {
    areaKey: query.areaKeys.length > 0 ? query.areaKeys.join(',') : undefined,
    status: query.statuses.length > 0 ? query.statuses.join(',') : undefined,
    projectId: query.projectId,
    hasDeadline: query.hasDeadline === undefined ? undefined : String(query.hasDeadline),
    q: query.search,
    sort: query.sort,
    direction: query.direction,
    limit: String(query.limit),
    offset: query.offset > 0 ? String(query.offset) : undefined,
  };
}

/**
 * The query as a URL for this application — `?status=now,next&sort=deadline`.
 *
 * Defaults are omitted, so an unfiltered backlog is `/backlog` and not
 * `/backlog?sort=score&direction=asc&limit=50&offset=0`. A clean address is
 * what makes a filter shareable and a reset obvious.
 */
export function toSearchString(query: BacklogQuery): string {
  const params = new URLSearchParams();
  if (query.areaKeys.length > 0) params.set('areaKey', query.areaKeys.join(','));
  if (query.statuses.length > 0) params.set('status', query.statuses.join(','));
  if (query.projectId !== undefined) params.set('projectId', query.projectId);
  if (query.hasDeadline !== undefined) params.set('hasDeadline', String(query.hasDeadline));
  if (query.search !== undefined) params.set('q', query.search);
  if (query.sort !== DEFAULT_BACKLOG_QUERY.sort) params.set('sort', query.sort);
  if (query.direction !== DEFAULT_BACKLOG_QUERY.direction) params.set('direction', query.direction);
  if (query.limit !== DEFAULT_PAGE_SIZE) params.set('limit', String(query.limit));
  if (query.offset > 0) params.set('offset', String(query.offset));

  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/** A URL for the same backlog with one thing changed. Paging resets to the top. */
export function withChange(query: BacklogQuery, change: Partial<BacklogQuery>): BacklogQuery {
  const next = { ...query, ...change };
  // Any change other than the page itself puts the reader back on page one: a
  // filter applied while on page 4 otherwise lands on an empty page, which
  // reads exactly like "no results".
  return change.offset === undefined ? { ...next, offset: 0 } : next;
}

/** Whether anything is filtering the list — what an "empty" state has to know. */
export function isFiltered(query: BacklogQuery): boolean {
  return (
    query.areaKeys.length > 0 ||
    query.statuses.length > 0 ||
    query.projectId !== undefined ||
    query.hasDeadline !== undefined ||
    query.search !== undefined
  );
}

export interface PagePosition {
  readonly from: number;
  readonly to: number;
  readonly total: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/** Where the reader is in the list, in the numbers a pager shows. */
export function pagePosition(offset: number, limit: number, total: number): PagePosition {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return {
    from,
    to,
    total,
    hasPrevious: offset > 0,
    hasNext: offset + limit < total,
  };
}
