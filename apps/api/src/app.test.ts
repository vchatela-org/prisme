import { describe, expect, it } from 'vitest';
import { loadConfig } from '@prisme/config';
import { createLogger, createMetrics } from '@prisme/observability';
import type { ReadinessReport } from '@prisme/db';
import { createApp } from './app.js';

/** Synthetic only. This repository is public — docs/17-privacy.md. */
const ENV = {
  DATABASE_URL: 'postgres://prisme_app:example@postgres:5432/prisme',
  PRISME_BASE_URL: 'https://prisme.example.com',
  AUTH_ISSUER_URL: 'https://idp.example.com/application/o/prisme/',
  AUTH_AUDIENCE: 'prisme-client-id',
  AUTH_ALLOWED_SUBJECTS: 'subject-one',
  TOKEN_PEPPER: 'example-pepper',
  DOCTOOL_API_TOKEN: 'example-doctool-token',
  TASKTOOL_API_TOKEN: 'example-tasktool-token',
};

function build() {
  const lines: string[] = [];
  const app = createApp({
    config: loadConfig({ env: ENV, service: 'api' }),
    logger: createLogger({ service: 'prisme-api', write: (line) => lines.push(line) }),
    metrics: createMetrics({ collectDefaults: false }),
    isShuttingDown: () => false,
    readiness: (): Promise<ReadinessReport> =>
      Promise.resolve({
        state: 'ready',
        database: 'reachable',
        schemaVersion: '0001',
        expectedSchemaVersion: '0001',
        checkedInMs: 1,
      }),
  });
  return { app, lines };
}

describe('createApp', () => {
  it('returns 404 as JSON rather than HTML', async () => {
    const { app } = build();
    const response = await app.request('/nope');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('echoes a caller-supplied correlation ID', async () => {
    const { app } = build();
    const response = await app.request('/nope', { headers: { 'x-request-id': 'abc-123' } });
    expect(response.headers.get('x-request-id')).toBe('abc-123');
  });

  it('does not correlate or log the probes', async () => {
    const { app, lines } = build();
    await app.request('/healthz');
    expect(lines).toEqual([]);
  });

  it('gives a failing route a correlation ID and nothing else', async () => {
    const { app } = build();
    app.get('/boom', () => {
      throw new Error('postgres://app:hunter2@db:5432/prisme refused the connection');
    });

    const response = await app.request('/boom');
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(Object.keys(body).sort()).toEqual(['correlationId', 'error']);
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('postgres');
  });

  it('redacts the connection string on its way into the log too', async () => {
    const { app, lines } = build();
    app.get('/boom', () => {
      throw new Error('postgres://app:hunter2@db:5432/prisme refused the connection');
    });
    await app.request('/boom');
    expect(lines.join('\n')).not.toContain('hunter2');
  });
});
