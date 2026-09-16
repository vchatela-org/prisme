import { ConnectorError, type ExternalTool } from '../errors.js';

/**
 * The seam between this package and the network.
 *
 * A deliberately tiny interface rather than `fetch` itself. Two reasons, and
 * the second is the one that matters:
 *
 *   1. a fake transport in a test is four lines, so no test needs a mock of the
 *      `Response` object;
 *   2. **no test can reach the network by accident.** Every client requires a
 *      transport; the only one that opens a socket is
 *      {@link createFetchTransport}, and a test that does not construct it
 *      cannot call an API however wrong it goes (W03 brief, *Definition of
 *      done*).
 */

export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  /**
   * Including `Authorization`. **Never log this object** — CLAUDE.md §4, and
   * asset A1 in docs/14-threat-model.md §1 is exactly what is in it.
   */
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | undefined;
}

export interface HttpResponse {
  readonly status: number;
  /** Lower-cased header names. Only the ones this package reads are guaranteed present. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export type Transport = (request: HttpRequest, signal: AbortSignal) => Promise<HttpResponse>;

export interface FetchTransportOptions {
  /** Injected so the adapter itself is testable without a network. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The one transport that really talks to an API.
 *
 * It adds a timeout, because a request that never returns holds the advisory
 * lock (docs/16-sync.md §6) and blocks every later pass — a hang is worse than
 * a failure, which at least gets retried.
 */
export function createFetchTransport(options: FetchTransportOptions = {}): Transport {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (request, signal) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await doFetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      ...(request.body === undefined ? {} : { body: request.body }),
      signal: AbortSignal.any([signal, timeout]),
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    return { status: response.status, headers, body: await response.text() };
  };
}

/**
 * A transport that refuses to do anything.
 *
 * The default wherever a client is constructed without one, so "forgot to pass
 * the transport" fails loudly at the first request instead of silently reaching
 * for a global.
 */
export function createRefusingTransport(tool: ExternalTool): Transport {
  return () =>
    Promise.reject(
      new ConnectorError('transport', 'no transport was configured for this client', {
        tool,
        operation: 'request',
      }),
    );
}
