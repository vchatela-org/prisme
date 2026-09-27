import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIT_QUERY,
  isAuditFiltered,
  parseAuditQuery,
  toAuditApiQuery,
  toAuditSearchString,
  withAuditChange,
  type AuditQuery,
} from './audit-query';

describe('the audit query', () => {
  it('is empty by default, and an unfiltered audit is a bare address', () => {
    expect(parseAuditQuery({})).toEqual(DEFAULT_AUDIT_QUERY);
    expect(toAuditSearchString(DEFAULT_AUDIT_QUERY)).toBe('');
    expect(isAuditFiltered(DEFAULT_AUDIT_QUERY)).toBe(false);
  });

  it('survives being written to a URL and read back', () => {
    const query: AuditQuery = {
      tools: ['document'],
      operations: ['create_page', 'update_task'],
      outcome: 'failed',
      origin: 'creation',
      period: 'week',
      search: 'fence',
      limit: 20,
      offset: 40,
    };
    const search = toAuditSearchString(query);
    const raw = Object.fromEntries(new URLSearchParams(search.slice(1)));
    expect(parseAuditQuery(raw)).toEqual(query);
  });

  it('drops what the API would refuse rather than failing the page', () => {
    expect(
      parseAuditQuery({
        tool: 'document,spreadsheet',
        operation: 'delete_task,move_task',
        outcome: 'maybe',
        origin: 'someone',
        period: 'decade',
        limit: '100000',
        offset: '-3',
      }),
    ).toEqual({
      ...DEFAULT_AUDIT_QUERY,
      tools: ['document'],
      operations: ['move_task'],
      limit: 200,
      offset: 0,
    });
  });

  it('turns a period into a `from` measured back from now', () => {
    const now = new Date('2026-03-08T12:00:00.000Z');
    expect(toAuditApiQuery({ ...DEFAULT_AUDIT_QUERY, period: 'day' }, now)['from']).toBe(
      '2026-03-07T12:00:00.000Z',
    );
    expect(toAuditApiQuery({ ...DEFAULT_AUDIT_QUERY, period: 'week' }, now)['from']).toBe(
      '2026-03-01T12:00:00.000Z',
    );
    expect(toAuditApiQuery(DEFAULT_AUDIT_QUERY, now)['from']).toBeUndefined();
  });

  it('sends only what differs from the default', () => {
    const api = toAuditApiQuery(
      { ...DEFAULT_AUDIT_QUERY, tools: ['task'], outcome: 'succeeded' },
      new Date('2026-03-08T12:00:00.000Z'),
    );
    expect(api).toEqual({
      tool: 'task',
      operation: undefined,
      outcome: 'succeeded',
      origin: undefined,
      from: undefined,
      search: undefined,
      limit: '50',
      offset: undefined,
    });
  });

  it('goes back to the first page when a filter changes, and not when the page does', () => {
    const onPageThree = { ...DEFAULT_AUDIT_QUERY, offset: 100 };
    expect(withAuditChange(onPageThree, { outcome: 'failed' }).offset).toBe(0);
    expect(withAuditChange(onPageThree, { offset: 150 }).offset).toBe(150);
  });
});
