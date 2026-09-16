import { describe, expect, it } from 'vitest';
import { isConnectorError, type ConnectorFailure } from '../errors.js';
import type { ConnectorMetrics, ExternalRequestSample } from '../metrics.js';
import { createSequenceTransport } from '../testing/fixture-transport.js';
import { executeJson, type RequestOptions } from './request.js';
import type { HttpRequest, HttpResponse, Transport } from './transport.js';

/**
 * The failure policy from docs/16-sync.md §6, asserted one row at a time.
 *
 * Nothing here sleeps: `sleep` and `random` are parameters, so the tests assert
 * the *delays that would have been waited* rather than waiting them. A retry
 * suite that really backs off is a suite nobody runs.
 */

const REQUEST: HttpRequest = {
  method: 'GET',
  url: 'https://api.example.invalid/v1/things',
  headers: { authorization: 'Bearer recorded-fixture-token' },
};

function harness(transport: Transport) {
  const slept: number[] = [];
  const samples: ExternalRequestSample[] = [];
  const metrics: ConnectorMetrics = { recordRequest: (sample) => samples.push(sample) };

  const options: RequestOptions = {
    tool: 'task',
    operation: 'sync incremental',
    transport,
    retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000 },
    metrics,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    random: () => 1,
    now: () => new Date('2026-09-16T09:00:00.000Z'),
  };

  return { options, slept, samples };
}

const ok = (body: unknown): Partial<HttpResponse> => ({ status: 200, body: JSON.stringify(body) });

async function failureOf(promise: Promise<unknown>): Promise<ConnectorFailure> {
  try {
    await promise;
    expect.unreachable('the request should have failed');
  } catch (error) {
    if (!isConnectorError(error)) throw error;
    return error.failure;
  }
}

describe('a successful request', () => {
  it('returns the parsed body', async () => {
    const transport = createSequenceTransport([ok({ sync_token: 'sync-token-0001' })]);
    const { options } = harness(transport.transport);
    await expect(executeJson(REQUEST, options)).resolves.toEqual({ sync_token: 'sync-token-0001' });
  });

  it('fails on a body that is not JSON, rather than returning a string', async () => {
    const transport = createSequenceTransport([{ status: 200, body: '<html>maintenance</html>' }]);
    const { options } = harness(transport.transport);
    expect(await failureOf(executeJson(REQUEST, options))).toBe('invalid_shape');
  });
});

