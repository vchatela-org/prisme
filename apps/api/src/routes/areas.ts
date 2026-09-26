import { z } from 'zod';
import {
  AreaDto,
  AreaListDto,
  AreaWeightsDto,
  BalanceDto,
  createAreaBody,
  putAreaWeightBody,
  replaceAreaMappingsBody,
  updateAreaBody,
} from '../dto/area.js';
import { year as yearSchema } from '../dto/common.js';
import { defineRoute, keyParam, noQuery, yearOr, yearQuery, type ApiRoute } from './kit.js';

/**
 * Areas, weights and the balance view.
 *
 * `/areas/weights` is registered before `/areas/{key}` on purpose. It is a
 * collection in its own right — **a weight always requires a year**, so asking
 * for weights is a different question from asking about one area, and a weight
 * endpoint hanging off an area would invite a caller to ask for "the" weight.
 */
export const areaRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'listAreas',
    method: 'get',
    path: '/areas',
    scope: 'read:areas',
    summary: 'Every area and lane, with its external mappings',
    query: noQuery,
    response: AreaListDto,
    handle: (_context, services) => services.catalogue.listAreas(),
  }),

  defineRoute({
    operationId: 'getAreaWeights',
    method: 'get',
    path: '/areas/weights',
    scope: 'read:areas',
    summary: 'The weights in force for a year, and whether they were decided for it',
    description:
      'Weights are year-scoped (ADR-0007). `stale` is true when the year asked for has no weights of its own and earlier ones were carried forward — the year gate. A surface that hides it has restored the silence the gate exists to remove.',
    query: yearQuery,
    response: AreaWeightsDto,
    handle: (context, services) =>
      services.catalogue.weights(yearOr(context.now, context.query.year)),
  }),

  defineRoute({
    operationId: 'createArea',
    method: 'post',
    path: '/areas',
    scope: 'admin:areas',
    summary: 'Create an area or a lane',
    body: createAreaBody,
    response: AreaDto,
    handle: (context, services) =>
      services.catalogue.createArea({
        key: context.body.key,
        name: context.body.name,
        kind: context.body.kind,
        active: context.body.active,
        externalPageId: context.body.externalPageId,
        runBudgetHoursPerWeek: context.body.runBudgetHoursPerWeek,
        colorSlot: context.body.colorSlot,
        mappings: context.body.mappings,
      }),
  }),

  defineRoute({
    operationId: 'getArea',
    method: 'get',
    path: '/areas/:key',
    scope: 'read:areas',
    summary: 'One area',
    params: keyParam,
    response: AreaDto,
    handle: (context, services) => services.catalogue.getArea(context.params.key),
  }),

  defineRoute({
    operationId: 'updateArea',
    method: 'patch',
    path: '/areas/:key',
    scope: 'admin:areas',
    summary: 'Rename, recolour or deactivate an area',
    description:
      'The key and the kind are immutable: renaming touches `name`, and turning an area into a lane would rewrite the meaning of every past capacity measurement. `colorSlot: null` returns the area to its configured or hashed colour.',
    params: keyParam,
    body: updateAreaBody,
    response: AreaDto,
    handle: (context, services) => services.catalogue.updateArea(context.params.key, context.body),
  }),

  defineRoute({
    operationId: 'replaceAreaMappings',
    method: 'put',
    path: '/areas/:key/mappings',
    scope: 'admin:areas',
    summary: 'Replace the external projects and sections that fold into this area',
    description:
      'Many-to-one: several external locations may map to one area, and that is how several disagreeing lists of "areas" fold into one key without restructuring anything. At most one mapping is `isHome` — where prisme creates new work for the area; with none, the most specific mapping is used.',
    params: keyParam,
    body: replaceAreaMappingsBody,
    response: AreaDto,
    handle: (context, services) =>
      services.catalogue.replaceMappings(context.params.key, context.body.mappings),
  }),

  defineRoute({
    operationId: 'putAreaWeight',
    method: 'put',
    path: '/areas/:key/weights/:year',
    scope: 'admin:areas',
    summary: 'Set one area’s weight for one year',
    description:
      'The yearly decision, and the only place a weight is writable. A weight is fixed for a whole calendar year: one you can adjust in the moment is one that will be adjusted to match whatever you already did.',
    params: z.strictObject({
      key: keyParam.shape.key,
      year: z.coerce.number().pipe(yearSchema),
    }),
    body: putAreaWeightBody,
    status: 200,
    response: AreaWeightsDto,
    handle: (context, services) =>
      services.catalogue.putWeight(
        context.params.key,
        context.params.year,
        context.body.weightPct,
        context.identity,
        context.now,
      ),
  }),

  defineRoute({
    operationId: 'getBalance',
    method: 'get',
    path: '/balance',
    scope: 'read:areas',
    summary: 'Declared versus observed capacity, per area',
    description:
      'What each area was allocated, what it actually received, and the balance factor between them. Run carries hours against its budget; Signals carries volume and no time at all. This measures attention routed through tasks, not hours lived.',
    query: z.strictObject({
      year: yearQuery.shape.year,
      weeks: z.coerce.number().int().min(1).max(52).optional(),
    }),
    response: BalanceDto,
    handle: (context, services) =>
      services.measure.balance(
        yearOr(context.now, context.query.year),
        context.query.weeks,
        context.now,
      ),
  }),
];
