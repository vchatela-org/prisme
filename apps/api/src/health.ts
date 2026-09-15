import { Hono } from 'hono';
import type { ReadinessReport } from '@prisme/db';
import type { Metrics } from '@prisme/observability';

/**
 * The three operational endpoints from docs/15-runtime.md §1.
 *
 * The important line in this file is the one that is missing: `/healthz` calls
 * nothing. It does not read the database, it does not read the filesystem, and
 * it does not await anything. A liveness probe that fails when a dependency is
 * down restarts a healthy process, which turns a brief outage into a crash
 * loop. `apps/api/src/health.test.ts` asserts that, so a future "just check the
 * database here too" fails a test instead of a production incident.
 */

export interface HealthDependencies {
  readonly service: string;
  /** Readiness only. Never called by `/healthz`. */
  readonly readiness: () => Promise<ReadinessReport>;
  readonly metrics: Metrics;
  /** Flipped by the shutdown handler so a draining pod stops being routed to. */
  readonly isShuttingDown: () => boolean;
}

export function healthRoutes(dependencies: HealthDependencies): Hono {
  const app = new Hono();

  // Liveness. No dependencies, by contract.
  app.get('/healthz', (c) =>
    c.json({ status: 'ok', service: dependencies.service }, 200, {
      'cache-control': 'no-store',
    }),
  );

  // Readiness. Database reachable, schema version matches the binary.
  app.get('/readyz', async (c) => {
    if (dependencies.isShuttingDown()) {
      return c.json({ status: 'shutting-down' }, 503, { 'cache-control': 'no-store' });
    }
    const report = await dependencies.readiness();
    return c.json(report, report.state === 'ready' ? 200 : 503, { 'cache-control': 'no-store' });
  });

  app.get('/metrics', async (c) => {
    const body = await dependencies.metrics.registry.metrics();
    return c.text(body, 200, {
      'content-type': dependencies.metrics.registry.contentType,
      'cache-control': 'no-store',
    });
  });

  return app;
}
