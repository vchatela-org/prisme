import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BACKLOG_QUERY,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  isFiltered,
  pagePosition,
  parseBacklogQuery,
  toApiQuery,
  toSearchString,
  withChange,
} from './backlog-query';

describe('parseBacklogQuery', () => {
  it('reads an empty URL as the default view', () => {
    expect(parseBacklogQuery({})).toEqual(DEFAULT_BACKLOG_QUERY);
  });

  it('splits comma-separated filters and drops duplicates', () => {
    const query = parseBacklogQuery({ status: 'now,next,now', areaKey: 'craft,home' });

    expect(query.statuses).toEqual(['now', 'next']);
    expect(query.areaKeys).toEqual(['craft', 'home']);
  });

  it('drops a status the API does not have rather than passing it upstream', () => {
    // A stale bookmark must show the backlog it can, not a 400.
    expect(parseBacklogQuery({ status: 'now,urgent' }).statuses).toEqual(['now']);
  });

  it('drops an area key that is not a slug', () => {
    expect(parseBacklogQuery({ areaKey: 'craft,Home Office' }).areaKeys).toEqual(['craft']);
  });

  it('reads hasDeadline as three states, not two', () => {
    expect(parseBacklogQuery({ hasDeadline: 'true' }).hasDeadline).toBe(true);
    expect(parseBacklogQuery({ hasDeadline: 'false' }).hasDeadline).toBe(false);
    expect(parseBacklogQuery({ hasDeadline: 'maybe' }).hasDeadline).toBeUndefined();
    expect(parseBacklogQuery({}).hasDeadline).toBeUndefined();
  });

  it('falls back to the ranked ordering when the sort is not one the API offers', () => {
    expect(parseBacklogQuery({ sort: 'wsjf' }).sort).toBe('score');
  });

  it('takes the first value when a parameter is repeated', () => {
    expect(parseBacklogQuery({ sort: ['deadline', 'title'] }).sort).toBe('deadline');
  });

  it('bounds the page size to what the API accepts', () => {
    expect(parseBacklogQuery({ limit: '5000' }).limit).toBe(MAX_PAGE_SIZE);
    expect(parseBacklogQuery({ limit: '0' }).limit).toBe(1);
    expect(parseBacklogQuery({ limit: 'many' }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(parseBacklogQuery({ offset: '-10' }).offset).toBe(0);
  });

  it('trims a search to the length the API accepts', () => {
    expect(parseBacklogQuery({ q: 'x'.repeat(500) }).search).toHaveLength(200);
  });

  it('treats blank values as absent', () => {
    expect(parseBacklogQuery({ q: '   ', status: '', areaKey: ',' })).toEqual(
      DEFAULT_BACKLOG_QUERY,
    );
  });
});

describe('toSearchString', () => {
  it('writes nothing for the default view', () => {
    expect(toSearchString(DEFAULT_BACKLOG_QUERY)).toBe('');
  });

  it('round-trips every filter it can write', () => {
    const query = parseBacklogQuery({
      status: 'now,next',
      areaKey: 'craft',
      hasDeadline: 'true',
      q: 'bench',
      sort: 'deadline',
      direction: 'desc',
      limit: '25',
      offset: '50',
    });

    const roundTripped = parseBacklogQuery(
      Object.fromEntries(new URLSearchParams(toSearchString(query))),
    );

    expect(roundTripped).toEqual(query);
  });
});

describe('withChange', () => {
  it('returns to the first page when a filter changes', () => {
    const paged = { ...DEFAULT_BACKLOG_QUERY, offset: 100 };
    expect(withChange(paged, { statuses: ['now'] }).offset).toBe(0);
  });

  it('keeps the offset when the offset is what changed', () => {
    expect(withChange(DEFAULT_BACKLOG_QUERY, { offset: 50 }).offset).toBe(50);
  });
});

describe('toApiQuery', () => {
  it('omits what has not been chosen', () => {
    const query = toApiQuery(DEFAULT_BACKLOG_QUERY);

    expect(query['areaKey']).toBeUndefined();
    expect(query['status']).toBeUndefined();
    expect(query['offset']).toBeUndefined();
    expect(query['sort']).toBe('score');
  });

  it('sends false for hasDeadline, which is a filter and not an absence', () => {
    expect(toApiQuery({ ...DEFAULT_BACKLOG_QUERY, hasDeadline: false })['hasDeadline']).toBe(
      'false',
    );
  });
});

describe('isFiltered', () => {
  it('is false for the default view and true for any filter', () => {
    expect(isFiltered(DEFAULT_BACKLOG_QUERY)).toBe(false);
    expect(isFiltered({ ...DEFAULT_BACKLOG_QUERY, search: 'bench' })).toBe(true);
    expect(isFiltered({ ...DEFAULT_BACKLOG_QUERY, hasDeadline: false })).toBe(true);
  });

  it('does not count sorting or paging as filtering', () => {
    // An empty page 4 explains itself differently from an empty filter.
    expect(isFiltered({ ...DEFAULT_BACKLOG_QUERY, sort: 'title', offset: 150 })).toBe(false);
  });
});

describe('pagePosition', () => {
  it('counts from one', () => {
    expect(pagePosition(0, 50, 120)).toMatchObject({ from: 1, to: 50, hasPrevious: false });
  });

  it('stops at the total on the last page', () => {
    expect(pagePosition(100, 50, 120)).toMatchObject({ from: 101, to: 120, hasNext: false });
  });

  it('says zero of zero rather than one of zero when there is nothing', () => {
    expect(pagePosition(0, 50, 0)).toMatchObject({ from: 0, to: 0, hasNext: false });
  });
});
