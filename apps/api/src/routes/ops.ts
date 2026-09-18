import { z } from 'zod';
import { instant, reviewCadence } from '../dto/common.js';
import {
  AdoptionEntryDto,
  AdoptionPageDto,
  ConflictDto,
  ConflictPageDto,
  decideAdoptionBody,
  EventPageDto,
  openReviewBody,
  resolveConflictBody,
  ReviewSessionDto,
  ReviewSessionPageDto,
  SettingsDto,
  SyncRunDto,
  SyncStatusDto,
  triggerSyncBody,
  updateReviewBody,
} from '../dto/ops.js';
import { defineRoute, idParam, noQuery, pageQuery, type ApiRoute } from './kit.js';

/**
 * Reviews, the event log, adoption, conflicts, settings, and the force-sync
 * button.
 *
 * `POST /sync` is the one route here that reaches outward. It runs the same
 * `reconcile` the CronJob runs, behind the same PostgreSQL advisory lock, and
 * it defaults to `plan` — a dry run that returns a diff and takes no action.
 * That default is not politeness: `plan` before `apply` is how every write path
 * in prisme works, and a force-sync button whose default was `apply` would be
 * the one place the rule did not hold.
 *
 * The lock is non-blocking. A second pass is **skipped**, not queued: a queue of
 * reconciler passes drains into a series of decisions made from stale state,
 * and the next scheduled pass sees the world as it is then, which is what
 * level-triggered means (ADR-0009).
 */
