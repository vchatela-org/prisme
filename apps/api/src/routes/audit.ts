import { z } from 'zod';
import {
  AuditRetentionDto,
  ExternalWritePageDto,
  putAuditRetentionBody,
  writeAuditOperation,
  writeAuditOrigin,
  writeAuditOutcome,
  writeAuditTool,
} from '../dto/audit.js';
import { csvOf, instant } from '../dto/common.js';
import { defineRoute, noQuery, pageQuery, type ApiRoute } from './kit.js';

/**
 * The audit of outward writes (ADR-0031).
 *
 * The records are `read:sync` — they are reconciliation's own history, beside
 * the conflict ledger and the last run. The window is `admin:settings`, like
 * every other setting a screen changes. There is no route that writes or
 * deletes a record, and there must not be one.
 */
export const auditRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'listExternalWrites',
    method: 'get',
    path: '/audit/writes',
    scope: 'read:sync',
    summary: 'Every call prisme made to the document tool or the task tool, most recent first',
    description:
      'One record per call, failures included, kept for the retention window (`GET /audit/retention`). `tool` and `operation` take comma-separated lists. `from` is inclusive and `to` exclusive. `search` matches, case-insensitively, anything in what was sent, the external object’s id, or the current title of the entity the call was made for. `request` and `externalId` are instance data.',
    query: z.strictObject({
      ...pageQuery.shape,
      tool: csvOf(writeAuditTool, 'a tool'),
      operation: csvOf(writeAuditOperation, 'an audited operation'),
      outcome: writeAuditOutcome.optional(),
      origin: writeAuditOrigin.optional(),
      entityId: z.string().min(1).max(200).optional(),
      from: instant.optional(),
      to: instant.optional(),
      search: z.string().trim().min(1).max(200).optional(),
    }),
    response: ExternalWritePageDto,
    handle: async (context, services) => {
      const query = context.query;
      const result = await services.audit.writes(
        {
          tools: query.tool,
          operations: query.operation,
          outcome: query.outcome,
          origin: query.origin,
          entityId: query.entityId,
          from: query.from === undefined ? undefined : new Date(query.from),
          to: query.to === undefined ? undefined : new Date(query.to),
          search: query.search,
        },
        { limit: query.limit, offset: query.offset },
      );
      return { ...result, limit: query.limit, offset: query.offset };
    },
  }),

  defineRoute({
    operationId: 'getAuditRetention',
    method: 'get',
    path: '/audit/retention',
    scope: 'admin:settings',
    summary: 'How long a record of an outward write is kept, and how many are held',
    description:
      'The window in force — the one chosen on the Settings screen, or the default when none has been — with its bounds. Records older than it are deleted by the daily full pass.',
    query: noQuery,
    response: AuditRetentionDto,
    handle: (_context, services) => services.audit.retention(),
  }),

  defineRoute({
    operationId: 'putAuditRetention',
    method: 'put',
    path: '/audit/retention',
    scope: 'admin:settings',
    summary: 'Choose how long a record of an outward write is kept',
    description:
      'A whole number of days within the bounds `GET /audit/retention` reports. Shortening it deletes nothing now: the next daily full pass prunes to the new window.',
    body: putAuditRetentionBody,
    status: 200,
    response: AuditRetentionDto,
    handle: (context, services) =>
      services.audit.setRetention(context.body.retentionDays, context.now),
  }),
];
