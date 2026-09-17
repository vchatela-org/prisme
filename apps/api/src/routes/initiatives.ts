import { z } from 'zod';
import {
  createInitiativeBody,
  InitiativeDto,
  replaceDependenciesBody,
  ScoreHistoryDto,
  TaskListDto,
  transitionInitiativeBody,
  updateInitiativeBody,
} from '../dto/initiative.js';
import { toScoreDto } from '../services/convert.js';
import { defineRoute, idParam, noQuery, type ApiRoute } from './kit.js';

/**
 * Initiatives — the only scored unit.
 *
 * Three things have their own endpoint rather than being fields on a patch, and
 * each for the same reason: the *decision* is what matters, and a decision
 * folded into a general update is a decision nothing recorded.
 *
 *   - **Status** is a transition. It writes the event log, stamps `done_at`,
 *     and insists on a reason for a drop.
 *   - **Dependencies** are replaced as a set. A partial edit cannot be checked
 *     for a cycle, and the cycle check has to happen before the write.
 *   - **Re-scoring** appends a ranking to history with the method and version
 *     that produced it. Reading a list does not; a page view is not a decision.
 */
export const initiativeRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'createInitiative',
    method: 'post',
    path: '/initiatives',
    scope: 'write:initiative',
    summary: 'Create an initiative',
    description:
      'Phrase the title as a result — "fence replaced", not "work on fence". An activity has no completion condition, which is how something stays open for two years.',
    body: createInitiativeBody,
    response: InitiativeDto,
    handle: (context, services) =>
      services.work.create(
        {
          title: context.body.title,
          areaKey: context.body.areaKey,
          projectId: context.body.projectId,
          status: context.body.status,
          value: context.body.value,
          timeCriticality: context.body.timeCriticality,
          risk: context.body.risk,
          size: context.body.size,
          deadline: context.body.deadline,
          earliestStart: context.body.earliestStart,
          externalPageId: context.body.externalPageId,
          dependsOn: context.body.dependsOn,
        },
        context.now,
      ),
  }),

  defineRoute({
    operationId: 'rescoreInitiatives',
    method: 'post',
    path: '/initiatives/rescore',
    scope: 'write:initiative',
    summary: 'Compute the active ranking and append it to score history',
    description:
      'The weekly review’s *re-score what changed* step. Appends one row per initiative with the method and version that produced it, and writes an event only where the number actually moved (ADR-0006).',
    response: {
      name: 'RescoreResult',
      schema: z.object({ scored: z.int(), changed: z.int() }),
    },
    handle: (context, services) => services.work.rescore(context.identity, context.now),
  }),

  defineRoute({
    operationId: 'getInitiative',
    method: 'get',
    path: '/initiatives/:id',
    scope: 'read:backlog',
    summary: 'One initiative, with its current score, rollup and blockers',
    params: idParam,
    response: InitiativeDto,
    handle: (context, services) => services.work.get(context.params.id, context.now),
  }),

  defineRoute({
    operationId: 'updateInitiative',
    method: 'patch',
    path: '/initiatives/:id',
    scope: 'write:initiative',
    summary: 'Change an initiative’s title, area, estimates or dates',
    params: idParam,
    body: updateInitiativeBody,
    response: InitiativeDto,
    handle: (context, services) =>
      services.work.update(context.params.id, context.body, context.now),
  }),

  defineRoute({
    operationId: 'transitionInitiative',
    method: 'post',
    path: '/initiatives/:id/status',
    scope: 'write:initiative',
    summary: 'Move an initiative to another status',
    description:
      'Writes the event log with the actor and the before/after. `done` stamps the day it finished; `dropped` requires a reason, because an unexplained drop is indistinguishable from a deletion six months later.',
    params: idParam,
    body: transitionInitiativeBody,
    status: 200,
    response: InitiativeDto,
    handle: (context, services) =>
      services.work.transition(
        context.params.id,
        context.body.to,
        context.body.reason,
        context.identity,
        context.now,
      ),
  }),

  defineRoute({
    operationId: 'replaceInitiativeDependencies',
    method: 'put',
    path: '/initiatives/:id/dependencies',
    scope: 'write:initiative',
    summary: 'Replace the set of initiatives this one waits on',
    description:
      'Rejected with the cycle printed as a path — "a → b → c → a" is the fix, where "a cycle was detected" is a search.',
    params: idParam,
    body: replaceDependenciesBody,
    response: InitiativeDto,
    handle: (context, services) =>
      services.work.replaceDependencies(context.params.id, context.body.dependsOn, context.now),
  }),

  defineRoute({
    operationId: 'getInitiativeTasks',
    method: 'get',
    path: '/initiatives/:id/tasks',
    scope: 'read:tasks',
    summary: 'The mirrored anchor subtree, read-only',
    description:
      'Everything here belongs to the task tool. prisme counts this subtree and never copies it — mirroring is what leaves you maintaining two task lists.',
    params: idParam,
    query: noQuery,
    response: TaskListDto,
    handle: (context, services) => services.work.tasks(context.params.id),
  }),

  defineRoute({
    operationId: 'getInitiativeScores',
    method: 'get',
    path: '/initiatives/:id/scores',
    scope: 'read:backlog',
    summary: 'Score history, most recent first',
    description:
      'Append-only. Knowing an item ranks fourth today is much less useful than knowing it ranked first for six weeks and was never picked — which is a fact about you, not about the item.',
    params: idParam,
    query: z.strictObject({ limit: z.coerce.number().int().min(1).max(500).default(100) }),
    response: ScoreHistoryDto,
    handle: async (context, services) => {
      const history = await services.work.scoreHistory(context.params.id, context.query.limit);
      return { initiativeId: context.params.id, items: history.map(toScoreDto) };
    },
  }),
];
