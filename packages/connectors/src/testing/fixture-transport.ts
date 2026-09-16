import type { HttpRequest, HttpResponse, Transport } from '../http/transport.js';

/**
 * Transports built from recorded data, for tests and for a dry run against
 * nothing.
 *
 * This is the mechanism behind "no test may call a real API" (W03 brief,
 * *Definition of done*). A client needs a transport; these are the ones that
 * cannot reach a network however badly a test is written.
 */

export interface RecordedRoute {
  /** True when this route answers the request. Checked in order. */
  readonly matches: (request: HttpRequest) => boolean;
  /** The recorded response. A function so one route can serve a sequence. */
  readonly respond: (request: HttpRequest) => Partial<HttpResponse> & { readonly body: string };
}

export interface FixtureTransport {
  readonly transport: Transport;
  /** Every request made, in order. Assert on the URLs and the bodies, never on the headers. */
  readonly requests: readonly HttpRequest[];
}

export function createFixtureTransport(routes: readonly RecordedRoute[]): FixtureTransport {
  const requests: HttpRequest[] = [];

  const transport: Transport = (request) => {
    requests.push(request);
    const route = routes.find((candidate) => candidate.matches(request));
    if (route === undefined) {
      return Promise.resolve({
        status: 404,
        headers: {},
        body: JSON.stringify({ error: 'no recorded response for this request' }),
      });
    }
    const recorded = route.respond(request);
    return Promise.resolve({
      status: recorded.status ?? 200,
      headers: recorded.headers ?? {},
      body: recorded.body,
    });
  };

  return { transport, requests };
}

/** A transport that replays a fixed sequence, one response per attempt. Used for retry tests. */
export function createSequenceTransport(
  responses: readonly Partial<HttpResponse>[],
): FixtureTransport {
  const requests: HttpRequest[] = [];
  let index = 0;

  const transport: Transport = (request) => {
    requests.push(request);
    const recorded = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (recorded === undefined) {
      return Promise.reject(new Error('the sequence transport was given no responses'));
    }
    if (recorded.status === undefined) {
      // No status: the transport itself failed, which is a different path.
      return Promise.reject(new Error('simulated transport failure'));
    }
    return Promise.resolve({
      status: recorded.status,
      headers: recorded.headers ?? {},
      body: recorded.body ?? '{}',
    });
  };

  return { transport, requests };
}
