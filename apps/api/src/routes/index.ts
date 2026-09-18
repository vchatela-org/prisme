import { createAuthRoutes, type AuthDeps } from '../auth/routes.js';
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

/**
 * `auth` is the mechanism W14 installs, and it is optional for one reason: the
 * routes are declared either way.
 *
 * An instance with no authentication configured must describe the *same* API as
 * one that has it — otherwise the OpenAPI document, the contract test and the
 * router disagree depending on deployment, which is the failure this whole file
 * exists to prevent. What the argument changes is whether a handler can run, not
 * whether the route exists. It never changes whether a scope is required.
 */
export function createRoutes(info: OpenApiInfo = API_INFO, auth?: AuthDeps): readonly ApiRoute[] {
  const routes: ApiRoute[] = [
    ...areaRoutes,
    ...projectRoutes,
    ...initiativeRoutes,
    ...viewRoutes,
    ...objectiveRoutes,
    ...laneRoutes,
    ...opsRoutes,
    ...createAuthRoutes(auth),
  ];

  // Built on first request, from the finished list — including the meta route
  // itself, which is why the closure reads `routes` rather than a copy.
  let cached: Record<string, unknown> | undefined;
  routes.push(...metaRoutes(() => (cached ??= buildOpenApiDocument(routes, info, API_BASE_PATH))));

  return routes;
}
