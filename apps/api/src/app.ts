import { Hono } from 'hono';
import type { Config } from '@prisme/config';
import type { Logger, Metrics } from '@prisme/observability';
import { withRunContext, newRunId } from '@prisme/observability';
import type { ReadinessReport } from '@prisme/db';
import { healthRoutes } from './health.js';
import { DENY_EVERYTHING, type Authorizer } from './http/authorize.js';
import { internalErrorBody } from './http/errors.js';
import { mountRoutes } from './http/mount.js';
import { API_BASE_PATH, createRoutes } from './routes/index.js';
import type { Services } from './services/index.js';

/**
 * The API application.
 *
 * W00 built the shell: request correlation, the operational endpoints and an
 * error handler that leaks nothing. W05 mounts the business routes under
 * `/api/v1`, all of them from one declared list, each declaring the scope it
 * requires.
 *
 * **The authorizer is a parameter with a refusing default.** W14 supplies the
 * mechanism — the assertion verifier, the token store, the origin check — and
 * until one is installed this application answers `401` to every business
 * route. That is the correct behaviour for a process holding read/write tokens
 * to somebody's entire planning workspace, and it is why the default is a real
 * decision rather than a stub that says yes for now.
 */

export interface AppDependencies {
  readonly config: Config;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly readiness: () => Promise<ReadinessReport>;
  readonly isShuttingDown: () => boolean;
  /**
   * Absent on an instance with no database — the operational endpoints still
   * answer, and `/api/v1` is simply not mounted. A half-wired API that returns
   * 500s is worse than one that returns 404s.
   */
  readonly services?: Services | undefined;
  /** Defaults to {@link DENY_EVERYTHING}. W14 replaces it. */
  readonly authorizer?: Authorizer | undefined;
  /** Injected so a test can pin the clock the domain is scored against. */
  readonly now?: (() => Date) | undefined;
}

/** Paths that must never be logged per-request or wrapped in a run context — probes are noise. */
const OPERATIONAL = new Set(['/healthz', '/readyz', '/metrics']);

export function createApp(dependencies: AppDependencies): Hono {
  const app = new Hono();

  // One run ID per request, readable by every log line without being passed down.
  app.use('*', async (c, next) => {
    if (OPERATIONAL.has(c.req.path)) return next();
    const runId = c.req.header('x-request-id') ?? newRunId();
    c.header('x-request-id', runId);
    return withRunContext({ runId, source: 'http' }, () => next());
  });

  app.onError((error, c) => {
    // The correlation ID is the only thing the caller gets. The detail goes to
    // the log, where the redacting serializer has already been applied.
    const runId = c.res.headers.get('x-request-id') ?? newRunId();
    dependencies.logger.error('unhandled request error', { error, path: c.req.path });
    return c.json(internalErrorBody(runId), 500);
  });

  app.route(
    '/',
    healthRoutes({
      service: 'prisme-api',
      readiness: dependencies.readiness,
      metrics: dependencies.metrics,
      isShuttingDown: dependencies.isShuttingDown,
    }),
  );

  if (dependencies.services !== undefined) {
    const v1 = new Hono();
    mountRoutes(v1, createRoutes(), {
      authorizer: dependencies.authorizer ?? DENY_EVERYTHING,
      deps: dependencies.services,
      logger: dependencies.logger,
      now: dependencies.now ?? (() => new Date()),
    });
    app.route(API_BASE_PATH, v1);
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
