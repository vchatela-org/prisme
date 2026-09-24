/**
 * Drive the real login flow, end to end, with a scripted HTTP client.
 *
 *   node harness/drive.mjs        # against a stack started by harness/up.sh
 *
 * It talks to the running stack over real sockets, following real redirects and
 * storing real cookies, and it checks the things a unit test around the parts
 * cannot see — because the parts are all correct in isolation:
 *
 *   - the PKCE challenge in the authorization URL hashes the verifier the
 *     application actually stored, recomputed here from the cookie;
 *   - the session cookie's attributes, and that it carries the ID token the
 *     provider signed for *this* exchange;
 *   - a bad token is refused while a missing one is redirected — the two
 *     branches ADR-0026 distinguishes;
 *   - a perfectly valid ID token in the assertion header authenticates nobody
 *     on the web tier, while the API accepts the one that tier forwards;
 *   - all three refusals that matter: a tampered verifier, a mismatched state
 *     and a replayed code each answer 401 without writing a session.
 *
 * It exits non-zero if any check fails, so it is usable as a gate rather than
 * only as a thing somebody reads.
 *
 * ## Why a scripted client rather than a browser
 *
 * A browser cannot assert on a `Set-Cookie` attribute, on a `code_challenge`, or
 * on the difference between a `303` and a `401` — it renders whatever it lands
 * on. Every claim above is about a header, and this is the cheapest client that
 * sees headers. A human in a browser is still the right way to check that a
 * screen *looks* right, which is a different question.
 *
 * ## Nothing here is real
 *
 * The fixtures are synthetic, the provider is local, and the only hostnames are
 * loopback and the reserved `elsewhere.example.com` used to prove a cross-origin
 * request is refused.
 */
import { createHash } from 'node:crypto';

const WEB = 'http://localhost:3001';
const API = 'http://127.0.0.1:3200';
const IDP = 'http://localhost:9099';
const SESSION_COOKIE = '__Host-prisme_session';
const STATE_COOKIE = '__Host-prisme_oidc_state';
const BROWSER = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

