import { Hono } from 'hono';
import type { Config } from '@prisme/config';
import type { Logger, Metrics } from '@prisme/observability';
import { withRunContext, newRunId } from '@prisme/observability';
import type { ReadinessReport } from '@prisme/db';
import { healthRoutes } from './health.js';

/**
 * The API application.
 *
 * W00 builds the shell: request correlation, the operational endpoints and an
 * error handler that leaks nothing. Business routes belong to W05, MCP tools to
 * W06 and authentication to W14 — none of them are stubbed here, because a stub
 * of an authorization decision is exactly the kind of thing that survives to
 * production.
 */

export interface AppDependencies {
  readonly config: Config;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly readiness: () => Promise<ReadinessReport>;
  readonly isShuttingDown: () => boolean;
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
    return c.json({ error: 'internal_error', correlationId: runId }, 500);
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

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
