import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createLogger, createMetrics } from '@prisme/observability';
import type { Config } from '@prisme/config';
import { createApp } from '../app.js';
import { DENY_EVERYTHING } from '../http/authorize.js';
import { mountRoutes } from '../http/mount.js';
import { isScope, SCOPE_NAMES } from '../http/scopes.js';
import type { Services } from '../services/index.js';
import { API_BASE_PATH, createRoutes } from './index.js';

/**
 * **The guard that keeps deny-by-default true as routes multiply.**
 *
 * The brief says to write this test first, and the reason is that the rule it
 * protects fails silently. A route added without a scope does not throw, does
 * not warn and does not look different in review — it simply works, for
 * everybody, forever. So the check is not "the registry has scopes" (it does,
 * the type demands it) but the stronger one: **everything the application
 * actually registered is in the registry**.
 *
 * That is why the test builds a real `Hono` app and reads `app.routes` back
 * rather than iterating the list it was handed. A route mounted straight onto
 * the app — the one way a scope could be skipped — is reachable and would be
 * absent from the registry, and that is exactly what this fails on.
 */

const routes = createRoutes();

const TEST_CONFIG = { service: 'api', port: 3000, logLevel: 'fatal' } as unknown as Config;

function mountedPaths(): { method: string; path: string }[] {
  const app = new Hono();
  mountRoutes(app, routes, {
    authorizer: DENY_EVERYTHING,
    deps: {} as Services,
    logger: createLogger({ service: 'test', level: 'fatal' }),
    now: () => new Date(),
  });

  return app.routes
    .filter((entry) => entry.method !== 'ALL')
    .map((entry) => ({ method: entry.method.toLowerCase(), path: entry.path }));
}

describe('every route declares a scope', () => {
  it('registers nothing the registry does not describe', () => {
    const declared = new Set(routes.map((route) => `${route.method} ${route.path}`));
    const mounted = mountedPaths().map((entry) => `${entry.method} ${entry.path}`);

    expect(mounted.length).toBeGreaterThan(0);
    for (const entry of mounted) {
      expect(declared, `${entry} is reachable but not in the route registry`).toContain(entry);
    }
  });

  it('gives every route a scope from the published vocabulary', () => {
    for (const route of routes) {
      expect(route.scope, `${route.operationId} has no scope`).toBeTruthy();
      expect(isScope(route.scope), `${route.operationId} names an unknown scope`).toBe(true);
    }
  });

  it('never grants a write through a read scope', () => {
    for (const route of routes) {
      if (route.method === 'get') continue;
      expect(
        route.scope.startsWith('read:'),
        `${route.operationId} changes state behind the read-only scope ${route.scope}`,
      ).toBe(false);
    }
  });

  it('uses every declared scope, and declares every scope it uses', () => {
    const used = new Set(routes.map((route) => route.scope));
    for (const scope of used) expect(SCOPE_NAMES).toContain(scope);

    // A scope nothing requires is a permission that can be granted and means
    // nothing, which is how a token ends up looking narrower than it is.
    const unused = SCOPE_NAMES.filter((scope) => !used.has(scope));
    expect(unused, `these scopes are declared but unreachable: ${unused.join(', ')}`).toEqual([]);
  });

  it('gives every operation a unique id and every path a leading slash', () => {
    const ids = routes.map((route) => route.operationId);
    expect(new Set(ids).size, 'two routes share an operationId').toBe(ids.length);
    for (const route of routes) expect(route.path.startsWith('/')).toBe(true);
  });
});

describe('an unconfigured instance serves nothing', () => {
  const app = createApp({
    config: TEST_CONFIG,
    logger: createLogger({ service: 'test', level: 'fatal' }),
    metrics: createMetrics({ collectDefaults: false }),
    readiness: () => Promise.resolve({ state: 'ready', checks: [] } as never),
    isShuttingDown: () => false,
    services: {} as Services,
    // No authorizer: the default is `DENY_EVERYTHING`, which is the behaviour
    // this describe block exists to pin. W14 replaces it; until then an
    // instance with no verifier answers nothing.
  });

  it('answers 401 on every business route, before any handler runs', async () => {
    for (const route of routes) {
      const path = `${API_BASE_PATH}${route.path.replace(/:[A-Za-z0-9_]+/g, 'x')}`;
      const response = await app.request(path, {
        method: route.method.toUpperCase(),
        headers: { 'content-type': 'application/json' },
        // Spread rather than `body: undefined`: under `exactOptionalPropertyTypes`
        // an explicit `undefined` is not the same as an absent field, and
        // `RequestInit['body']` does not admit it.
        ...(route.method === 'get' ? {} : { body: '{}' }),
      });

      expect(response.status, `${route.operationId} answered ${String(response.status)}`).toBe(401);
      const body = (await response.json()) as { error: string; correlationId: string };
      expect(body.error).toBe('unauthenticated');
      // Deps were an empty object: reaching a handler at all would have thrown.
      expect(body).not.toHaveProperty('stack');
    }
  });

  it('still answers its operational probes', async () => {
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
  });
});
