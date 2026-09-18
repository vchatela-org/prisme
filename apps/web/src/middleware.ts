import { NextResponse, type NextRequest } from 'next/server';
import { loadConfig } from '@prisme/config';
import {
  AssertionRejection,
  assertPolicyUsable,
  assertSameOrigin,
  originPolicyFor,
  OriginRejected,
  resolveKeySet,
  verifyAssertion,
  type AssertionPolicy,
} from '@prisme/api/auth/verify';

/**
 * The web tier's half of W14: verify, check the origin, and set the headers a
 * browser needs before it will refuse to execute anything.
 *
 * ### Where this file lives
 *
 * W14's brief names it `apps/web/middleware.ts`. Next.js looks for middleware
 * beside the application root, and this application uses a `src/` layout — so
 * with the file one level up, `next build` produced an empty middleware
 * manifest and every header below was silently absent. A CSP that is not sent
 * is worse than no CSP, because the build is green either way. Same tree, same
 * file, the one path the framework loads.
 *
 * ### Why the web tier verifies at all
 *
 * ADR-0021 rule 6. The API verifies every request regardless, so this is not
 * the gate — the gate is one hop further in, and an attacker who skips the web
 * tier entirely gains nothing. What this buys is that an unauthenticated
 * browser gets an honest answer here rather than a page shell that discovers,
 * one fetch later, that it has nothing to render. It uses the *same* verifier
 * the API uses (`@prisme/api/auth/verify`), because two implementations of a
 * signature check are two things to keep in agreement and one of them will lose.
 *
 * The reverse of the rule is the load-bearing half, and it lives in the API:
 * the web tier forwards what it verified, and the API **verifies it again**.
 * This tier holds no ambient authority over that one.
 *
 * ### The nonce, and why `unsafe-inline` is not here
 *
 * A strict CSP is the difference between an XSS being a bug and an XSS being a
 * total compromise of an application that holds read/write tokens to an entire
 * personal workspace. A nonce has to be **per request** and unguessable to mean
 * anything: a build-time constant is a value an attacker reads out of the page
 * they are already injecting into.
 *
 * `'strict-dynamic'` is what makes this survivable in practice — scripts the
 * nonced bootstrap loads inherit trust, so Next's chunk loading works without a
 * host allow-list. Note that a browser honouring `strict-dynamic` ignores
 * `'self'` in `script-src`; both are listed anyway for older engines, which is
 * the documented way to write this and not an oversight.
 *
 * ### CSRF, which is live despite there being no prisme cookie
 *
 * See `apps/api/src/auth/origin.ts` for the full reasoning. In short: the
 * gateway's session cookie is ambient in the browser, so a cross-site
 * state-changing request arrives authenticated whatever prisme does about
 * cookies of its own. The origin check is what refuses it, on both tiers.
 */

