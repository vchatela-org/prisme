import { describe, expect, it, vi } from 'vitest';
import { checkReadiness } from './health.js';
import type postgres from 'postgres';

/**
 * A tagged-template stand-in for the postgres.js client. `checkReadiness` only
 * ever issues two fixed statements, so this is enough to cover every branch
 * without a database.
 */
function fakeClient(behaviour: { fail?: boolean; version?: string; hang?: boolean }): postgres.Sql {
  const call = vi.fn(async (strings: TemplateStringsArray) => {
    if (behaviour.hang) await new Promise(() => undefined);
    if (behaviour.fail) throw new Error('connection refused to postgres://app:hunter2@db/prisme');
    const text = strings.join('');
    if (text.includes('select version')) {
      return behaviour.version === undefined ? [] : [{ version: behaviour.version }];
    }
    return [{ '?column?': 1 }];
  });
  return call as unknown as postgres.Sql;
}

describe('checkReadiness', () => {
  it('is ready when the database is reachable and the schema matches', async () => {
    const report = await checkReadiness({
      client: fakeClient({ version: '0003' }),
      expected: '0003',
    });
    expect(report.state).toBe('ready');
    expect(report.database).toBe('reachable');
    expect(report.schemaVersion).toBe('0003');
  });

  it('is not ready when the migration Job has not run', async () => {
    const report = await checkReadiness({ client: fakeClient({}), expected: '0001' });
    expect(report.state).toBe('not-ready');
    expect(report.schemaVersion).toBeNull();
    expect(report.reason).toContain('migration Job has not run');
  });

  it('reports version skew rather than pretending to be ready', async () => {
    const report = await checkReadiness({
      client: fakeClient({ version: '0002' }),
      expected: '0005',
    });
    expect(report.state).toBe('not-ready');
    expect(report.reason).toContain('does not match this image');
    expect(report.expectedSchemaVersion).toBe('0005');
  });

  it('never leaks the connection string when the database is down', async () => {
    const report = await checkReadiness({ client: fakeClient({ fail: true }), expected: '0001' });
    expect(report.state).toBe('not-ready');
    expect(report.database).toBe('unreachable');
    expect(JSON.stringify(report)).not.toContain('hunter2');
  });

  it('gives up rather than holding the probe open', async () => {
    const report = await checkReadiness({
      client: fakeClient({ hang: true }),
      expected: '0001',
      timeoutMs: 10,
    });
    expect(report.state).toBe('not-ready');
    expect(report.database).toBe('unreachable');
  });
});
