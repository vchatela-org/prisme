import { z } from 'zod';
import {
  areaKey,
  calendarDate,
  csvOf,
  entityId,
  initiativeStatus,
  pagination,
} from '../dto/common.js';
import { BacklogDto, FocusDto, InboxDto, KpiDto, TimelineDto } from '../dto/views.js';
import { defineRoute, noQuery, type ApiRoute } from './kit.js';

/**
 * The screens.
 *
 * Each of these answers one surface's whole question in one request. That is
 * the brief's instruction — design the endpoints around the screens — and the
 * failure it prevents is specific: a UI that has to make six requests to draw
 * one list grows its own aggregation logic to hide the latency, and that logic
 * is business logic in a second place.
 *
 * `/backlog` is the one with a real query surface, because it is the one screen
 * where a person is genuinely searching. Note that sorting by `score` sorts by
 * **rank** — the position in the ordering the active method produced — rather
 * than re-sorting the numbers here. Two orderings of the same data is how the
 * list somebody read stops being the list that chose their week.
 */
export const viewRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'getFocus',
    method: 'get',
    path: '/focus',
    scope: 'read:focus',
    summary: 'The now set: what to work on, and why each item is there',
    description:
      'In-flight work keeps its slot whatever it scores; free slots fill from the top of the ranking, skipping areas already at their cap. `deadlineAtRisk` comes from the schedule engine — prisme flags an infeasible deadline and never moves one.',
    query: noQuery,
    response: FocusDto,
    handle: (context, services) => services.work.focus(context.now),
  }),

  defineRoute({
    operationId: 'getInbox',
    method: 'get',
    path: '/inbox',
    scope: 'read:focus',
    summary: 'What arrived and has not been triaged',
    description:
      'Initiatives still in `inbox`, and action takeaways not yet promoted. A principle never appears here: it is not a backlog candidate.',
    query: noQuery,
    response: InboxDto,
    handle: (context, services) => services.work.inbox(context.now),
  }),

  defineRoute({
    operationId: 'getBacklog',
    method: 'get',
    path: '/backlog',
    scope: 'read:backlog',
    summary: 'The ranked backlog, filtered, sorted and paged',
    query: z.strictObject({
      ...pagination,
      areaKey: csvOf(areaKey, 'an area key'),
      status: csvOf(initiativeStatus, 'an initiative status'),
      projectId: entityId.optional(),
      hasDeadline: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => (value === undefined ? undefined : value === 'true')),
      q: z.string().min(1).max(200).optional(),
      sort: z.enum(['score', 'deadline', 'age', 'title', 'size']).default('score'),
      direction: z.enum(['asc', 'desc']).default('asc'),
    }),
    response: BacklogDto,
    handle: (context, services) =>
      services.work.backlog(
        {
          areaKeys: context.query.areaKey,
          statuses: context.query.status,
          projectId: context.query.projectId,
          hasDeadline: context.query.hasDeadline,
          search: context.query.q,
          sort: context.query.sort,
          direction: context.query.direction,
          page: { limit: context.query.limit, offset: context.query.offset },
        },
        context.now,
      ),
  }),

  defineRoute({
    operationId: 'getTimeline',
    method: 'get',
    path: '/timeline',
    scope: 'read:timeline',
    summary: 'The computed schedule, its dependency edges and its critical path',
    description:
      '`boundBy` says which constraint decided each date. A Gantt nobody can interrogate is a Gantt that gets overridden once and ignored afterwards.',
    query: noQuery,
    response: TimelineDto,
    handle: (context, services) => services.work.timeline(context.now),
  }),

  defineRoute({
    operationId: 'getKpi',
    method: 'get',
    path: '/kpi',
    scope: 'read:kpi',
    summary: 'Throughput, attributed minutes, Run hours, Signals volume, adherence, attainment',
    query: z.strictObject({
      from: calendarDate,
      to: calendarDate,
      bucket: z.enum(['week', 'month']).default('week'),
    }),
    response: KpiDto,
    handle: (context, services) =>
      services.measure.kpi(context.query.from, context.query.to, context.query.bucket),
  }),
];
