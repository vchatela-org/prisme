import {
  WRITE_AUDIT_OPERATIONS,
  WRITE_AUDIT_ORIGINS,
  WRITE_AUDIT_OUTCOMES,
  WRITE_AUDIT_TOOLS,
  type WriteAuditOperation,
  type WriteAuditOrigin,
  type WriteAuditOutcome,
  type WriteAuditTool,
} from './contracts';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type RawSearchParams } from './backlog-query';

/**
 * The audit screen's filters, which live in the URL — for the backlog's
 * reasons (`./backlog-query.ts`): a filtered audit is a link, and the address
 * bar never disagrees with the table.
 *
 * The period is a preset rather than two date pickers. The question the screen
 * answers is "what did prisme just do", and the answer is nearly always in the
 * last day or the last week; a range picker is machinery for the rare case,
 * and the API takes any `from`/`to` for whoever needs it.
 *
 * Pure, like its sibling: parse, and write back. The round trip is the test.
 */

export const AUDIT_PERIODS = ['day', 'week', 'month', 'all'] as const;
export type AuditPeriod = (typeof AUDIT_PERIODS)[number];

const PERIOD_MS: Readonly<Record<Exclude<AuditPeriod, 'all'>, number>> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

export interface AuditQuery {
  readonly tools: readonly WriteAuditTool[];
  readonly operations: readonly WriteAuditOperation[];
  readonly outcome: WriteAuditOutcome | undefined;
  readonly origin: WriteAuditOrigin | undefined;
  readonly period: AuditPeriod;
  readonly search: string | undefined;
  readonly limit: number;
  readonly offset: number;
}

export const DEFAULT_AUDIT_QUERY: AuditQuery = {
  tools: [],
  operations: [],
  outcome: undefined,
  origin: undefined,
  period: 'all',
  search: undefined,
  limit: DEFAULT_PAGE_SIZE,
  offset: 0,
};

function first(raw: RawSearchParams, key: string): string | undefined {
  const value = raw[key];
  const found = Array.isArray(value) ? value[0] : value;
  return found === undefined || found.trim() === '' ? undefined : found.trim();
}

function oneOf<T extends string>(
  vocabulary: readonly T[],
  value: string | undefined,
): T | undefined {
  return value !== undefined && (vocabulary as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function csvOf<T extends string>(vocabulary: readonly T[], raw: RawSearchParams, key: string): T[] {
  const value = first(raw, key);
  if (value === undefined) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part): part is T => (vocabulary as readonly string[]).includes(part)),
    ),
  ];
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Read a query out of the URL, dropping anything the API would not accept —
 * a stale link shows the audit it can rather than an error page.
 */
export function parseAuditQuery(raw: RawSearchParams): AuditQuery {
  return {
    tools: csvOf(WRITE_AUDIT_TOOLS, raw, 'tool'),
    operations: csvOf(WRITE_AUDIT_OPERATIONS, raw, 'operation'),
    outcome: oneOf(WRITE_AUDIT_OUTCOMES, first(raw, 'outcome')),
    origin: oneOf(WRITE_AUDIT_ORIGINS, first(raw, 'origin')),
    period: oneOf(AUDIT_PERIODS, first(raw, 'period')) ?? 'all',
    search: first(raw, 'q')?.slice(0, 200),
    limit: boundedInt(first(raw, 'limit'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    offset: boundedInt(first(raw, 'offset'), 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** The query as the API's parameters. The period becomes a `from`, measured from `now`. */
export function toAuditApiQuery(query: AuditQuery, now: Date): Record<string, string | undefined> {
  return {
    tool: query.tools.length > 0 ? query.tools.join(',') : undefined,
    operation: query.operations.length > 0 ? query.operations.join(',') : undefined,
    outcome: query.outcome,
    origin: query.origin,
    from:
      query.period === 'all'
        ? undefined
        : new Date(now.getTime() - PERIOD_MS[query.period]).toISOString(),
    search: query.search,
    limit: String(query.limit),
    offset: query.offset > 0 ? String(query.offset) : undefined,
  };
}

/** The query as a URL for this application. Defaults are omitted. */
export function toAuditSearchString(query: AuditQuery): string {
  const params = new URLSearchParams();
  if (query.tools.length > 0) params.set('tool', query.tools.join(','));
  if (query.operations.length > 0) params.set('operation', query.operations.join(','));
  if (query.outcome !== undefined) params.set('outcome', query.outcome);
  if (query.origin !== undefined) params.set('origin', query.origin);
  if (query.period !== DEFAULT_AUDIT_QUERY.period) params.set('period', query.period);
  if (query.search !== undefined) params.set('q', query.search);
  if (query.limit !== DEFAULT_PAGE_SIZE) params.set('limit', String(query.limit));
  if (query.offset > 0) params.set('offset', String(query.offset));

  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/** The same audit with one thing changed. Any change but the page itself goes back to page one. */
export function withAuditChange(query: AuditQuery, change: Partial<AuditQuery>): AuditQuery {
  const next = { ...query, ...change };
  return change.offset === undefined ? { ...next, offset: 0 } : next;
}

export function isAuditFiltered(query: AuditQuery): boolean {
  return (
    query.tools.length > 0 ||
    query.operations.length > 0 ||
    query.outcome !== undefined ||
    query.origin !== undefined ||
    query.period !== 'all' ||
    query.search !== undefined
  );
}
