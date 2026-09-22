import { NextResponse } from 'next/server';
import { oidcSettings } from '@/lib/assertion';
import { endSessionUrl, SESSION_COOKIE, STATE_COOKIE } from '@/lib/oidc';

/**
 * Log out — for real, and the distinction is the whole of this file.
 *
 * ### What ending the session means here
 *
 * ADR-0026 lists *"a logout that actually ends the session (clearing the cookie
 * is not ending a server-side session if you keep one)"* among the obligations
 * ADR-0021's absent session had avoided. prisme keeps **no server-side
 * session**, deliberately — the web tier holds no database credential
 * (docs/14-threat-model.md §2) and a process-local session map is a session
 * that vanishes when a pod restarts, which is the unpredictable-invalidation
 * failure ADR-0026 rejected a scheduled key re-assignment for. So there is no
 * row to delete and no store to invalidate, and what the cookie holds is a
 * credential the *provider* issued and the middleware verifies on every
 * request. Clearing it ends prisme's session completely.
 *
 * What clearing it does **not** end is the provider's own session, and that
 * difference is worth being honest about rather than papering over: if the
 * provider still holds one, the next visit walks through the login flow again
 * and comes back with a new token, without a prompt. `OIDC_END_SESSION_ENDPOINT`
 * is the setting that closes that gap, and it is optional because not every
 * provider publishes one — so the two answers are different on purpose:
 *
 *   - **configured**: send the browser to the provider to end its session too;
 *   - **not configured**: say so, in a sentence, rather than pretending.
 *
 * The second case gets a plain response and not a redirect to `/`. A redirect
 * would be a lie with a nice status code: the browser would land on the app,
 * find no session, start a login, and be signed back in before the user could
 * read anything. A page that says "signed out, and here is what is still
 * signed in" is the honest one, and there is nothing to render but text.
 *
 * ### Why `POST`
 *
 * Clearing a cookie is state-changing, so it is origin-checked like everything
 * else (ADR-0026: the session cookie makes the origin checks load-bearing). The
 * middleware runs that check before its gate, so a cross-site POST is refused
 * with a 403 and this handler is never reached. `GET` logout is the convention
 * most providers use for their own end-session endpoint, and it is exactly the
 * shape that lets any page on the internet log somebody out.
 *
 * It is deliberately reachable **without** a session: throwing away a broken
 * credential is the one thing that has to work while the credential is broken.
 */
export const dynamic = 'force-dynamic';

export function POST(): NextResponse {
  const endSession = endSessionUrl(oidcSettings());

  const response =
    endSession === undefined
      ? new NextResponse(
          'signed out. The prisme session has ended — the cookie is cleared and the token it held is ' +
            'discarded, and prisme keeps no server-side session to invalidate.\n\n' +
            'Your identity provider may still be holding its own session, in which case opening the ' +
            'application again will sign you back in without a prompt. Configure ' +
            'OIDC_END_SESSION_ENDPOINT to end that one too.\n',
          {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
          },
        )
      : NextResponse.redirect(endSession, 303);

  for (const name of [SESSION_COOKIE, STATE_COOKIE]) {
    response.cookies.set(name, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }

  return response;
}
