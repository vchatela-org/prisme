import { ConnectorError, type ExternalTool } from '../errors.js';
import { type ConnectorMetrics, noopMetrics } from '../metrics.js';
import { parseJsonOrThrow } from '../parse.js';
import { backoffDelayMs, DEFAULT_RETRY_POLICY, retryAfterMs, type RetryPolicy } from './backoff.js';
import type { HttpRequest, Transport } from './transport.js';

/**
 * One request, with the failure policy from docs/16-sync.md §6 applied to it.
 *
 * | Outcome | What happens |
 * |---|---|
 * | 2xx | Body parsed as JSON and returned |
 * | 401, 403 | **Stop immediately.** No retry, ever |
 * | 429 | Honour `Retry-After`, else back off; retry while attempts remain |
 * | 408, 5xx | Back off with jitter; retry while attempts remain |
 * | other 4xx | Fail. The request is wrong; sending it again will not fix it |
 * | transport error | Back off and retry — a reset connection is not a verdict |
 *
 * The invalid-token row is the one worth stating twice. Retrying a rejected
 * credential is how an integration gets locked out, and a lockout on asset A1
 * (docs/14-threat-model.md §1) takes a human with a browser to undo. The run
 * stops on the first 401 and says so.
 */

export interface RequestOptions {
  readonly tool: ExternalTool;
  /** prisme's name for what is happening. Appears in errors; never contains instance data. */
  readonly operation: string;
  readonly transport: Transport;
  readonly retry?: RetryPolicy | undefined;
  readonly metrics?: ConnectorMetrics | undefined;
  /** Injected so tests neither sleep nor flake. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly signal?: AbortSignal | undefined;
}

const RETRYABLE_STATUS = (status: number): boolean => status === 408 || status >= 500;

async function realSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function executeJson(request: HttpRequest, options: RequestOptions): Promise<unknown> {
  const policy = options.retry ?? DEFAULT_RETRY_POLICY;
  const metrics = options.metrics ?? noopMetrics;
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date());
  const { tool, operation } = options;
  const errorInit = { tool, operation };

  let lastError: ConnectorError | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const startedAt = now().getTime();
    let response;

    try {
      response = await options.transport(request, options.signal ?? AbortSignal.timeout(120_000));
    } catch (cause) {
      metrics.recordRequest({
        tool,
        status: 'error',
        durationSeconds: (now().getTime() - startedAt) / 1000,
        attempt,
      });
      // The cause is attached but not interpolated: a transport error message
      // can contain the full URL, and the URL contains an external ID.
      lastError = new ConnectorError('transport', 'the request did not complete', {
        ...errorInit,
        cause,
      });
      if (attempt < policy.maxAttempts) {
        await sleep(backoffDelayMs(attempt, policy, random));
        continue;
      }
      throw lastError;
    }

    metrics.recordRequest({
      tool,
      status: String(response.status),
      durationSeconds: (now().getTime() - startedAt) / 1000,
      attempt,
    });

    if (response.status >= 200 && response.status < 300) {
      return parseJsonOrThrow(response.body, { tool, operation, shape: 'response body' });
    }

    if (response.status === 401 || response.status === 403) {
      throw new ConnectorError(
        'invalid_token',
        'the credential was rejected; stopping rather than retrying, because repeated attempts with a bad credential risk locking the integration out',
        { ...errorInit, status: response.status },
      );
    }

    if (response.status === 429) {
      lastError = new ConnectorError('rate_limited', 'rate limited', {
        ...errorInit,
        status: response.status,
      });
      if (attempt >= policy.maxAttempts) throw lastError;
      const honoured = retryAfterMs(response.headers['retry-after'], now());
      await sleep(honoured ?? backoffDelayMs(attempt, policy, random));
      continue;
    }

    if (RETRYABLE_STATUS(response.status)) {
      lastError = new ConnectorError('unavailable', 'the tool returned a server error', {
        ...errorInit,
        status: response.status,
      });
      if (attempt >= policy.maxAttempts) throw lastError;
      await sleep(backoffDelayMs(attempt, policy, random));
      continue;
    }

    throw new ConnectorError(
      'refused',
      `the request was refused with status ${String(response.status)}; this is a client error and retrying it would not help`,
      { ...errorInit, status: response.status },
    );
  }

  /* c8 ignore next 2 -- unreachable: every path above either returns or throws */
  throw lastError ?? new ConnectorError('transport', 'no attempt was made', errorInit);
}