/** Node, not Edge: the configuration loader reads a rendered env file at boot. */
export const config = {
  runtime: 'nodejs',
  /*
   * Everything except the probes and the immutable build output.
   *
   * `/healthz` and `/readyz` are excluded deliberately — a probe that starts
   * failing because the identity provider is unreachable would restart a pod
   * that is working perfectly, turning an authentication outage into an
   * availability one. `_next/static` is content-addressed and carries no data.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|healthz|readyz).*)'],
};

const settings = loadConfig({ service: 'web' });

/**
 * No fallbacks, deliberately.
 *
 * An earlier version defaulted each field when `config.auth` was absent, and
 * that hid a real wiring bug behind a plausible error message: the variables
 * were set, the object was not being built for this service, and what the
 * process reported was "AUTH_ALLOWED_SUBJECTS is empty". A default that stands
 * in for missing configuration turns a five-second fix into an afternoon.
 */
function requireAuthConfig(): NonNullable<typeof settings.auth> {
  // A function rather than an `if` beside the `const`: narrowing a
  // module-scoped binding does not follow it into the closures below, and the
  // first version of this failed to type-check inside `keys()` for exactly that
  // reason.
  if (settings.auth === undefined) {
    throw new Error(
      'prisme-web: AUTH_* configuration is absent, so no assertion could be verified. ' +
        'Every variable is documented in docs/15-runtime.md §2',
    );
  }
  return settings.auth;
}

const auth = requireAuthConfig();

const assertionPolicy: AssertionPolicy = {
  issuer: auth.issuerUrl,
  audience: auth.audience,
  allowedAlgs: auth.allowedAlgs,
  allowedSubjects: auth.allowedSubjects,
  clockSkewSeconds: auth.clockSkewSeconds,
  maxLifetimeSeconds: auth.assertionMaxLifetimeSeconds,
};
assertPolicyUsable(assertionPolicy);

const ASSERTION_HEADER = auth.assertionHeader;
const ORIGIN_POLICY = originPolicyFor(settings.baseUrl);

/**
 * The key set, resolved once and reused.
 *
 * A promise rather than a value: middleware has no boot hook, and resolving on
 * every request would refetch discovery each time. The rejection is not cached
 * as a permanent failure — a `catch` clears it so a provider that was briefly
 * unreachable is retried rather than poisoning the process.
 */
let keySet: Promise<Awaited<ReturnType<typeof resolveKeySet>>> | undefined;

function keys(): Promise<Awaited<ReturnType<typeof resolveKeySet>>> {
  keySet ??= resolveKeySet({
    issuerUrl: assertionPolicy.issuer,
    jwksUrl: auth.jwksUrl,
    cacheTtlSeconds: auth.jwksCacheTtlSeconds,
  }).catch((error: unknown) => {
    keySet = undefined;
    throw error;
  });
  return keySet;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Headers that are the same on every response.
 *
 * `Strict-Transport-Security` is set here rather than left to the gateway so
 * that it is true of prisme wherever prisme is served — a security header that
 * depends on somebody else's configuration is one that is missing the first
 * time the deployment changes.
 */
function securityHeaders(nonce: string): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind ships a stylesheet; the nonce covers what Next inlines.
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The API only. A UI that can talk to anywhere is an exfiltration channel
    // that does not need an XSS to be useful.
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');

  return {
    'content-security-policy': csp,
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'x-content-type-options': 'nosniff',
    // Redundant beside `frame-ancestors 'none'`, and kept for engines that
    // implement one and not the other.
    'x-frame-options': 'DENY',
    // An initiative title must not travel to a third party in a Referer header.
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': [
      'accelerometer=()',
      'camera=()',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),
  };
}

function refuse(status: number, message: string, nonce: string): NextResponse {
  // No detail, and no echo of anything the request supplied
  // (docs/14-threat-model.md §5). The headers go on the refusal too: a 401 is
  // still a document a browser renders.
  return new NextResponse(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...securityHeaders(nonce) },
  });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  if (STATE_CHANGING.has(request.method)) {
    try {
      assertSameOrigin(
        {
          stateChanging: true,
          origin: request.headers.get('origin') ?? undefined,
          referer: request.headers.get('referer') ?? undefined,
        },
        ORIGIN_POLICY,
      );
    } catch (error) {
      if (error instanceof OriginRejected) return refuse(403, 'forbidden', nonce);
      throw error;
    }
  }

  const assertion = request.headers.get(ASSERTION_HEADER);
  if (assertion === null || assertion.trim() === '') {
    // Nothing to verify. The identity headers sitting beside it are not read —
    // not here and not in the API (ADR-0021 rule 1).
    return refuse(401, 'not authenticated', nonce);
  }

  try {
    await verifyAssertion(assertion, new Date(), {
      policy: assertionPolicy,
      keys: (await keys()).keys,
    });
  } catch (error) {
    if (error instanceof AssertionRejection) return refuse(401, 'not authenticated', nonce);
    // The key set could not be fetched. That is an availability problem rather
    // than a forged token, and answering 401 would send somebody looking at
    // permissions for an outage.
    return refuse(503, 'authentication is temporarily unavailable', nonce);
  }

  /*
   * Forwarded, not vouched for.
   *
   * The assertion goes upstream exactly as it arrived and the API verifies it
   * again. What is deliberately *not* sent is any header saying "the web tier
   * checked this" — such a header would be the trusted hop ADR-0021 refuses,
   * and the API ignores unknown headers anyway, so inventing one would only
   * create something for a future reader to start believing.
   */
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers } });
  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(name, value);
  }
  return response;
}
