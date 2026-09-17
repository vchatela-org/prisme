import { z } from 'zod';
import { areaKey, objectiveStatus } from '../dto/common.js';
import {
  createKeyResultBody,
  createMeasurementBody,
  createObjectiveBody,
  KeyResultDto,
  MeasurementListDto,
  ObjectiveDto,
  ObjectivePageDto,
  updateKeyResultBody,
  updateObjectiveBody,
} from '../dto/okr.js';
import { defineRoute, idParam, noQuery, pageQuery, type ApiRoute } from './kit.js';

/**
 * Objectives and key results.
 *
 * Every key result is first-class rather than a bullet inside a document, and
 * `servedBy` is what connects an objective to the work that moves it — the link
 * the monthly review reads in both directions to find orphans.
 *
 * There is no endpoint that writes `progressComputed`, and there will not be
 * one. It is shown beside `progressSelf`, and the gap between them is worth more
 * than either number alone.
 */
export const objectiveRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'listObjectives',
    method: 'get',
    path: '/objectives',
    scope: 'read:objectives',
    summary: 'Objectives with their key results, most recent period first',
    query: z.strictObject({
      ...pageQuery.shape,
      period: z
        .string()
        .regex(/^\d{4}(-\d{2})?$/)
        .optional(),
      areaKey: areaKey.optional(),
      status: objectiveStatus.optional(),
    }),
    response: ObjectivePageDto,
    handle: async (context, services) => {
      const result = await services.objectives.list(
        {
          period: context.query.period,
          areaKey: context.query.areaKey,
          status: context.query.status,
        },
        { limit: context.query.limit, offset: context.query.offset },
      );
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'createObjective',
    method: 'post',
    path: '/objectives',
    scope: 'write:objective',
    summary: 'Author an objective',
    body: createObjectiveBody,
    response: ObjectiveDto,
    handle: (context, services) =>
      services.objectives.create({
        title: context.body.title,
        type: context.body.type,
        period: context.body.period,
        areaKey: context.body.areaKey,
        status: context.body.status,
        externalPageId: context.body.externalPageId,
      }),
  }),

  defineRoute({
    operationId: 'getObjective',
    method: 'get',
    path: '/objectives/:id',
    scope: 'read:objectives',
    summary: 'One objective with its key results',
    params: idParam,
    response: ObjectiveDto,
    handle: (context, services) => services.objectives.get(context.params.id),
  }),

  defineRoute({
    operationId: 'updateObjective',
    method: 'patch',
    path: '/objectives/:id',
    scope: 'write:objective',
    summary: 'Change an objective’s title, status or page link',
    description:
      'The period, type and area are fixed at authoring: an objective that moves between months is a different objective, and letting one move would make attainment history meaningless.',
    params: idParam,
    body: updateObjectiveBody,
    response: ObjectiveDto,
    handle: (context, services) => services.objectives.update(context.params.id, context.body),
  }),

  defineRoute({
    operationId: 'createKeyResult',
    method: 'post',
    path: '/objectives/:id/key-results',
    scope: 'write:objective',
    summary: 'Add a key result to an objective',
    params: idParam,
    body: createKeyResultBody,
    response: KeyResultDto,
    handle: (context, services) =>
      services.objectives.createKeyResult(context.params.id, {
        statement: context.body.statement,
        target: context.body.target,
        unit: context.body.unit,
        progressSelf: context.body.progressSelf,
        servedBy: context.body.servedBy,
      }),
  }),

  defineRoute({
    operationId: 'updateKeyResult',
    method: 'patch',
    path: '/key-results/:id',
    scope: 'write:objective',
    summary: 'Change a key result, including the self-assessed progress',
    description:
      '`progressSelf` is set by hand, by judgement, and it is the number that syncs outward. Automating it would destroy the signal the gap against `progressComputed` carries.',
    params: idParam,
    body: updateKeyResultBody,
    response: KeyResultDto,
    handle: (context, services) =>
      services.objectives.updateKeyResult(context.params.id, context.body),
  }),

  defineRoute({
    operationId: 'getKeyResultMeasurements',
    method: 'get',
    path: '/key-results/:id/measurements',
    scope: 'read:objectives',
    summary: 'The measurement series, oldest first',
    params: idParam,
    query: noQuery,
    response: MeasurementListDto,
    handle: (context, services) => services.objectives.measurements(context.params.id),
  }),

  defineRoute({
    operationId: 'addKeyResultMeasurement',
    method: 'post',
    path: '/key-results/:id/measurements',
    scope: 'write:objective',
    summary: 'Append a measurement',
    description:
      'Append-only, so a trend exists rather than a single current number. A measurement cannot be edited or removed.',
    params: idParam,
    body: createMeasurementBody,
    response: MeasurementListDto,
    handle: (context, services) =>
      services.objectives.addMeasurement(
        context.params.id,
        context.body.value,
        context.body.observedAt === undefined ? context.now : new Date(context.body.observedAt),
        context.body.note,
      ),
  }),
];
