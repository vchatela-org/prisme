import { z } from 'zod';
import {
  WRITE_AUDIT_OPERATIONS,
  WRITE_AUDIT_ORIGINS,
  WRITE_AUDIT_OUTCOMES,
  WRITE_AUDIT_RETENTION,
  WRITE_AUDIT_TOOLS,
} from '@prisme/domain';
import { defineWrite, named } from '../http/schema.js';
import { instant, page } from './common.js';

/**
 * The audit of outward writes (ADR-0031): every call prisme made to the
 * document tool or the task tool, and how long a record of one is kept.
 *
 * **Read-only, apart from the window.** There is no endpoint that writes,
 * edits or deletes a record: they are written by the writers themselves as the
 * calls happen, and deleted by the daily pass once they are older than the
 * window. An audit with an edit path is a log somebody can tidy.
 *
 * `request` and `externalId` are **instance data** — what was sent, and the
 * object it was sent to. They reach the owner's browser, and the vocabulary
 * around them (tool, operation, failure kind) is the only part safe to quote
 * anywhere else.
 */

export const writeAuditTool = z.enum(WRITE_AUDIT_TOOLS);
export const writeAuditOperation = z.enum(WRITE_AUDIT_OPERATIONS);
export const writeAuditOrigin = z.enum(WRITE_AUDIT_ORIGINS);
export const writeAuditOutcome = z.enum(WRITE_AUDIT_OUTCOMES);

export const externalWriteDto = z.object({
  id: z.string(),
  occurredAt: instant,
  tool: writeAuditTool,
  operation: writeAuditOperation,
  /** Which half of the sync made the call: the reconciler, or the creation ledger. */
  origin: writeAuditOrigin,
  /** The pass's run id, the same one its log lines carry. */
  runId: z.string(),
  /** The prisme entity the call was made for, when the pass knew it. */
  entityKind: z.string().nullable(),
  entityId: z.string().nullable(),
  /**
   * The entity's title as it is **now** — read beside the record, not stored in
   * it, so an update or a move that sent no title can still say what it was
   * about. `null` when the entity is unknown or has since been removed.
   */
  entityTitle: z.string().nullable(),
  /** The object written to, or what a create made. `null` for a create that failed. */
  externalId: z.string().nullable(),
  /** What prisme asked for, in its own vocabulary. Instance data. */
  request: z.record(z.string(), z.unknown()),
  outcome: writeAuditOutcome,
  /** A connector failure kind, or `unclassified`. `null` when the call succeeded. */
  failure: z.string().nullable(),
  /** Redacted by construction: never the tool's own prose. */
  error: z.string().nullable(),
  durationMs: z.int().min(0),
});

export const ExternalWritePageDto = named('ExternalWritePage', page(externalWriteDto));

export const auditRetentionDto = z.object({
  /** The window in force: the chosen one, or the default when none has been chosen. */
  retentionDays: z.int(),
  /** Whether that window was chosen, or is the default. */
  chosen: z.boolean(),
  defaultDays: z.int(),
  minDays: z.int(),
  maxDays: z.int(),
  updatedAt: instant.nullable(),
  /** How many records are held now. */
  records: z.int().min(0),
  /** The oldest record held. `null` when there are none. */
  oldestAt: instant.nullable(),
});

export const AuditRetentionDto = named('AuditRetention', auditRetentionDto);

export const putAuditRetentionBody = defineWrite(
  'PutAuditRetention',
  z.strictObject({
    retentionDays: z.int().min(WRITE_AUDIT_RETENTION.minDays).max(WRITE_AUDIT_RETENTION.maxDays),
  }),
);
