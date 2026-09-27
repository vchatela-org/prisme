import type { z } from 'zod';
import { isRetentionDays, WRITE_AUDIT_RETENTION } from '@prisme/domain';
import type { auditRetentionDto, externalWriteDto } from '../dto/audit.js';
import { ApiError } from '../http/errors.js';
import type {
  ApiStore,
  ExternalWriteFilter,
  ExternalWriteRecord,
  PageRequest,
} from '../store/types.js';

/**
 * The audit of outward writes (ADR-0031), as the screens read it.
 *
 * Two things live here and nowhere else: the conversion of a record to its DTO,
 * and the answer to "what is the window in force", which is the chosen one or
 * the domain's default. The pass that prunes reads the same default from the
 * same constant (`WRITE_AUDIT_RETENTION`), so the number this shows is the
 * number that is enforced.
 */

export type ExternalWriteShape = z.infer<typeof externalWriteDto>;
export type AuditRetentionShape = z.infer<typeof auditRetentionDto>;

export interface AuditService {
  writes(
    filter: ExternalWriteFilter,
    page: PageRequest,
  ): Promise<{ items: ExternalWriteShape[]; total: number }>;
  retention(): Promise<AuditRetentionShape>;
  setRetention(days: number, now: Date): Promise<AuditRetentionShape>;
}

function toDto(record: ExternalWriteRecord): ExternalWriteShape {
  return {
    id: record.id,
    occurredAt: record.occurredAt.toISOString(),
    tool: record.tool,
    operation: record.operation,
    origin: record.origin,
    runId: record.runId,
    entityKind: record.entityKind,
    entityId: record.entityId,
    entityTitle: record.entityTitle,
    externalId: record.externalId,
    request: { ...record.request },
    outcome: record.outcome,
    failure: record.failure,
    error: record.error,
    durationMs: record.durationMs,
  };
}

export function createAuditService(store: ApiStore): AuditService {
  async function retention(): Promise<AuditRetentionShape> {
    const record = await store.audit.retention();
    return {
      retentionDays: record.retentionDays ?? WRITE_AUDIT_RETENTION.defaultDays,
      chosen: record.retentionDays !== null,
      defaultDays: WRITE_AUDIT_RETENTION.defaultDays,
      minDays: WRITE_AUDIT_RETENTION.minDays,
      maxDays: WRITE_AUDIT_RETENTION.maxDays,
      updatedAt: record.updatedAt?.toISOString() ?? null,
      records: record.records,
      oldestAt: record.oldestAt?.toISOString() ?? null,
    };
  }

  return {
    async writes(filter, page) {
      const paged = await store.audit.writes(filter, page);
      return { items: paged.items.map(toDto), total: paged.total };
    },

    retention,

    async setRetention(days, now) {
      // The body schema already bounds it; this is the rule, stated where the
      // rule lives, so a second caller (an MCP tool, one day) inherits it.
      if (!isRetentionDays(days)) {
        throw new ApiError('invalid_request', 'the retention window is out of bounds', [
          {
            field: 'retentionDays',
            reason: `a whole number of days from ${String(WRITE_AUDIT_RETENTION.minDays)} to ${String(WRITE_AUDIT_RETENTION.maxDays)}`,
          },
        ]);
      }
      await store.audit.setRetention(days, now);
      return retention();
    },
  };
}