describe('an invalid token', () => {
  it('stops immediately, because retrying risks locking the integration out', async () => {
    const transport = createSequenceTransport([{ status: 401, body: '{}' }]);
    const { options, slept } = harness(transport.transport);

    expect(await failureOf(executeJson(REQUEST, options))).toBe('invalid_token');
    // The assertion that matters: one attempt, no waiting.
    expect(transport.requests).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('treats 403 the same way', async () => {
    const transport = createSequenceTransport([{ status: 403, body: '{}' }]);
    const { options } = harness(transport.transport);
    expect(await failureOf(executeJson(REQUEST, options))).toBe('invalid_token');
    expect(transport.requests).toHaveLength(1);
  });

  it('is not retryable, so a caller cannot decide to try again', async () => {
    const transport = createSequenceTransport([{ status: 401, body: '{}' }]);
    const { options } = harness(transport.transport);
    await expect(executeJson(REQUEST, options)).rejects.toMatchObject({ retryable: false });
  });
});

describe('rate limiting', () => {
  it('honours Retry-After in preference to its own backoff', async () => {
    const transport = createSequenceTransport([
      { status: 429, headers: { 'retry-after': '7' }, body: '{}' },
      ok({ sync_token: 'sync-token-0002' }),
    ]);
    const { options, slept } = harness(transport.transport);

    await expect(executeJson(REQUEST, options)).resolves.toEqual({
      sync_token: 'sync-token-0002',
    });
    expect(slept).toEqual([7000]);
  });

  it('falls back to backoff when the header is missing', async () => {
    const transport = createSequenceTransport([
      { status: 429, body: '{}' },
      ok({ sync_token: 'sync-token-0002' }),
    ]);
    const { options, slept } = harness(transport.transport);

    await executeJson(REQUEST, options);
    expect(slept).toEqual([100]);
  });

  it('gives up as rate limited once the attempts are spent', async () => {
    const transport = createSequenceTransport([{ status: 429, body: '{}' }]);
    const { options, slept } = harness(transport.transport);

    expect(await failureOf(executeJson(REQUEST, options))).toBe('rate_limited');
    expect(transport.requests).toHaveLength(3);
    expect(slept).toEqual([100, 200]);
  });
});

describe('server errors', () => {
  it('retries a 5xx and succeeds', async () => {
    const transport = createSequenceTransport([
      { status: 503, body: '{}' },
      { status: 500, body: '{}' },
      ok({ sync_token: 'sync-token-0003' }),
    ]);
    const { options, slept } = harness(transport.transport);

    await expect(executeJson(REQUEST, options)).resolves.toEqual({
      sync_token: 'sync-token-0003',
    });
    expect(slept).toEqual([100, 200]);
  });

  it('retries a 408, which is a timeout and not a verdict', async () => {
    const transport = createSequenceTransport([{ status: 408, body: '{}' }, ok({})]);
    const { options } = harness(transport.transport);
    await expect(executeJson(REQUEST, options)).resolves.toEqual({});
  });

  it('gives up as unavailable, and says the pass may be re-run', async () => {
    const transport = createSequenceTransport([{ status: 502, body: '{}' }]);
    const { options } = harness(transport.transport);

    expect(await failureOf(executeJson(REQUEST, options))).toBe('unavailable');
    await expect(executeJson(REQUEST, options)).rejects.toMatchObject({ retryable: true });
  });
});

describe('other client errors', () => {
  it('does not retry a 400 — the request is wrong, and it will still be wrong', async () => {
    const transport = createSequenceTransport([{ status: 400, body: '{}' }]);
    const { options } = harness(transport.transport);

    expect(await failureOf(executeJson(REQUEST, options))).toBe('refused');
    expect(transport.requests).toHaveLength(1);
  });

  it('does not retry a 404', async () => {
    const transport = createSequenceTransport([{ status: 404, body: '{}' }]);
    const { options } = harness(transport.transport);
    expect(await failureOf(executeJson(REQUEST, options))).toBe('refused');
  });
});

describe('a transport failure', () => {
  it('is retried, and reported without the URL it failed on', async () => {
    // No `status` makes the sequence transport reject, as a reset connection would.
    const transport = createSequenceTransport([{ body: 'unused' }]);
    const { options, slept } = harness(transport.transport);

    expect(await failureOf(executeJson(REQUEST, options))).toBe('transport');
    expect(transport.requests).toHaveLength(3);
    expect(slept).toEqual([100, 200]);
    await expect(executeJson(REQUEST, options)).rejects.toThrow(/did not complete/);

    // A transport error's own message quotes the URL, and the URL carries an
    // external ID. The cause is attached; the message stays clean.
    try {
      await executeJson(REQUEST, options);
      expect.unreachable('the request should have failed');
    } catch (error) {
      expect((error as Error).message).not.toContain('api.example.invalid');
    }
  });
});

describe('instrumentation', () => {
  it('records one sample per attempt, labelled by status', async () => {
    const transport = createSequenceTransport([
      { status: 503, body: '{}' },
      { status: 429, body: '{}' },
      ok({}),
    ]);
    const { options, samples } = harness(transport.transport);

    await executeJson(REQUEST, options);
    expect(samples.map((sample) => sample.status)).toEqual(['503', '429', '200']);
    expect(samples.map((sample) => sample.attempt)).toEqual([1, 2, 3]);
    expect(samples.every((sample) => sample.tool === 'task')).toBe(true);
  });

  it('labels a transport failure as an error rather than inventing a status', async () => {
    const transport = createSequenceTransport([{ body: 'unused' }]);
    const { options, samples } = harness(transport.transport);

    await failureOf(executeJson(REQUEST, options));
    expect(samples.map((sample) => sample.status)).toEqual(['error', 'error', 'error']);
  });
});
