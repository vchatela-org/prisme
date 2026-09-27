import type postgres from 'postgres';
import { retentionCutoff, WRITE_AUDIT_RETENTION, type WriteAuditOrigin } from '@prisme/domain';
import type { AuditOptions, WriteAttempt, WriteAuditSink } from '@prisme/connectors/write';
import { currentWriteSubject } from './subject.js';

/**
 * `external_write` and `audit_setting` — the audit of outward writes (ADR-0031).
 *
 * The writing half and the pruning half live here, beside each other, because
 * the table is a contract between the two: a row the sink writes is a row the
 * pruner will one day delete, and both read the same window. The API reads the
 * rows through its own store, and the window through {@link readRetentionDays}
 * from this file, so there is one answer to "how long is a record kept".
 *
 * Timestamps cross as text and `request` as `JSON.stringify(…)::jsonb`, for the
 * reason `state/postgres.ts` gives: Drizzle replaces the shared client's
 * serializers, and a value handed to it as an object reaches the socket as one.
 */

type Sql = postgres.Sql;

export interface WriteAuditContext {
  readonly origin: WriteAuditOrigin;
  /** The pass's run id — the same one its log lines carry. */
  readonly runId: string;
}

export function createWriteAuditSink(client: Sql, context: WriteAuditContext): WriteAuditSink {
  return {
    async record(attempt: WriteAttempt): Promise<void> {
      const subject = currentWriteSubject();
      await client`
        insert into external_write
          (occurred_at, tool, operation, origin, run_id, entity_kind, entity_id, external_id,
           request, idempotency_key, outcome, failure, error, duration_ms)
        values (${attempt.startedAt.toISOString()}::timestamptz, ${attempt.tool},
                ${attempt.operation}, ${context.origin}, ${context.runId},
                ${subject?.entityKind ?? null}, ${subject?.entityId ?? null},
                ${attempt.externalId ?? null}, ${JSON.stringify(attempt.request)}::jsonb,
                ${attempt.idempotencyKey}, ${attempt.outcome}, ${attempt.failure ?? null},
                ${attempt.error ?? null}, ${Math.round(attempt.durationMs)})`;
    },
  };
}

/**
 * What the audited writers are constructed with, for one pass.
 *
 * `onRecordError` is the caller's logger: a record that could not be written
 * is worth a line in the run log, and the write it describes stands on its own
 * result (`@prisme/connectors/write`, `audit.ts`).
 */
export function writeAuditOptions(
  client: Sql,
  context: WriteAuditContext & {
    readonly now: () => Date;
    readonly onRecordError: (error: unknown) => void;
  },
): AuditOptions {
  return {
    sink: createWriteAuditSink(client, context),
    now: context.now,
    onRecordError: context.onRecordError,
  };
}

/** The window chosen on the Settings screen, or the default when none has been. */
export async function readRetentionDays(client: Sql): Promise<number> {
  const rows = await client<{ retention_days: number }[]>`
    select retention_days from audit_setting where id = 'singleton'`;
  return rows[0]?.retention_days ?? WRITE_AUDIT_RETENTION.defaultDays;
}

export interface PruneResult {
  readonly deleted: number;
  readonly retentionDays: number;
  readonly cutoff: Date;
}

/**
 * Deletes every record older than the window.
 *
 * Run once a day, at the end of a full pass — prisme's own table, so it runs
 * under the write freeze too. One statement: at a personal instance's volume a
 * day's expired rows are a handful, and batching them would be machinery for a
 * load that does not exist.
 */
export async function pruneWriteAudit(client: Sql, now: Date): Promise<PruneResult> {
  const retentionDays = await readRetentionDays(client);
  const cutoff = retentionCutoff(now, retentionDays);
  const result = await client`
    delete from external_write where occurred_at < ${cutoff.toISOString()}::timestamptz`;
  return { deleted: result.count, retentionDays, cutoff };
}
