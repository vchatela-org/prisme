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
  /**
   * Called on `/metrics` only, to republish what the reconciler recorded in
   * PostgreSQL (`apps/api/src/sync/metrics.ts`).
   *
   * **Never `/healthz`.** The liveness probe's contract is that it depends on
   * nothing, and this depends on the database. Absent on an instance with no
   * database, which then serves the process and registry metrics alone.
   */
  readonly refreshMetrics?: (() => Promise<void>) | undefined;
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
    /*
     * Republish the reconciler's gauges, and **degrade rather than fail**.
     *
     * The reconciler is a CronJob pod Prometheus never scrapes, so the only way
     * `prisme_sync_last_success_timestamp` and `prisme_sync_drift_objects` are
     * observable at all is this process reading what the pass recorded
     * (docs/15-runtime.md §5, ADR-0018).
     *
     * The refresher already bounds itself and swallows its own errors. The
     * guard here is the second half of the same promise, and it is not
     * redundant: a metrics endpoint that returns 500 when the database is down
     * blinds an operator at exactly the moment they are looking, and losing two
     * gauges is a far smaller loss than losing the heap, the event-loop lag and
     * every counter with them.
     */
    try {
      await dependencies.refreshMetrics?.();
    } catch {
      // Deliberately silent and deliberately detail-free: the refresher owns
      // the logging, and an error from the driver can carry a connection string.
    }

    const body = await dependencies.metrics.registry.metrics();
    return c.text(body, 200, {
      'content-type': dependencies.metrics.registry.contentType,
      'cache-control': 'no-store',
    });
  });

  return app;
}