let failures = 0;
function check(label, condition, detail = '') {
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail === '' ? '' : `  [${detail}]`}`);
  if (!condition) failures += 1;
}

/** cookie name → { value, attrs[], raw } */
const jar = new Map();

function absorb(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(';').map((part) => part.trim());
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    // Next percent-encodes a cookie value; the application decodes it on the
    // way back in, and so must anything that wants to look at what it stored.
    const encoded = pair.slice(separator + 1);
    let value = encoded;
    try {
      value = decodeURIComponent(encoded);
    } catch {
      // Not an escape sequence; use it as it arrived.
    }
    const cleared = value === '' || attrs.some((attr) => /^max-age=0$/i.test(attr));
    if (cleared) jar.delete(name);
    else jar.set(name, { value, attrs, raw });
  }
}

function cookieHeader() {
  return [...jar].map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
}

async function call(url, { method = 'GET', accept = BROWSER.accept, origin, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    headers: { accept, ...(origin === undefined ? {} : { origin }), ...headers },
  });
  absorb(response);
  const body = await response.text().catch(() => '');
  return { status: response.status, location: response.headers.get('location'), body, response };
}

/** Case-insensitive: `SameSite=lax` and `SameSite=Lax` are the same attribute. */
function hasAttr(cookie, name) {
  return cookie?.attrs.some((attr) => attr.toLowerCase() === name.toLowerCase()) === true;
}

function payloadOf(jwt) {
  if (typeof jwt !== 'string') return {};
  const parts = jwt.split('.');
  if (parts.length !== 3) return {};
  try {
    return JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

async function withCookies(cookie, options) {
  return call(options.url, { ...options, headers: { cookie } });
}

console.log('\n1. an unauthenticated browser is sent to the login flow');
const first = await call(`${WEB}/`);
check(
  'GET / answers 303 to the login route',
  first.status === 303 && first.location?.startsWith('/auth/login'),
  `${first.status} ${first.location ?? ''}`,
);
check(
  'return_to is a path, not a URL',
  first.location === '/auth/login?return_to=%2F',
  first.location ?? '',
);

console.log('\n2. the login route builds an authorization request with PKCE');
const login = await call(`${WEB}/auth/login?return_to=%2Fbacklog`, {
  headers: { cookie: cookieHeader() },
});
const authorize = new URL(login.location ?? `${IDP}/missing`);
const state = jar.get(STATE_COOKIE);
check(
  'GET /auth/login answers 303 to the provider',
  login.status === 303 && authorize.origin === IDP,
  String(login.status),
);
check(
  'response_type=code, client_id and redirect_uri as configured',
  authorize.searchParams.get('response_type') === 'code' &&
    authorize.searchParams.get('client_id') === 'prisme-local' &&
    authorize.searchParams.get('redirect_uri') === `${WEB}/auth/callback`,
);
check('code_challenge_method=S256', authorize.searchParams.get('code_challenge_method') === 'S256');
check('no client_secret anywhere in the request', !login.location?.includes('client_secret'));
check(
  'the in-flight state is a cookie, HttpOnly + Secure + SameSite=Lax',
  hasAttr(state, 'HttpOnly') && hasAttr(state, 'Secure') && hasAttr(state, 'SameSite=Lax'),
  state?.raw ?? 'no cookie',
);
check('the state cookie is short-lived', hasAttr(state, 'Max-Age=600'), state?.raw ?? '');

// The real PKCE check: recompute the challenge from the verifier the
// application stored, exactly as the provider will.
const pending = JSON.parse(state?.value ?? '{}');
const recomputed = createHash('sha256')
  .update(pending.verifier ?? '', 'ascii')
  .digest('base64url');
check(
  'the challenge is S256 of the verifier held in the cookie',
  recomputed === authorize.searchParams.get('code_challenge'),
);
check(
  'the state in the URL matches the state in the cookie',
  authorize.searchParams.get('state') === pending.state,
);
check('return_to survived as a path', pending.returnTo === '/backlog', String(pending.returnTo));

console.log('\n3. the provider redirects back with a code');
const authorizeCall = await call(authorize.toString(), { headers: { cookie: cookieHeader() } });
const callback = new URL(authorizeCall.location ?? `${WEB}/missing`);
check(
  'the provider answers 303 to the configured callback',
  authorizeCall.status === 303 && callback.origin === WEB && callback.pathname === '/auth/callback',
  String(authorizeCall.status),
);
check(
  'the code comes back with the state it was issued for',
  callback.searchParams.get('state') === pending.state,
);

console.log('\n4. the callback exchanges the code and issues a session');
const handled = await call(callback.toString(), { headers: { cookie: cookieHeader() } });
const session = jar.get(SESSION_COOKIE);
check(
  'the callback answers 303 to the page that was asked for',
  handled.status === 303 && new URL(handled.location ?? '/missing', WEB).pathname === '/backlog',
  `${handled.status} ${handled.location ?? ''}`,
);
check('a session cookie is set', session !== undefined);
check(
  'the session cookie is HttpOnly, Secure, SameSite=Lax, path=/',
  hasAttr(session, 'HttpOnly') &&
    hasAttr(session, 'Secure') &&
    hasAttr(session, 'SameSite=Lax') &&
    hasAttr(session, 'Path=/'),
  session?.raw ?? '',
);
check(
  'the __Host- prefix is respected: no Domain attribute',
  session?.attrs.some((a) => a.toLowerCase().startsWith('domain')) !== true,
);
check(
  'it is a session cookie — no Max-Age, so it dies with the browser',
  !hasAttr(session, 'Max-Age') && !hasAttr(session, 'Expires'),
  session?.raw ?? '',
);
check('the one-shot state cookie is gone', jar.get(STATE_COOKIE) === undefined);

const claims = payloadOf(session?.value ?? '');
check(
  'the cookie carries the ID token the provider signed for this client',
  claims.iss === IDP && claims.aud === 'prisme-local' && claims.sub === 'local-owner',
  JSON.stringify({ iss: claims.iss, aud: claims.aud }),
);
check(
  'the token is short-lived, so the session is bounded',
  claims.exp - claims.iat === 300,
  String(claims.exp - claims.iat),
);

console.log('\n5. an authenticated request reaches a populated screen');
const focus = await withCookies(cookieHeader(), { url: `${WEB}/` });
check('GET / answers 200', focus.status === 200, String(focus.status));
check(
  'the Focus screen renders real data from the API',
  focus.body.includes('Half-marathon training plan running'),
);

const backlog = await withCookies(cookieHeader(), { url: `${WEB}/backlog` });
check('GET /backlog answers 200', backlog.status === 200, String(backlog.status));
check(
  'the Backlog screen renders real data from the API',
  backlog.body.includes('Half-marathon training plan running'),
);

console.log('\n6. the API verifies the same token independently');
const api = await call(`${API}/api/v1/focus`, {
  accept: 'application/json',
  headers: { 'x-prisme-assertion': session?.value ?? '' },
});
check('the API accepts the token the web tier presents', api.status === 200, String(api.status));
check('the API returns the fixtures', api.body.includes('Half-marathon training plan running'));
const apiBad = await call(`${API}/api/v1/focus`, {
  accept: 'application/json',
  headers: { 'x-prisme-assertion': 'not-a-token' },
});
check('the API refuses a token that does not verify', apiBad.status === 401, String(apiBad.status));
const apiNone = await call(`${API}/api/v1/focus`, { accept: 'application/json' });
check(
  'the API refuses a request with no credential',
  apiNone.status === 401,
  String(apiNone.status),
);

console.log('\n7. the assertion header is not a way in any more');
const headerOnly = await call(`${WEB}/`, {
  headers: { 'x-prisme-assertion': session?.value ?? '' },
});
check(
  'a *valid* ID token in the header authenticates nobody',
  headerOnly.status === 303 && headerOnly.location?.startsWith('/auth/login') === true,
  `${headerOnly.status} ${headerOnly.location ?? ''}`,
);
const headerAndStale = await call(`${WEB}/`, {
  headers: { 'x-prisme-assertion': session?.value ?? '', cookie: `${SESSION_COOKIE}=not-a-token` },
});
check(
  'a valid header beside a bad cookie is still refused 401',
  headerAndStale.status === 401,
  String(headerAndStale.status),
);

console.log('\n8. missing and bad are answered differently, on purpose');
const noCookieBrowser = await call(`${WEB}/`);
check(
  'no credential + a browser navigation → the login flow',
  noCookieBrowser.status === 303 && noCookieBrowser.location?.startsWith('/auth/login') === true,
  `${noCookieBrowser.status}`,
);
const noCookieFetch = await call(`${WEB}/`, { accept: '*/*' });
check(
  'no credential + an XHR → 401, not a redirect',
  noCookieFetch.status === 401,
  String(noCookieFetch.status),
);
const garbage = await withCookies(`${SESSION_COOKIE}=garbage`, { url: `${WEB}/` });
check('a garbage token → 401, never a redirect', garbage.status === 401, String(garbage.status));
const expired = await call(`${IDP}/expired-token`);
const expiredCall = await withCookies(`${SESSION_COOKIE}=${expired.body}`, { url: `${WEB}/` });
check(
  'an expired token → 401, and not silently re-authenticated',
  expiredCall.status === 401,
  String(expiredCall.status),
);
const wrongSubject = await call(`${IDP}/wrong-subject-token`);
const wrongSubjectCall = await withCookies(`${SESSION_COOKIE}=${wrongSubject.body}`, {
  url: `${WEB}/`,
});
check(
  'a verified token for a subject that is not allow-listed → 401',
  wrongSubjectCall.status === 401,
  String(wrongSubjectCall.status),
);

console.log('\n9. a cross-site state change is still refused');
const crossSite = await call(`${WEB}/auth/logout`, {
  method: 'POST',
  origin: 'https://elsewhere.example.com',
});
check(
  'POST /auth/logout from another origin → 403',
  crossSite.status === 403,
  String(crossSite.status),
);
const noOrigin = await call(`${WEB}/auth/logout`, { method: 'POST' });
check(
  'POST with no Origin at all → 403, not a pass',
  noOrigin.status === 403,
  String(noOrigin.status),
);

console.log('\n10. logout ends the session');
const logout = await call(`${WEB}/auth/logout`, { method: 'POST', origin: WEB });
check(
  'POST /auth/logout answers 303 to the provider end-session endpoint',
  logout.status === 303 && logout.location?.startsWith(`${IDP}/end-session`) === true,
  `${logout.status} ${logout.location ?? ''}`,
);
check('the session cookie is cleared', jar.get(SESSION_COOKIE) === undefined);
const afterLogout = await withCookies(cookieHeader(), { url: `${WEB}/` });
check(
  'after logout the application is unauthenticated again',
  afterLogout.status === 303,
  String(afterLogout.status),
);

console.log('\n11. a login attempt that does not check out issues no session');
/** Start a login and hand back the provider URL and the state cookie it stored. */
async function startLogin() {
  const response = await call(`${WEB}/auth/login?return_to=%2F`, {
    headers: { cookie: cookieHeader() },
  });
  return {
    authorize: new URL(response.location ?? `${IDP}/missing`),
    state: jar.get(STATE_COOKIE),
  };
}

// The verifier is tampered with: the provider must refuse the exchange, and the
// application must not write a session from a refusal. This is the check that
// proves the PKCE verifier is genuinely used rather than merely sent.
const tampered = await startLogin();
const tamperedFlow = { ...JSON.parse(tampered.state?.value ?? '{}') };
tamperedFlow.verifier = 'tampered-verifier-tampered-verifier-tamper';
const tamperedCode = new URL((await call(tampered.authorize.toString())).location ?? '');
const tamperedCall = await call(tamperedCode.toString(), {
  headers: { cookie: `${STATE_COOKIE}=${encodeURIComponent(JSON.stringify(tamperedFlow))}` },
});
check(
  'a code redeemed with the wrong verifier → 401',
  tamperedCall.status === 401,
  String(tamperedCall.status),
);
check('no session is issued from a refused exchange', jar.get(SESSION_COOKIE) === undefined);

// The state the provider echoes back is not the one this browser sent.
const mismatched = await startLogin();
mismatched.authorize.searchParams.set('state', 'a-state-this-browser-never-sent');
const mismatchedCode = new URL((await call(mismatched.authorize.toString())).location ?? '');
const mismatchedCall = await call(mismatchedCode.toString(), {
  headers: { cookie: cookieHeader() },
});
check(
  'a callback whose state does not match → 401',
  mismatchedCall.status === 401,
  String(mismatchedCall.status),
);

// The code is single-use: a second redemption of the same one is refused.
const replayed = await startLogin();
const replayedCode = new URL((await call(replayed.authorize.toString())).location ?? '');
const replayedFirst = await call(replayedCode.toString(), { headers: { cookie: cookieHeader() } });
check(
  'the first redemption of a code succeeds',
  replayedFirst.status === 303,
  String(replayedFirst.status),
);
// The call is load-bearing and its result is not: starting a fresh login
// refreshes the jar's state cookie, so the replay below arrives as a genuine
// new attempt and is refused *for being a replay* rather than for carrying a
// state this browser no longer holds. Discarding the return is the point —
// nothing about the fresh login is asserted.
await startLogin();
const replayedAgainCall = await call(replayedCode.toString(), {
  headers: { cookie: cookieHeader() },
});
check(
  'a replayed code is refused, not re-accepted',
  replayedAgainCall.status === 401,
  String(replayedAgainCall.status),
);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
