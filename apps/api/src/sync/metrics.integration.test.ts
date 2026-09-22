import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '@prisme/config';
import { createDatabase } from '@prisme/db';
import { createLogger, createMetrics } from '@prisme/observability';
import { createPostgresStore as createReconcilerStore } from '@prisme/sync';
import { createApp } from '../app.js';
import { createSyncMetricsRefresher } from './metrics.js';
import {
  describeWithDatabase,
  openTestDatabase,
  testDatabaseUrl,
  type TestDatabase,
} from '../test-support/database.js';

/**
 * `/metrics` republishing what a reconciler pass recorded.
 *
 * This is the defect's own test. The reconciler runs as a CronJob pod — no
 * Service, no ServiceMonitor, alive for seconds — so Prometheus never scrapes
 * the process that knows what the pass did, and the two metrics
 * docs/15-runtime.md §5 specifies were both unobservable in a deployment:
 * `prisme_sync_last_success_timestamp` rendered as a zero that made the
 * staleness alert fire permanently, and `prisme_sync_drift_objects` as a zero
 * that made `min_over_time(...) > 0` unable to fire at all.
 *
 * It runs against a real PostgreSQL because that is the whole mechanism: the
 * pass writes a row and the API reads it back, and a fake on either side would
 * assert nothing about the thing that was broken.
 */

/** Only the operational endpoints are mounted here, and they read none of it. */
const TEST_CONFIG = { service: 'api', port: 3000, logLevel: 'fatal' } as unknown as Config;

function sampleOf(exposition: string, name: string): string | undefined {
  return exposition
    .split('\n')
    .find((line) => line === name || line.startsWith(`${name} `) || line.startsWith(`${name}{`));
}

