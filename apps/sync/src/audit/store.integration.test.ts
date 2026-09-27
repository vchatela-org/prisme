import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditCreationWriter,
  auditTaskToolWriter,
  createFrozenWriter,
  createRecordingCreationWriter,
  createRecordingWriter,
} from '@prisme/connectors/write';
import { WRITE_AUDIT_RETENTION } from '@prisme/domain';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from '../test-support/database.js';
import { pruneWriteAudit, readRetentionDays, writeAuditOptions } from './store.js';
import { withWriteSubject } from './subject.js';

/**
 * The audit of outward writes, against a real PostgreSQL (ADR-0031).
 *
 * What a fake sink could not show: that the row the writer records is the row
 * the table accepts — the operation vocabulary, the failure-iff-failed CHECK,
 * `request` crossing as jsonb through the wrapped client the application runs
 * — and that pruning deletes by the window the Settings screen chose and
 * nothing younger. Every identifier and title below is invented.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

const TABLES = ['external_write', 'audit_setting'];

describeOrSkip('the write audit against PostgreSQL', () => {
  let database: SyncTestDatabase;

  beforeAll(async () => {
    database = await openTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate(TABLES);
  });

  const at = new Date('2026-03-02T09:00:00.000Z');

  function options(origin: 'reconciler' | 'creation', recordErrors: unknown[] = []) {
    return writeAuditOptions(database.client, {
      origin,
      runId: 'run-audit-test',
      now: () => at,
      onRecordError: (error) => {
        recordErrors.push(error);
      },
    });
  }

  interface Row {
    tool: string;
    operation: string;
    origin: string;
    run_id: string;
    entity_kind: string | null;
    entity_id: string | null;
    external_id: string | null;
    request: string;
    outcome: string;
    failure: string | null;
    error: string | null;
  }

  const rows = () =>
    database.client<Row[]>`
      select tool, operation, origin, run_id, entity_kind, entity_id, external_id,
             request::text, outcome, failure, error
      from external_write order by id`;

  it('records a successful write with the entity it was made for', async () => {
    const writer = auditTaskToolWriter(createRecordingWriter().writer, options('reconciler'));

    await withWriteSubject({ entityKind: 'initiative', entityId: 'init-0001' }, () =>
      writer.updateTask('task-0007', { priority: 'highest', content: 'An invented title' }, 'k-1'),
    );

    const [row] = await rows();
    expect(row).toMatchObject({
      tool: 'task',
      operation: 'update_task',
      origin: 'reconciler',
      run_id: 'run-audit-test',
      entity_kind: 'initiative',
      entity_id: 'init-0001',
      external_id: 'task-0007',
      outcome: 'succeeded',
      failure: null,
      error: null,
    });
    expect(JSON.parse(row?.request ?? '{}')).toEqual({
      priority: 'highest',
      content: 'An invented title',
    });
  });

  it('records a failure the table accepts, with its kind and a redacted message', async () => {
    const recordErrors: unknown[] = [];
    const writer = auditTaskToolWriter(createFrozenWriter(), options('reconciler', recordErrors));

    await expect(writer.moveTask('task-0007', { projectId: 'p-1' }, 'k-2')).rejects.toThrow();

    expect(recordErrors).toEqual([]);
    const [row] = await rows();
    expect(row).toMatchObject({ outcome: 'failed', failure: 'refused', entity_id: null });
    expect(row?.error).toContain('no outward write was attempted');
  });

  it('records a creation as the creation ledger made it', async () => {
    const writer = auditCreationWriter(
      createRecordingCreationWriter({ createdIds: ['project-0042'] }).writer,
      options('creation'),
    );

    await withWriteSubject({ entityKind: 'project', entityId: 'proj-0001' }, () =>
      writer.createProject({ name: 'An invented project' }, 'k-3'),
    );

    const [row] = await rows();
    expect(row).toMatchObject({
      origin: 'creation',
      operation: 'create_project',
      external_id: 'project-0042',
      entity_kind: 'project',
    });
  });

  it('never changes a record', async () => {
    const writer = auditTaskToolWriter(createRecordingWriter().writer, options('reconciler'));
    await writer.updateTask('task-0007', { priority: 'high' }, 'k-4');

    await expect(
      database.client`update external_write set outcome = 'failed', failure = 'refused'`,
    ).rejects.toThrow(/never changed/);
  });

  it('reads the default window until one is chosen', async () => {
    expect(await readRetentionDays(database.client)).toBe(WRITE_AUDIT_RETENTION.defaultDays);

    await database.client`
      insert into audit_setting (retention_days, updated_at) values (30, ${at.toISOString()}::timestamptz)`;
    expect(await readRetentionDays(database.client)).toBe(30);
  });

  it('refuses a window the domain would refuse', async () => {
    await expect(
      database.client`
        insert into audit_setting (retention_days, updated_at) values (0, ${at.toISOString()}::timestamptz)`,
    ).rejects.toThrow();
  });

  it('prunes what is older than the window, and nothing younger', async () => {
    await database.client`
      insert into audit_setting (retention_days, updated_at) values (7, ${at.toISOString()}::timestamptz)`;

    const insertAt = (occurredAt: string) => database.client`
      insert into external_write
        (occurred_at, tool, operation, origin, run_id, request, idempotency_key, outcome, duration_ms)
      values (${occurredAt}::timestamptz, 'task', 'update_task', 'reconciler', 'r',
              '{}'::jsonb, 'k', 'succeeded', 1)`;
    await insertAt('2026-02-20T09:00:00.000Z'); // 10 days before `at`
    await insertAt('2026-02-23T08:59:59.000Z'); // a second past the window
    await insertAt('2026-02-23T09:00:00.000Z'); // exactly on the cutoff: kept
    await insertAt('2026-03-01T09:00:00.000Z'); // yesterday

    const pruned = await pruneWriteAudit(database.client, at);

    expect(pruned).toMatchObject({ deleted: 2, retentionDays: 7 });
    const left = await database.client<{ occurred_at: Date }[]>`
      select occurred_at from external_write order by occurred_at`;
    expect(left.map((row) => new Date(row.occurred_at).toISOString())).toEqual([
      '2026-02-23T09:00:00.000Z',
      '2026-03-01T09:00:00.000Z',
    ]);
  });
});
