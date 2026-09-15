import { describe, expect, it, vi } from 'vitest';
import { createMetrics } from '@prisme/observability';
import type { ReadinessReport } from '@prisme/db';
import { healthRoutes } from './health.js';

function ready(): ReadinessReport {
  return {
    state: 'ready',
    database: 'reachable',
    schemaVersion: '0001',
    expectedSchemaVersion: '0001',
    checkedInMs: 1,
  };
}

function build(overrides: Partial<Parameters<typeof healthRoutes>[0]> = {}) {
  const readiness = vi.fn(() => Promise.resolve(ready()));
  const app = healthRoutes({
    service: 'prisme-api',
    readiness,
    metrics: createMetrics({ collectDefaults: false }),
    isShuttingDown: () => false,
    ...overrides,
  });
  return { app, readiness };
}

describe('/healthz', () => {
  it('answers 200 without any dependency', async () => {
    const { app } = build();
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'prisme-api' });
  });

  /**
   * The load-bearing test of this workstream.
   *
   * If someone later "improves" liveness by checking the database, this fails.
   * The alternative is a dependency outage becoming a crash loop, which is a
   * far more expensive thing to discover.
   */
  it('never touches the database', async () => {
    const readiness = vi.fn((): Promise<ReadinessReport> =>
      Promise.reject(new Error('/healthz must not consult the database')),
    );
    const { app } = build({ readiness });

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    expect(readiness).not.toHaveBeenCalled();
  });

  it('answers while the database is down', async () => {
    const readiness = vi.fn((): Promise<ReadinessReport> =>
      Promise.resolve({
        state: 'not-ready',
        database: 'unreachable',
        schemaVersion: null,
        expectedSchemaVersion: '0001',
        reason: 'database is not reachable',
        checkedInMs: 1,
      }),
    );
    const { app } = build({ readiness });
    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/readyz')).status).toBe(503);
  });
});

describe('/readyz', () => {
  it('is 200 only when the schema version matches', async () => {
    const { app, readiness } = build();
    const response = await app.request('/readyz');
    expect(response.status).toBe(200);
    expect(readiness).toHaveBeenCalledOnce();
  });

  it('is 503 on version skew', async () => {
    const { app } = build({
      readiness: () =>
        Promise.resolve({
          state: 'not-ready' as const,
          database: 'reachable' as const,
          schemaVersion: '0001',
          expectedSchemaVersion: '0002',
          reason: 'schema version does not match this image',
          checkedInMs: 1,
        }),
    });
    expect((await app.request('/readyz')).status).toBe(503);
  });

  it('fails immediately once the process is draining', async () => {
    const { app, readiness } = build({ isShuttingDown: () => true });
    const response = await app.request('/readyz');
    expect(response.status).toBe(503);
    expect(readiness).not.toHaveBeenCalled();
  });
});

describe('/metrics', () => {
  it('serves Prometheus exposition including every prisme metric', async () => {
    const { app } = build();
    const response = await app.request('/metrics');
    expect(response.status).toBe(200);
    const body = await response.text();
    for (const name of [
      'prisme_sync_last_success_timestamp',
      'prisme_sync_duration_seconds',
      'prisme_sync_actions_total',
      'prisme_sync_conflicts_total',
      'prisme_sync_drift_objects',
      'prisme_external_requests_total',
      'prisme_auth_failures_total',
    ]) {
      expect(body).toContain(name);
    }
  });
});
