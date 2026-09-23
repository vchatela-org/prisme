import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOrigin, originPolicyFor, OriginRejected } from '@prisme/auth';
import { assertionPolicy, authSettings, keys, sessionToken, webConfig } from './lib/assertion';
import { gate, type GateOutcome } from './lib/auth-gate';
import { SESSION_COOKIE, withoutCookie } from './lib/oidc';

/**
 * The web tier's half of W14, plus the login flow ADR-0026 put in front of it.
 *
 * ### What changed, and what deliberately did not
 *
 * ADR-0021 had this tier verify a **forward-auth assertion** the proxy injected
 * on the way in. ADR-0026 kept every part of that and moved one thing: the
 * token is now obtained here, by an authorization-code flow the browser drives
 * against the provider (`/auth/login` → provider → `/auth/callback`), and the
 * **session cookie** holds it. So the middleware reads the ID token out of the
 * cookie instead of out of a header, and everything after that is the same code
 * it always was: `verifyAssertion` from `@prisme/auth`, over a key set resolved
 * from configuration, against a fixed asymmetric algorithm allow-list.
 *
 * **The assertion header is no longer read on the way in.** That is ADR-0026
 * rule 3 — *"the assertion header disappears from the request path"* — and it
 * has to disappear rather than merely stop being required. A header path that
 * is still honoured is a second way to be authenticated, and it is the one an
 * attacker inside the perimeter would prefer: the application namespace has no
 * default-deny policy, so anything that can reach this pod could otherwise
 * present its own token. The header survives in the other direction only, where
 * this tier sets it for the API to verify (ADR-0026 rule 5).
 *
 * ### Why the web tier verifies at all
 *
 * The API verifies every request regardless, so this is not the gate — the gate
 * is one hop further in, and an attacker who skips the web tier entirely gains
 * nothing. What this buys is that an unauthenticated browser gets an honest
 * answer here rather than a page shell that discovers, one fetch later, that it
 * has nothing to render. It uses the *same* verifier the API uses
 * (`@prisme/auth`), because two implementations of a signature check are two
 * things to keep in agreement and one of them will lose — and it is a package
 * rather than an import from `apps/api` so that verifying costs this tier no
 * database driver it has no business holding.
 *
 * The reverse of the rule is the load-bearing half, and it lives in the API:
 * the web tier forwards what it verified, and the API **verifies it again**.
 * This tier holds no ambient authority over that one.
 *
 * ### Where the file lives
 *
 * W14's brief names it `apps/web/middleware.ts`. Next.js looks for middleware
 * beside the application root, and this application uses a `src/` layout — so
 * with the file one level up, `next build` produced an empty middleware
 * manifest and every header below was silently absent. A CSP that is not sent
 * is worse than no CSP, because the build is green either way. Same tree, same
 * file, the one path the framework loads.
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
 * ### CSRF, which a session cookie makes more load-bearing rather than less
 *
 * See `apps/api/src/auth/origin.ts` for the full reasoning. In short: a cookie
 * is ambient in the browser, so a cross-site state-changing request arrives
 * authenticated whatever prisme does about cookies of its own. Under ADR-0021
 * that was the *gateway's* cookie and the point was that the absence of a
 * prisme one bought nothing; prisme now issues the cookie itself, and
 * ADR-0026 says the consequence plainly — the origin checks stop being
 * belt-and-braces and become the control. They run here, on every
 * state-changing method, including on the `/auth/*` routes below the gate.
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
    // The login flow leaves this origin exactly twice — to the provider's
    // authorization endpoint and, on logout, to its end-session endpoint — and
    // `form-action` is what stops an injected form from posting a callback
    // somewhere else. `'self'` alone is still the rule; the flow is a
    // *navigation* (`window.location`/302), and navigations are not governed by
    // `form-action`, so nothing here needs widening for OIDC.
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

/**
 * The login flow, for a browser that has nothing to present.
 *
 * Built against `PRISME_BASE_URL` rather than against the request's own host: a
 * redirect target taken from a header is a redirect target an attacker chooses,
 * and every other URL this tier constructs comes from configuration for the
 * same reason. The two agree by construction — the configuration schema
 * requires the redirect URI's origin to equal the base URL's.
 */
function redirectTo(location: string, nonce: string): NextResponse {
  // 303 explicitly. `NextResponse.redirect` defaults to 307, which preserves
  // the method — indistinguishable for the GET navigations this is reached
  // with, and a trap for whoever first reaches it with something else.
  const response = NextResponse.redirect(new URL(location, webConfig().baseUrl), 303);
  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(name, value);
  }
  return response;
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
        originPolicyFor(webConfig().baseUrl),
      );
    } catch (error) {
      if (error instanceof OriginRejected) return refuse(403, 'forbidden', nonce);
      throw error;
    }
  }

  const outcome: GateOutcome = await gate(
    {
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      method: request.method,
      accept: request.headers.get('accept') ?? undefined,
      sessionToken: sessionToken(request.headers.get('cookie')),
    },
    { policy: assertionPolicy(), keySource: async () => (await keys()).keys },
  );

  if (outcome.kind === 'public') return passThrough(request, nonce, undefined);
  if (outcome.kind === 'redirect') return redirectTo(outcome.location, nonce);
  if (outcome.kind === 'refused') return refuse(outcome.status, outcome.message, nonce);

  /*
   * Forwarded, not vouched for.
   *
   * The ID token goes upstream in the assertion header and the API verifies it
   * again. What is deliberately *not* sent is any header saying "the web tier
   * checked this" — such a header would be the trusted hop ADR-0021 refuses,
   * and the API ignores unknown headers anyway, so inventing one would only
   * create something for a future reader to start believing.
   *
   * The session cookie itself is removed from the forwarded request. It is a
   * browser credential for this origin, the API reads no cookie at all, and
   * sending it would put the same token on the wire twice in a header nothing
   * consumes — which is how a header nothing consumes acquires a consumer.
   */
  return passThrough(request, nonce, outcome.token);
}

function passThrough(request: NextRequest, nonce: string, token: string | undefined): NextResponse {
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);

  if (token !== undefined) {
    headers.set(authSettings().assertionHeader, token);
    const cookie = withoutCookie(headers.get('cookie'), SESSION_COOKIE);
    if (cookie === undefined) headers.delete('cookie');
    else headers.set('cookie', cookie);
  }

  const response = NextResponse.next({ request: { headers } });
  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(name, value);
  }
  return response;
}
