import { buildOpenApiDocument, type OpenApiInfo } from '../http/openapi.js';
import { areaRoutes } from './areas.js';
import { initiativeRoutes } from './initiatives.js';
import type { ApiRoute } from './kit.js';
import { laneRoutes } from './lanes.js';
import { metaRoutes } from './meta.js';
import { objectiveRoutes } from './objectives.js';
import { opsRoutes } from './ops.js';
import { projectRoutes } from './projects.js';
import { viewRoutes } from './views.js';

/**
 * Every route, assembled once.
 *
 * **This list is the API.** The router mounts exactly this, the OpenAPI
 * document describes exactly this, and `routes.contract.test.ts` walks what the
 * application registered and fails if anything reachable is not here. A route
 * added straight onto the Hono app would be reachable, undescribed and
 * unscoped — so the contract test's job is to make that impossible to do
 * quietly.
 */

export const API_BASE_PATH = '/api/v1';

export const API_INFO: OpenApiInfo = {
  title: 'prisme',
  version: '1',
  description:
    'The decision layer between a document tool and a task tool. Every operation declares the scope it requires in `x-required-scope`; there is no ambient authority, including for the single user.',
};

export function createRoutes(info: OpenApiInfo = API_INFO): readonly ApiRoute[] {
  const routes: ApiRoute[] = [
    ...areaRoutes,
    ...projectRoutes,
    ...initiativeRoutes,
    ...viewRoutes,
    ...objectiveRoutes,
    ...laneRoutes,
    ...opsRoutes,
  ];

  // Built on first request, from the finished list — including the meta route
  // itself, which is why the closure reads `routes` rather than a copy.
  let cached: Record<string, unknown> | undefined;
  routes.push(...metaRoutes(() => (cached ??= buildOpenApiDocument(routes, info, API_BASE_PATH))));

  return routes;
}
