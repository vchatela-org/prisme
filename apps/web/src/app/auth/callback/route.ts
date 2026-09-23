import { NextResponse, type NextRequest } from 'next/server';
import { AssertionRejection, verifyAssertion } from '@prisme/auth';
import { assertionPolicy, keys, oidcSettings, webConfig } from '@/lib/assertion';
import {
  cookieValue,
  exchangeCode,
  OidcExchangeFailed,
  parseCallback,
  parseStateCookie,
  returnToPath,
  SESSION_COOKIE,
  STATE_COOKIE,
  sameSecret,
} from '@/lib/oidc';
import { webRuntime } from '@/lib/runtime';

/**
 * Finish a login: redeem the code, verify the token, issue the session.
 *
 * ### The order is the point
 *
 * 1. `state` is compared against the cookie this browser was given, in constant
 *    time, **before** the code is touched. That is what stops a code minted for
 *    somebody else's browser from being redeemed here.
 * 2. The code is exchanged with the PKCE verifier that never left this process.
 * 3. The ID token is **verified** — the same `verifyAssertion` over the same
 *    key set the middleware uses, against the same policy — and *only then*
 *    written into the session cookie.
 *
 * Step 3 is not belt-and-braces. Without it a token that does not verify would
 * be stored, refused one request later by the middleware, and the browser would
 * be bounced to the login route, where the provider — whose session is
 * perfectly healthy — would hand back the same unusable token. That is a
 * redirect loop with a login form inside it. Verifying here turns it into a
 * refusal with a reason in the log.
 *
 * ### Fixation, and why there is nothing here to fixate
 *
 * ADR-0026's consequences list *"fixation resistance on the callback"* among
 * the obligations ADR-0021 had avoided, and the strongest form of it is
 * structural: **no session identifier is ever issued, adopted or reused by this
 * application.** What goes into the cookie is the provider's ID token, minted
 * by the provider for this exchange and for nothing else. There is no value a
 * caller could present beforehand that would then become their session, so
 * there is no fixation, and the `state`/PKCE pairing above means a code from
 * another flow cannot be substituted for this one either.
 *
 * ### The cookie's attributes, and its lifetime
 *
 * `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix, path `/`, and
 * deliberately **no `Max-Age`** — it is a session cookie, dropped when the
 * browser closes. The bound that actually matters is not a cookie attribute:
 * the middleware verifies this token on every single request, so the session
 * cannot outlive the token's `exp`, and `exp - iat` is itself capped by
 * `AUTH_ASSERTION_MAX_LIFETIME`. There is no refresh path, so nothing extends
 * it: when the token expires the next navigation starts the flow again, which
 * is a redirect the provider usually answers without a prompt.
 *
 * `SameSite=Lax` rather than `Strict` for the same reason the state cookie uses
 * it — the callback is a cross-site top-level navigation — and it is
 * affordable because the origin check, not `SameSite`, is what refuses a
 * cross-site state change (ADR-0026: the session cookie makes those checks more
 * load-bearing, not less).
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { logger } = webRuntime();

  /*
   * Failures answer with a plain `401` and a sentence — never a redirect back
   * into the flow. Redirecting to `/auth/login` from here is the shape that
   * turns any systematic problem (a state cookie the browser will not store,
   * say) into an endless bounce, which is a great deal harder to diagnose than
   * a refusal.
   *
   * The reason goes to the log line and never to the browser: "state mismatch"
   * and "the token's audience is wrong" are different answers, and a caller who
   * can tell them apart can map the configuration by probing
   * (docs/14-threat-model.md §5).
   */
  const refuse = (reason: string, status = 401): NextResponse => {
    logger.warn('login callback refused', { reason });
    const response = new NextResponse('sign-in could not be completed\n', {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
    discardFlow(response);
    return response;
  };

  const callback = parseCallback(request.nextUrl.searchParams);
  const pending = parseStateCookie(cookieValue(request.headers.get('cookie'), STATE_COOKIE));

  if (callback.kind === 'error') return refuse(callback.error);
  if (pending === undefined) return refuse('no_pending_flow');
  if (!sameSecret(callback.state, pending.state)) return refuse('state_mismatch');

  let idToken: string;
  try {
    idToken = await exchangeCode({
      config: oidcSettings(),
      code: callback.code,
      verifier: pending.verifier,
    });
  } catch (error) {
    if (error instanceof OidcExchangeFailed) return refuse(`exchange_${error.reason}`);
    throw error;
  }

  try {
    await verifyAssertion(idToken, new Date(), {
      policy: assertionPolicy(),
      keys: (await keys()).keys,
    });
  } catch (error) {
    if (error instanceof AssertionRejection) {
      // `subject` here is the allow-list refusing a real, verified identity —
      // AUTH_ALLOWED_SUBJECTS — and `audience` is the misconfiguration the
      // configuration schema cross-checks for. Both are logged by reason only;
      // the subject itself is a real person's identifier and does not belong in
      // a log line (docs/17-privacy.md).
      return refuse(`id_token_${error.reason}`);
    }
    // The key set could not be fetched: an availability problem, not a forged
    // token, and an outage is not a 401.
    return refuse('key_set_unavailable', 503);
  }

  const response = NextResponse.redirect(
    new URL(returnToPath(pending.returnTo), webConfig().baseUrl),
    303,
  );
  response.cookies.set(SESSION_COOKIE, idToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  discardFlow(response);

  // No subject, no username, no email: the identity key is `sub` (ADR-0021
  // rule 4) and a `sub` is a real person's identifier, which the journal rule
  // and docs/17-privacy.md keep out of anything written down.
  logger.info('login accepted');
  return response;
}

/** One-shot, whatever happened: a login that failed must not be retryable. */
function discardFlow(response: NextResponse): void {
  response.cookies.set(STATE_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
