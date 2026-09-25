import type postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { createMetrics } from '@prisme/observability';
import { createSyncMetricsRefresher } from './metrics.js';

/**
 * The refresher's two contractual properties, tested without a database
 * because neither is about SQL:
 *
 *   1. it is **bounded** — a scrape must not hang on a database that accepted
 *      the connection and then stopped answering, which is the failure a
 *      connect timeout does not cover;
 *   2. it **never rejects**, so no caller can make `/metrics` fail by wiring it
 *      in.
 *
 * The round trip against real SQL is `metrics.integration.test.ts`.
 */

/** A client whose query never settles. The shape the refresher uses, and no more. */
function hangingClient(): postgres.Sql {
  return (() => new Promise<never>(() => undefined)) as unknown as postgres.Sql;
}

describe('the sync metrics refresher', () => {
  it('gives up on a database that never answers, without throwing', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    const refresh = createSyncMetricsRefresher({
      client: hangingClient(),
      metrics,
      timeoutMs: 10,
    });

    await expect(refresh()).resolves.toBeUndefined();
  });

  it('leaves the gauges alone when the read times out', async () => {
    const metrics = createMetrics({ collectDefaults: false });
    metrics.syncDriftObjects.set(7);
    metrics.syncDriftFullObjects.set(7);

    await createSyncMetricsRefresher({
      client: hangingClient(),
      metrics,
      timeoutMs: 10,
    })();

    const body = await metrics.registry.metrics();
    expect(body).toContain('prisme_sync_drift_objects 7');
    expect(body).toContain('prisme_sync_drift_full_objects 7');
  });
});
