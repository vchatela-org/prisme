import { z } from 'zod';
import { areaKey } from '../dto/common.js';
import { projectStructureBody } from '../dto/create.js';
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
    description:
      'The large-effort shape (ADR-0019). `taskProject` and `page` each say which of three things you mean — nothing, create one, or link one that already exists — and neither writes outward from here: `create` records an intent the converge pass drains, and `link` binds an object that already exists and creates nothing. Sections are planned whichever way the project itself is resolved, because linking a project says it exists, not that its sections do.',
    body: createProjectBody,
    response: ProjectDto,
    handle: async (context, services) => {
      const project = await services.catalogue.createProject({
        name: context.body.name,
        areaKey: context.body.areaKey,
        status: context.body.status,
        deadline: context.body.deadline,
        sections: context.body.sections,
      });

      await services.create.requestProjectStructure(
        project.id,
        project.name,
        project.sections,
        { taskProject: context.body.taskProject, page: context.body.page },
        context.now,
      );

      // Re-read: linking set `external_project_id` or `external_page_id` on
      // the row, and returning the pre-link copy would show a reader a project
      // that is not bound to the thing they just bound it to.
      return services.catalogue.getProject(project.id);
    },
  }),

  defineRoute({
    operationId: 'requestProjectStructure',
    method: 'post',
    path: '/projects/:id/structure',
    scope: 'write:project',
    summary: 'Ask for a project’s external structure, or bind one that exists',
    description:
      'The same decision as at creation, available afterwards — which is what makes a project created before its structure was decided, or one whose creation half-failed, resumable rather than stuck. Asking twice for the same object updates one ledger row rather than enqueueing a second creation.',
    params: idParam,
    body: projectStructureBody,
    status: 200,
    response: ProjectDto,
    handle: async (context, services) => {
      const project = await services.catalogue.getProject(context.params.id);
      await services.create.requestProjectStructure(
        project.id,
        project.name,
        project.sections,
        { taskProject: context.body.taskProject, page: context.body.page },
        context.now,
      );
      return services.catalogue.getProject(project.id);
    },
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
