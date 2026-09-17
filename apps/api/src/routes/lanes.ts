import { z } from 'zod';
import { calendarDate } from '../dto/common.js';
import { InitiativeDto } from '../dto/initiative.js';
import {
  AdherenceSeriesDto,
  createRitualBody,
  promoteTakeawayBody,
  recordAdherenceBody,
  RitualDto,
  RitualListDto,
  TakeawayPageDto,
  updateRitualBody,
} from '../dto/lanes.js';
import { defineRoute, idParam, noQuery, pageQuery, type ApiRoute } from './kit.js';

/**
 * Takeaways and rituals.
 *
 * A takeaway is mirrored from the document tool and never written back, so the
 * only write here is **promotion** — which creates an initiative and records
 * the link, leaving the takeaway itself untouched. Promoting a *principle* is
 * refused: a principle is not a candidate, and the backlog stays free of the
 * things you cannot finish.
 *
 * A ritual is measured by adherence over time rather than by completion,
 * because a habit task is never "done" — it either recurs forever or is closed
 * dishonestly. prisme owns that series outright; neither external tool provides
 * it.
 */
export const laneRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'listTakeaways',
    method: 'get',
    path: '/takeaways',
    scope: 'read:focus',
    summary: 'Mirrored takeaways, newest first',
    query: z.strictObject({
      ...pageQuery.shape,
      kind: z.enum(['principle', 'action']).optional(),
      promoted: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => (value === undefined ? undefined : value === 'true')),
    }),
    response: TakeawayPageDto,
    handle: async (context, services) => {
      const result = await services.lanes.takeaways(
        { kind: context.query.kind, promoted: context.query.promoted },
        { limit: context.query.limit, offset: context.query.offset },
      );
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'promoteTakeaway',
    method: 'post',
    path: '/takeaways/:id/promote',
    scope: 'write:takeaway',
    summary: 'Promote an action takeaway into an initiative',
    description:
      'Creates an initiative in the inbox and links it back. The takeaway’s text is not copied and the takeaway is not modified — the document tool owns it outright.',
    params: idParam,
    body: promoteTakeawayBody,
    response: InitiativeDto,
    handle: (context, services) =>
      services.lanes.promote(
        context.params.id,
        {
          title: context.body.title,
          areaKey: context.body.areaKey,
          value: context.body.value,
          timeCriticality: context.body.timeCriticality,
          risk: context.body.risk,
          size: context.body.size,
        },
        context.now,
      ),
  }),

  defineRoute({
    operationId: 'listRituals',
    method: 'get',
    path: '/rituals',
    scope: 'read:areas',
    summary: 'Rituals with their latest adherence',
    query: noQuery,
    response: RitualListDto,
    handle: (_context, services) => services.lanes.rituals(),
  }),

  defineRoute({
    operationId: 'createRitual',
    method: 'post',
    path: '/rituals',
    scope: 'write:ritual',
    summary: 'Define a ritual',
    body: createRitualBody,
    response: RitualDto,
    handle: (context, services) =>
      services.lanes.createRitual({
        name: context.body.name,
        areaKey: context.body.areaKey,
        cadence: context.body.cadence,
        targetAdherencePct: context.body.targetAdherencePct,
        externalPageId: context.body.externalPageId,
      }),
  }),

  defineRoute({
    operationId: 'updateRitual',
    method: 'patch',
    path: '/rituals/:id',
    scope: 'write:ritual',
    summary: 'Change a ritual’s name, cadence or target',
    params: idParam,
    body: updateRitualBody,
    response: RitualDto,
    handle: (context, services) => services.lanes.updateRitual(context.params.id, context.body),
  }),

  defineRoute({
    operationId: 'getRitualAdherence',
    method: 'get',
    path: '/rituals/:id/adherence',
    scope: 'read:kpi',
    summary: 'The adherence series for one ritual',
    description:
      'Adherence is null for a period that offered no opportunity, which is a different fact from missing every one of them.',
    params: idParam,
    query: z.strictObject({ from: calendarDate.optional(), to: calendarDate.optional() }),
    response: AdherenceSeriesDto,
    handle: (context, services) =>
      services.lanes.adherence(context.params.id, context.query.from, context.query.to),
  }),

  defineRoute({
    operationId: 'recordRitualAdherence',
    method: 'post',
    path: '/rituals/:id/adherence',
    scope: 'write:ritual',
    summary: 'Record one period’s opportunities and completions',
    params: idParam,
    body: recordAdherenceBody,
    status: 200,
    response: AdherenceSeriesDto,
    handle: (context, services) =>
      services.lanes.recordAdherence(context.params.id, {
        periodStart: context.body.periodStart,
        opportunities: context.body.opportunities,
        completions: context.body.completions,
      }),
  }),
];