export const opsRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'listReviews',
    method: 'get',
    path: '/reviews',
    scope: 'read:reviews',
    summary: 'Review sessions, most recent first',
    query: z.strictObject({ ...pageQuery.shape, cadence: reviewCadence.optional() }),
    response: ReviewSessionPageDto,
    handle: async (context, services) => {
      const result = await services.ops.reviews(context.query.cadence, {
        limit: context.query.limit,
        offset: context.query.offset,
      });
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'openReview',
    method: 'post',
    path: '/reviews',
    scope: 'write:review',
    summary: 'Open a review session',
    body: openReviewBody,
    response: ReviewSessionDto,
    handle: (context, services) => services.ops.openReview(context.body.cadence, context.now),
  }),

  defineRoute({
    operationId: 'getReview',
    method: 'get',
    path: '/reviews/:id',
    scope: 'read:reviews',
    summary: 'One review session',
    params: idParam,
    response: ReviewSessionDto,
    handle: (context, services) => services.ops.getReview(context.params.id),
  }),

  defineRoute({
    operationId: 'updateReview',
    method: 'patch',
    path: '/reviews/:id',
    scope: 'write:review',
    summary: 'Tick the checklist, record decisions, or close the session',
    description:
      'Closing takes a capacity snapshot at that moment and stores it. Reopening does not retake it: what the review saw is part of what the review decided.',
    params: idParam,
    body: updateReviewBody,
    response: ReviewSessionDto,
    handle: (context, services) =>
      services.ops.updateReview(context.params.id, context.body, context.now),
  }),

  defineRoute({
    operationId: 'listEvents',
    method: 'get',
    path: '/events',
    scope: 'read:reviews',
    summary: 'The event log, most recent first',
    description:
      'Append-only, and load-bearing three times over: KPIs are impossible without it, replanning needs to know what changed, and it doubles as the security audit trail. There is no endpoint that edits one.',
    query: z.strictObject({
      ...pageQuery.shape,
      kind: z
        .enum([
          'score_changed',
          'status_changed',
          'weight_changed',
          'completed',
          'sync_action',
          'adoption_decision',
        ])
        .optional(),
      entityKind: z.string().min(1).max(50).optional(),
      entityId: z.string().min(1).max(200).optional(),
      from: instant.optional(),
      to: instant.optional(),
    }),
    response: EventPageDto,
    handle: async (context, services) => {
      const result = await services.ops.events(
        {
          kind: context.query.kind,
          entityKind: context.query.entityKind,
          entityId: context.query.entityId,
          from: context.query.from === undefined ? undefined : new Date(context.query.from),
          to: context.query.to === undefined ? undefined : new Date(context.query.to),
        },
        { limit: context.query.limit, offset: context.query.offset },
      );
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'listAdoption',
    method: 'get',
    path: '/adoption',
    scope: 'read:adoption',
    summary: 'The adoption ledger: what was decided, and what is actually bound',
    description:
      'W12 owns the queue that produces candidates. What is served here is the ledger those decisions land in, and `bound` — whether the external object is tied to the prisme entity yet, which is the difference between a decision and a fact.',
    query: z.strictObject({
      ...pageQuery.shape,
      bound: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => (value === undefined ? undefined : value === 'true')),
    }),
    response: AdoptionPageDto,
    handle: async (context, services) => {
      const result = await services.ops.adoption(context.query.bound, {
        limit: context.query.limit,
        offset: context.query.offset,
      });
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'decideAdoption',
    method: 'post',
    path: '/adoption/decisions',
    scope: 'write:adoption',
    summary: 'Link an existing external object to a prisme entity',
    description:
      'Adopting binds; it never creates. A decision made through this endpoint is a human one by definition, and nothing above "certain" is ever applied automatically.',
    body: decideAdoptionBody,
    response: AdoptionEntryDto,
    handle: (context, services) =>
      services.ops.decideAdoption(
        {
          prismeId: context.body.prismeId,
          externalKind: context.body.externalKind,
          externalId: context.body.externalId,
          matchRule: context.body.matchRule,
          confidence: context.body.confidence,
        },
        context.identity,
        context.now,
      ),
  }),

  defineRoute({
    operationId: 'listConflicts',
    method: 'get',
    path: '/conflicts',
    scope: 'read:sync',
    summary: 'The conflict ledger',
    description:
      'A conflict is a change made in an external tool to a field prisme owns. A field conflicting repeatedly is a field whose ownership is wrong — the ledger is a design signal, not just a queue.',
    query: z.strictObject({
      ...pageQuery.shape,
      resolution: z.enum(['prisme_wins', 'external_wins', 'unresolved']).optional(),
    }),
    response: ConflictPageDto,
    handle: async (context, services) => {
      const result = await services.ops.conflicts(context.query.resolution, {
        limit: context.query.limit,
        offset: context.query.offset,
      });
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'resolveConflict',
    method: 'post',
    path: '/conflicts/:id/resolve',
    scope: 'write:sync',
    summary: 'Clear one entry in the conflict ledger',
    // A conflict id is the ledger's bigint, not a uuid: the row is an
    // observation prisme made, not an entity it created.
    params: z.strictObject({ id: z.string().regex(/^\d+$/, 'expected a conflict ledger id') }),
    body: resolveConflictBody,
    status: 200,
    response: ConflictDto,
    handle: (context, services) =>
      services.ops.resolveConflict(context.params.id, context.body.resolution),
  }),

  defineRoute({
    operationId: 'getSettings',
    method: 'get',
    path: '/settings',
    scope: 'admin:settings',
    summary: 'The configuration prisme is running under',
    description:
      'Read-only. Everything here is deployment configuration validated at boot — including the write freeze, which a human lifts by working through the migration sequence, not by calling an API.',
    query: noQuery,
    response: SettingsDto,
    handle: (_context, services) => Promise.resolve(services.ops.settings()),
  }),

  defineRoute({
    operationId: 'getSyncStatus',
    method: 'get',
    path: '/sync',
    scope: 'read:sync',
    summary: 'Reconciliation state: cursor, watermark, outstanding conflicts',
    query: noQuery,
    response: SyncStatusDto,
    handle: (_context, services) => services.ops.syncStatus(),
  }),

  defineRoute({
    operationId: 'triggerSync',
    method: 'post',
    path: '/sync',
    scope: 'write:sync',
    summary: 'Run a reconciler pass in process, behind the advisory lock',
    description:
      'Defaults to `plan`, which has no side effects and returns the diff. `ran: false` means another pass held the lock — skipped rather than queued.',
    body: triggerSyncBody,
    status: 200,
    response: SyncRunDto,
    handle: (context, services) => services.ops.runSync(context.body.mode, context.body.full),
  }),
];