describe.runIf(describeWithDatabase === 'run')('/metrics, republished from PostgreSQL', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate();
  });

  function build(client = database.client) {
    const metrics = createMetrics({ collectDefaults: false });
    const app = createApp({
      config: TEST_CONFIG,
      logger: createLogger({ service: 'prisme-api-test', level: 'fatal' }),
      metrics,
      readiness: () => Promise.resolve({ state: 'ready' } as never),
      isShuttingDown: () => false,
      refreshMetrics: createSyncMetricsRefresher({ client, metrics }),
    });

    return async function scrape(): Promise<string> {
      const response = await app.request('/metrics');
      expect(response.status).toBe(200);
      return response.text();
    };
  }

  it('publishes no sample for either gauge before any pass has run', async () => {
    const scrape = build();

    const body = await scrape();

    // Declared, so a dashboard and a recording rule referencing them are valid
    // from the first deployment...
    expect(body).toContain('# TYPE prisme_sync_drift_objects gauge');
    expect(body).toContain('# TYPE prisme_sync_last_success_timestamp gauge');
    // ...and carrying nothing, because nothing has measured anything. This is
    // the line that distinguishes the fix from the bug: a zero here is what
    // made one alert fire for ever and the other never fire.
    expect(sampleOf(body, 'prisme_sync_drift_objects')).toBeUndefined();
    expect(sampleOf(body, 'prisme_sync_last_success_timestamp')).toBeUndefined();
  });

  it('reflects a pass that succeeded, through the store the reconciler uses', async () => {
    const store = createReconcilerStore(database.client);
    const at = new Date('2026-09-22T09:15:00.000Z');

    await store.recordPassOutcome({ at, succeeded: true, drift: 3, full: true });

    const body = await build()();

    expect(sampleOf(body, 'prisme_sync_drift_objects')).toBe('prisme_sync_drift_objects 3');
    expect(sampleOf(body, 'prisme_sync_last_success_timestamp')).toBe(
      `prisme_sync_last_success_timestamp ${String(at.getTime() / 1000)}`,
    );
  });

  it('publishes a measured zero, which is not the same fact as no measurement', async () => {
    const store = createReconcilerStore(database.client);

    await store.recordPassOutcome({
      at: new Date('2026-09-22T09:15:00.000Z'),
      succeeded: true,
      drift: 0,
      full: true,
    });

    expect(sampleOf(await build()(), 'prisme_sync_drift_objects')).toBe(
      'prisme_sync_drift_objects 0',
    );
  });

  /**
   * The write freeze is the shipped default, so this is the state of every
   * deployment until a human lifts it (docs/13-migration.md §5 step 8).
   */
  it('reports drift without a success when the pass was refused', async () => {
    const store = createReconcilerStore(database.client);

    await store.recordPassOutcome({
      at: new Date('2026-09-22T09:15:00.000Z'),
      succeeded: false,
      drift: 2,
      full: false,
    });

    const body = await build()();

    expect(sampleOf(body, 'prisme_sync_drift_objects')).toBe('prisme_sync_drift_objects 2');
    expect(sampleOf(body, 'prisme_sync_last_success_timestamp')).toBeUndefined();
  });

  it('remembers the last success across a later refused pass', async () => {
    const store = createReconcilerStore(database.client);
    const success = new Date('2026-09-22T09:15:00.000Z');

    await store.recordPassOutcome({ at: success, succeeded: true, drift: 0, full: true });
    await store.recordPassOutcome({
      at: new Date('2026-09-22T09:30:00.000Z'),
      succeeded: false,
      drift: 5,
      full: false,
    });

    const body = await build()();

    // A refused pass must not erase the memory of the last good one: the
    // staleness alert is "older than two windows", and forgetting would read as
    // "the reconciler has never worked".
    expect(sampleOf(body, 'prisme_sync_last_success_timestamp')).toBe(
      `prisme_sync_last_success_timestamp ${String(success.getTime() / 1000)}`,
    );
    expect(sampleOf(body, 'prisme_sync_drift_objects')).toBe('prisme_sync_drift_objects 5');
  });

  /**
   * The other load-bearing property: **degrade, never fail**.
   *
   * A metrics endpoint that returns 500 when PostgreSQL is down blinds an
   * operator at exactly the moment they are looking at it — and the process
   * metrics, which are still true, go with it.
   */
  it('still serves the rest of the exposition when the database is down', async () => {
    const handle = createDatabase({
      connectionString: testDatabaseUrl() as string,
      maxConnections: 1,
      applicationName: 'prisme-test-down',
    });
    // Closed, so every query on it fails immediately — the same shape of
    // failure as an unreachable database, without waiting for a connect timeout.
    await handle.close();

    const body = await build(handle.client)();

    expect(body).toContain('prisme_sync_actions_total');
    expect(body).toContain('# TYPE prisme_sync_drift_objects gauge');
    expect(sampleOf(body, 'prisme_sync_drift_objects')).toBeUndefined();
  });

  it('holds the last known value rather than blanking it when a refresh fails', async () => {
    const store = createReconcilerStore(database.client);
    await store.recordPassOutcome({
      at: new Date('2026-09-22T09:15:00.000Z'),
      succeeded: true,
      drift: 4,
      full: true,
    });

    const metrics = createMetrics({ collectDefaults: false });
    const app = createApp({
      config: TEST_CONFIG,
      logger: createLogger({ service: 'prisme-api-test', level: 'fatal' }),
      metrics,
      readiness: () => Promise.resolve({ state: 'ready' } as never),
      isShuttingDown: () => false,
      refreshMetrics: createSyncMetricsRefresher({ client: database.client, metrics }),
    });

    expect(
      sampleOf(await (await app.request('/metrics')).text(), 'prisme_sync_drift_objects'),
    ).toBe('prisme_sync_drift_objects 4');

    // Now break the read the next scrape makes. Dropping the series here would
    // turn a database blip into a gap that reads as "the reconciler stopped",
    // which is a false alarm about the wrong component.
    const broken = createDatabase({
      connectionString: testDatabaseUrl() as string,
      maxConnections: 1,
      applicationName: 'prisme-test-down',
    });
    await broken.close();

    const degraded = createApp({
      config: TEST_CONFIG,
      logger: createLogger({ service: 'prisme-api-test', level: 'fatal' }),
      metrics,
      readiness: () => Promise.resolve({ state: 'ready' } as never),
      isShuttingDown: () => false,
      refreshMetrics: createSyncMetricsRefresher({ client: broken.client, metrics }),
    });

    expect(
      sampleOf(await (await degraded.request('/metrics')).text(), 'prisme_sync_drift_objects'),
    ).toBe('prisme_sync_drift_objects 4');
  });
});
