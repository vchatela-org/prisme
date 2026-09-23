import { NextResponse, type NextRequest } from 'next/server';
import { oidcSettings } from '@/lib/assertion';
import {
  authorizationUrl,
  createFlowSecrets,
  returnToPath,
  serializeStateCookie,
  STATE_COOKIE,
  STATE_TTL_SECONDS,
} from '@/lib/oidc';

/**
 * Start a login: redirect to the provider, carrying PKCE.
 *
 * A route handler rather than a page, because there is nothing to render. The
 * whole of a login is a 303 and a cookie.
 *
 * ### What is in the cookie, and what is deliberately not
 *
 * `state`, the PKCE `code_verifier`, and where the user was going — nothing
 * else, `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`, and it expires in ten
 * minutes. There is no client secret in this process to put in a cookie, and
 * none in the configuration to put anywhere else: the client is public because
 * the exchange is PKCE (ADR-0026 rule 4).
 *
 * `SameSite=Lax` and not `Strict`: the callback arrives as a top-level
 * navigation from the provider's origin, which is cross-site by definition, and
 * a `Strict` cookie would simply not be sent — turning every login into a
 * "state mismatch" that never reproduces for whoever set the cookie attribute.
 *
 * ### `return_to`
 *
 * Read from the query string and validated to a **path** before it is stored
 * (`./oidc.ts`, `returnToPath`). It is echoed back into a `Location` header two
 * requests later, so an unchecked value is an open redirect — a login page that
 * hands the freshly authenticated browser to whoever wrote the link.
 */
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): NextResponse {
  const flow = createFlowSecrets();
  const returnTo = returnToPath(request.nextUrl.searchParams.get('return_to'));

  const response = NextResponse.redirect(
    authorizationUrl(oidcSettings(), flow).toString(),
    // 303: the browser is being told to go and do something else, and the
    // method it used to get here is not part of that instruction.
    303,
  );

  response.cookies.set(
    STATE_COOKIE,
    serializeStateCookie({ state: flow.state, verifier: flow.verifier, returnTo }),
    {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: STATE_TTL_SECONDS,
    },
  );

  return response;
}
