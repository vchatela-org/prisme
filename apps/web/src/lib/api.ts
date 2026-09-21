import type { Config } from '@prisme/config';
import { headers } from 'next/headers';
import type { z } from 'zod';
import { classifyStatus, correlationIdOf, type ApiResult } from './api-result';
import { webRuntime } from './runtime';

/**
 * The one place this application talks to the API.
 *
 * Every screen is a server component that calls through here, so three rules
 * hold everywhere rather than at each call site.
 *
 * ## 1. The assertion is forwarded, never minted
 *
 * The middleware has already verified the caller's assertion, and it puts
 * nothing on the request saying so — ADR-0021 rule 6: the web tier is not a
 * trusted hop, and the API verifies the same assertion again. So what travels
 * upstream is the header exactly as the browser sent it, and this tier holds
 * no credential of its own. If the header is absent the call is made anyway and
 * the API answers `401`; inventing a nicer local failure would hide a
 * misconfigured gateway behind a sign-in prompt.
 *
 * This is also why there is no API token in `apps/web`'s configuration. A web
 * tier holding an agent token would be an ambient authority sitting in front of
 * an XSS (docs/14-threat-model.md boundary ②).
 *
 * ## 2. The answer is parsed before anything renders it
 *
 * `./contracts.ts` carries the schemas and the reasoning. A response that does
 * not parse is `unavailable` — a screen showing half a shape is worse than a
 * screen saying it could not read one.
 *
 * ## 3. Nothing from upstream reaches a message
 *
 * Failures carry a correlation id and a kind. The API's own message is not
 * displayed and not logged: it is the one channel by which an upstream detail
 * could reach a browser (docs/14-threat-model.md §5).
 *
 * ## 4. A state-changing call states where it came from
 *
 * The API runs W14's origin check on every state-changing request that arrives
 * on the **assertion** path, and refuses one with no `Origin` outright — a
 * missing header is a refusal on purpose, because treating its absence as
 * "probably not a browser" is a bypass with a bookmark on it
 * (`packages/auth/src/origin.ts`).
 *
 * This tier is on that path: it forwards the browser's assertion, so the API
 * sees a human principal and applies the check. Until W09 drove a write
 * end-to-end against a real API, nothing here sent an `Origin` at all, and
 * **every write from this application was answered 403** — the estimate and
 * status writes as much as the weight write that found it. A read was
 * unaffected, which is why it stayed invisible: the screens all worked.
 *
 * The value is this tier's own public origin, which is what the API's policy
 * is built from (`originPolicyFor(settings.baseUrl)` — both services are
 * configured with the same `PRISME_BASE_URL`). It is not copied from the
 * incoming request: an origin taken from a header is an origin an attacker
 * chooses, and the check would then be decorative.
 */

/** Matches `API_BASE_PATH` in `@prisme/api/client`, which the web cannot import. */
const API_BASE_PATH = '/api/v1';

/**
 * Long enough for the slowest screen, short enough that a hung API renders an
 * error state rather than a spinner nobody will out-wait.
 */
const REQUEST_TIMEOUT_MS = 8_000;

/** Configuration is read on the first request, not when this module is imported. */
function loaded(): ReturnType<typeof webRuntime> {
  return webRuntime();
}

function apiOrigin(config: Config): string {
  if (config.apiUrl === undefined || config.apiUrl === '') {
    // `PRISME_API_URL` is required for this service, so reaching here means the
    // boot check in `instrumentation.ts` did not run — worth a loud failure
    // rather than a fetch to a relative URL that resolves to this app.
    throw new Error('prisme-web: PRISME_API_URL is absent; see docs/15-runtime.md §2');
  }
  return config.apiUrl.replace(/\/$/, '');
}

function assertionHeader(config: Config): string {
  return config.auth?.assertionHeader ?? 'x-prisme-assertion';
}

/** The methods the API treats as state-changing, and so origin-checks. */
export function isStateChanging(method: ApiCall<unknown>['method']): boolean {
  return method !== undefined && method !== 'GET';
}

/**
 * This application's own public origin — scheme, host and port, no path.
 *
 * `PRISME_BASE_URL` may legitimately carry a path or a trailing slash; the
 * API compares exact origins, so it is normalised through `URL` rather than
 * string-trimmed.
 */
export function originOf(config: Config): string {
  if (config.baseUrl === '') {
    // Required for this service, so reaching here means the boot check in
    // `instrumentation.ts` did not run. Loud, like `apiOrigin` — the quiet
    // alternative is omitting the header, and that is a write path that
    // answers 403 forever with nothing saying why.
    throw new Error('prisme-web: PRISME_BASE_URL is absent; see docs/15-runtime.md §2');
  }
  return new URL(config.baseUrl).origin;
}

export interface ApiCall<T> {
  readonly path: string;
  readonly schema: z.ZodType<T>;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  readonly body?: unknown;
}

function urlFor(config: Config, path: string, query: ApiCall<unknown>['query']): string {
  const url = new URL(`${apiOrigin(config)}${API_BASE_PATH}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Call the API, parse what comes back, and return a result rather than throw.
 *
 * A thrown error in a server component is Next's error boundary, which is a
 * page that says nothing useful. Every failure a reader can act on differently
 * is a value here, and each screen renders the matching state.
 */
export async function apiFetch<T>(call: ApiCall<T>): Promise<ApiResult<T>> {
  const { config, logger } = loaded();
  const header = assertionHeader(config);

  const incoming = await headers();
  const assertion = incoming.get(header);

  const requestHeaders: Record<string, string> = { accept: 'application/json' };
  if (assertion !== null) requestHeaders[header] = assertion;
  if (call.body !== undefined) requestHeaders['content-type'] = 'application/json';

  // Keyed on the method rather than on the presence of a body: `DELETE` and a
  // bodyless `POST` are state-changing too, and the API decides what counts
  // the same way. A read deliberately sends nothing — the check is bound to
  // state changes, and a header on every request is a header nobody notices
  // has stopped being set.
  if (isStateChanging(call.method)) requestHeaders['origin'] = originOf(config);

  let response: Response;
  try {
    response = await fetch(urlFor(config, call.path, call.query), {
      method: call.method ?? 'GET',
      headers: requestHeaders,
      // Spread rather than `body: undefined`: with `exactOptionalPropertyTypes`
      // an explicit undefined is not the same as an absent property.
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      // Every one of these screens is personal, current state. A cached Focus
      // is a Focus that tells somebody to work on something they finished.
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // No `error` in the log line: a fetch failure message carries the URL, and
    // the URL carries the API's internal address.
    logger.warn('api request failed', { path: call.path, method: call.method ?? 'GET' });
    return { ok: false, kind: 'unavailable', correlationId: null };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const kind = classifyStatus(response.status);
    const correlationId = correlationIdOf(payload);
    logger.warn('api request refused', { path: call.path, status: response.status, kind });
    return { ok: false, kind, correlationId };
  }

  const parsed = call.schema.safeParse(payload);
  if (!parsed.success) {
    // The issues name paths, not values — a Zod issue's `message` can quote the
    // data it rejected, and that data is somebody's initiative titles.
    logger.error('api response did not match the contract', {
      path: call.path,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 10),
    });
    return { ok: false, kind: 'unavailable', correlationId: null };
  }

  return { ok: true, data: parsed.data };
}
