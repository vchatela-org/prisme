import { z } from 'zod';
import {
  CaptureDto,
  CapturePageDto,
  createCaptureBody,
  CreationIntentDto,
  CreationIntentPageDto,
  promoteCaptureBody,
  SearchDto,
} from '../dto/create.js';
import { InitiativeDto } from '../dto/initiative.js';
import { defineRoute, idParam, pageQuery, type ApiRoute } from './kit.js';

/**
 * The creation flows (W15): capture, the ledger, and search before create.
 *
 * ## Nothing on this surface writes outward
 *
 * Every route here writes prisme rows and, where an external object is wanted,
 * a row in the creation ledger saying so. The converge pass in `apps/sync`
 * sends the commands, behind the advisory lock and behind the write freeze.
 * That is not a limitation of the endpoints — it is the only shape that
 * survives the fact that **no transaction spans two SaaS APIs**: a request
 * that half-created a project across three systems would have nowhere to
 * record the half that worked.
 *
 * So a creation request is one database transaction, it is fast, and what it
 * returns is what prisme now believes. The external half is *visible* as
 * pending rather than hidden behind a spinner that may be lying.
 *
 * ## Why capture has a scope of its own
 *
 * `write:capture` rather than `write:initiative`, because the two authorise
 * genuinely different things. A capture is unranked and unscored; it cannot
 * change what prisme says to work on. An agent that should be able to drop a
 * thought into the inbox in one call should not thereby be able to re-rank a
 * backlog, and deny-by-default with no wildcard is only meaningful if the
 * scopes are cut where the consequences differ (docs/14-threat-model.md §3).
 */
export const creationRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'listCaptures',
    method: 'get',
    path: '/captures',
    scope: 'read:focus',
    summary: 'Captures, most recent first',
    description:
      'A capture is a small thing that stays a task. `promoted=false` is the list of those that still are — which is most of them, and is the intended outcome rather than a backlog to work down.',
    query: z.strictObject({
      ...pageQuery.shape,
      promoted: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => (value === undefined ? undefined : value === 'true')),
    }),
    response: CapturePageDto,
    handle: async (context, services) => {
      const result = await services.create.listCaptures(context.query.promoted, {
        limit: context.query.limit,
        offset: context.query.offset,
      });
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'createCapture',
    method: 'post',
    path: '/captures',
    scope: 'write:capture',
    summary: 'Capture a small thing, decisions deferred',
    description:
      'It becomes a task in the area’s mapped location and **stays** a task: no estimates, no status, no score. Promoting it later is a separate request, and it reuses this task rather than making a second. Refused with `422` when the area is mapped nowhere, because there is then no honest place to put it.',
    body: createCaptureBody,
    status: 201,
    response: CaptureDto,
    handle: (context, services) =>
      services.create.capture({
        title: context.body.title,
        areaKey: context.body.areaKey,
        page: context.body.page,
      }),
  }),

  defineRoute({
    operationId: 'getCapture',
    method: 'get',
    path: '/captures/:id',
    scope: 'read:focus',
    summary: 'One capture',
    params: idParam,
    response: CaptureDto,
    handle: (context, services) => services.create.getCapture(context.params.id),
  }),

  defineRoute({
    operationId: 'promoteCapture',
    method: 'post',
    path: '/captures/:id/promote',
    scope: 'write:initiative',
    summary: 'This capture is really an initiative',
    description:
      'The new initiative is bound to the capture’s **existing** task as its anchor, so no second task appears — the planner emits a create only for an initiative with no anchor (ADR-0010, guard 2), and this one has one before it is ever planned. Refused with `409` when the capture has already been promoted, or when its task has not been created yet and there is therefore nothing to reuse.',
    params: idParam,
    body: promoteCaptureBody,
    // 200, not 201: no resource appears at a new URL. The initiative is new,
    // but the *task* — the thing this endpoint is careful about — already
    // existed and is being reused.
    status: 200,
    response: InitiativeDto,
    handle: async (context, services) => {
      const initiativeId = await services.create.promote(
        context.params.id,
        {
          title: context.body.title,
          areaKey: context.body.areaKey,
          projectId: context.body.projectId,
          value: context.body.value,
          timeCriticality: context.body.timeCriticality,
          risk: context.body.risk,
          size: context.body.size,
        },
        context.now,
      );
      return services.work.get(initiativeId, context.now);
    },
  }),

  defineRoute({
    operationId: 'listCreations',
    method: 'get',
    path: '/creations',
    scope: 'read:sync',
    summary: 'The creation ledger: what prisme intends to exist outward, and does not yet',
    description:
      'One row per external object a creation flow decided should exist. `pending` is waiting for the converge pass; `failed` carries the reason and can be retried. It is under the sync scope rather than a write one because reading what is outstanding must keep working while the kill switch is pulled — that is exactly when somebody wants to know.',
    query: z.strictObject({
      ...pageQuery.shape,
      state: z.enum(['pending', 'satisfied', 'failed']).optional(),
      entityId: z.uuid().optional(),
    }),
    response: CreationIntentPageDto,
    handle: async (context, services) => {
      const result = await services.create.intents(
        { state: context.query.state, entityId: context.query.entityId },
        { limit: context.query.limit, offset: context.query.offset },
      );
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'retryCreation',
    method: 'post',
    path: '/creations/:id/retry',
    scope: 'write:sync',
    summary: 'Queue a failed creation to be attempted again',
    description:
      'Returns it to `pending` with the same idempotency key it has always carried, which is what makes a retry of a write that in fact succeeded return the original object rather than making a second. The attempt counter is **not** reset: somebody retrying for the fifth time should be able to see that it is the fifth.',
    params: idParam,
    body: { name: 'RetryCreation', schema: z.strictObject({}), readOnly: {} },
    status: 200,
    response: CreationIntentDto,
    handle: (context, services) => services.create.retry(context.params.id),
  }),

  defineRoute({
    operationId: 'searchBeforeCreate',
    method: 'get',
    path: '/search',
    scope: 'read:backlog',
    summary: 'Does this already exist, in prisme or in a tool prisme has not adopted yet?',
    description:
      'Scope item 4 of the creation flows: before creating, look for a match and offer to link it instead. `existing` means prisme already holds it — open it. `adoptable` means an external object prisme does not hold — **adopt it**, which creates nothing (ADR-0010). `worthReading` is true only when a match clears the higher bar that includes the word-level agreement test, because interrupting somebody with a wrong suggestion teaches them to dismiss the next one.',
    query: z.strictObject({ q: z.string().min(1).max(200) }),
    response: SearchDto,
    handle: (context, services) => services.create.search(context.query.q),
  }),
];
