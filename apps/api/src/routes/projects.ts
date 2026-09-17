import { z } from 'zod';
import { areaKey } from '../dto/common.js';
import {
  createProjectBody,
  ProjectDto,
  ProjectPageDto,
  updateProjectBody,
} from '../dto/initiative.js';
import { defineRoute, idParam, pageQuery, type ApiRoute } from './kit.js';

/**
 * Projects — the optional container for a multi-month effort.
 *
 * Most initiatives have no project, which is why this is a small surface.
 * Creating one here creates a prisme project with `origin = created_in_prisme`;
 * the structures in the external tools follow from the reconciler, and
 * *adopting* an existing project creates nothing at all and arrives through
 * W12 (ADR-0010).
 */
export const projectRoutes: readonly ApiRoute[] = [
  defineRoute({
    operationId: 'listProjects',
    method: 'get',
    path: '/projects',
    scope: 'read:backlog',
    summary: 'Projects, most recently created first',
    query: z.strictObject({ ...pageQuery.shape, areaKey: areaKey.optional() }),
    response: ProjectPageDto,
    handle: async (context, services) => {
      const result = await services.catalogue.listProjects(context.query.areaKey, {
        limit: context.query.limit,
        offset: context.query.offset,
      });
      return { ...result, limit: context.query.limit, offset: context.query.offset };
    },
  }),

  defineRoute({
    operationId: 'createProject',
    method: 'post',
    path: '/projects',
    scope: 'write:project',
    summary: 'Create a project',
    body: createProjectBody,
    response: ProjectDto,
    handle: (context, services) =>
      services.catalogue.createProject({
        name: context.body.name,
        areaKey: context.body.areaKey,
        status: context.body.status,
        deadline: context.body.deadline,
        sections: context.body.sections,
      }),
  }),

  defineRoute({
    operationId: 'getProject',
    method: 'get',
    path: '/projects/:id',
    scope: 'read:backlog',
    summary: 'One project',
    params: idParam,
    response: ProjectDto,
    handle: (context, services) => services.catalogue.getProject(context.params.id),
  }),

  defineRoute({
    operationId: 'updateProject',
    method: 'patch',
    path: '/projects/:id',
    scope: 'write:project',
    summary: 'Change a project’s name, area, status, deadline or sections',
    params: idParam,
    body: updateProjectBody,
    response: ProjectDto,
    handle: (context, services) =>
      services.catalogue.updateProject(context.params.id, context.body),
  }),
];
