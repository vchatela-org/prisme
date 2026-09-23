import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OidcConfig } from '@prisme/config';
import { z } from 'zod';

/**
 * The OIDC authorization-code flow — [ADR-0026](../../../../docs/20-decisions/0026-human-auth-via-oidc.md).
 *
 * ### What this file is, and what it is not
 *
 * It **obtains** an ID token. It does not verify one. Verification stays where
 * it was — `@prisme/auth`, over a JWKS resolved from configuration, with a fixed
 * asymmetric algorithm allow-list (ADR-0026 rule 2) — and the token this file
 * returns enters that path unchanged, through the same call the middleware
 * already made. There is no second verifier here, and nothing here decides who
 * anybody is.
 *
 * The split matters because the two halves fail in different ways. A verifier
 * that is wrong admits an impersonation; a flow that is wrong admits nothing
 * and logs somebody out. Keeping them apart is what lets this file be read as
 * what it is: three URLs, a hash, and a cookie.
 *
 * ### PKCE, and why there is no client secret anywhere near it
 *
 * `code_challenge_method=S256`. The verifier never leaves this process except
 * inside an `HttpOnly` cookie scoped to the callback's path, and it is checked
 * against the `code_verifier` the token endpoint demands. So an authorization
 * code intercepted in a redirect cannot be redeemed by whoever intercepted it.
 *
 * The consequence ADR-0026 rule 4 cares about: **the client is public**, so
 * prisme holds nothing that could mint a token at the provider. That is the
 * property `docs/15-runtime.md` §2 states as *"the human authentication path
 * holds no secret"*, and it is why there is no `OIDC_CLIENT_SECRET` in the
 * configuration schema. Adding one would falsify a documented property; if a
 * provider ever makes a public client impossible, that is a decision to raise
 * and record, not a variable to add quietly.
 *
 * ### Why there is no `nonce`
 *
 * OIDC makes `nonce` optional in the authorization-code flow, and it is the
 * *only* protocol parameter deliberately left out. Its job — binding an ID
 * token to the request that asked for it, so a token minted elsewhere cannot be
 * injected — is done here by two things that are already present: `state`, which
 * binds the *response* to this browser's request and is compared against an
 * `HttpOnly` cookie, and PKCE, which binds the *code* to a verifier only this
 * process holds. Sending a `nonce` and not checking it would be worse than
 * sending none, and checking it would mean reading a claim out of the token
 * outside the verifier — which is the second implementation this design exists
 * to avoid.
 */

/**
 * The session cookie.
 *
 * `__Host-` is the strongest cookie prefix there is, and it fits: the cookie is
 * `Secure`, its path is `/`, and it carries no `Domain`. A browser enforcing the
 * prefix will therefore refuse any attempt to set it from a subdomain or with a
 * `Domain` attribute, which removes the cookie-tossing family outright.
 *
 * The value is the ID token itself. That is worth stating plainly rather than
 * leaving to be discovered: **there is no server-side session**, because the web
 * tier holds no database credential (`docs/14-threat-model.md` §2) and a
 * process-local session store is a session that disappears whenever a pod
 * restarts or a second replica answers — the unpredictable-invalidation failure
 * ADR-0026 rejected a scheduled key re-assignment for. What the browser holds is
 * a credential issued *by the provider* and verified on every single request, so
 * the session cannot outlive the token and there is nothing to invalidate
 * server-side that the cookie does not already carry.
 */
export const SESSION_COOKIE = '__Host-prisme_session';

/**
 * The in-flight login's `state` and PKCE verifier.
 *
 * A separate cookie, a short lifetime, and deliberately not the session cookie:
 * it exists only between the redirect out and the callback in, and it must not
 * be able to overwrite a live session if a second login is started in another
 * tab. `SameSite=Lax` because the callback arrives as a top-level navigation
 * from the provider's own origin, and a `Strict` cookie would not be sent — the
 * callback would then always be a "state mismatch" that only ever appears on
 * the one provider whose redirect is cross-site.
 */
export const STATE_COOKIE = '__Host-prisme_oidc_state';

/** Long enough to read a login form, short enough that an abandoned flow dies. */
export const STATE_TTL_SECONDS = 600;

export interface FlowSecrets {
  /** Compared against the `state` the provider returns. */
  readonly state: string;
  /** PKCE `code_verifier`. Never sent anywhere but the token endpoint. */
  readonly verifier: string;
  /** PKCE `code_challenge` — `base64url(sha256(verifier))`. */
  readonly challenge: string;
}

/** RFC 7636 §4.1 — 43 characters, all of them in the unreserved set. */
function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `S256`: `base64url(sha256(ascii(verifier)))`, per RFC 7636 §4.2. */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function createFlowSecrets(): FlowSecrets {
  const verifier = randomToken();
  return { state: randomToken(), verifier, challenge: codeChallenge(verifier) };
}

/**
 * Constant-time, and length-safe.
 *
 * `timingSafeEqual` throws on buffers of different lengths, and a length check
 * that returns early is itself a timing signal — one that only ever leaks the
 * length of a value this process generated. So both sides are hashed to a fixed
 * width first and the digests compared: equal inputs hash equal, unequal ones
 * differ, and no comparison ever sees a length difference.
 */
export function sameSecret(left: string, right: string): boolean {
  const a = createHash('sha256').update(left, 'utf8').digest();
  const b = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * Where the browser is sent to authenticate.
 *
 * `redirect_uri` and `client_id` come from configuration — never from a request
 * — for the same reason the key-set URL does (ADR-0021 rule 2): a value an
 * attacker supplies is not a value to build a trust decision on. The provider
 * compares the redirect URI exactly anyway, so a header-derived one would be
 * refused rather than exploited, but the habit is the point.
 */
export function authorizationUrl(config: OidcConfig, flow: FlowSecrets): URL {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', flow.state);
  url.searchParams.set('code_challenge', flow.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url;
}

export type Callback =
  | { readonly kind: 'code'; readonly code: string; readonly state: string }
  | { readonly kind: 'error'; readonly error: string };

/**
 * Read the callback's query string.
 *
 * `error` is an OAuth2 error code from the provider — `access_denied` when
 * somebody declines at the consent screen, and a handful of others. It is
 * surfaced as a *reason for the log line* and never echoed to the browser
 * (`docs/14-threat-model.md` §5), so it is length-capped and shape-checked
 * before it is allowed into a message at all: it is a query parameter, and a
 * query parameter is attacker-controlled text.
 */
export function parseCallback(params: URLSearchParams): Callback {
  const error = params.get('error');
  if (error !== null && error !== '') {
    return { kind: 'error', error: /^[a-z_]{1,64}$/i.test(error) ? error : 'unrecognised_error' };
  }

  const code = params.get('code');
  const state = params.get('state');
  if (code === null || code === '' || state === null || state === '') {
    // A callback with neither: the provider sent the browser back without
    // either parameter, which is not something a working provider does.
    return { kind: 'error', error: 'missing_code_or_state' };
  }
  return { kind: 'code', code, state };
}

/**
 * What the token endpoint is allowed to answer with.
 *
 * Parsed before anything reads it — this is a response body from an external
 * service, which `docs/14-threat-model.md` §5 classifies as untrusted input
 * like any other. `id_token` is the only field prisme consumes: no refresh
 * token is requested, none is stored, and the access token is not read, so
 * nothing else is in the shape. Zod strips what it does not know rather than
 * carrying it further into the process.
 */
const TokenResponse = z.object({ id_token: z.string().min(1) });

/** The token endpoint's own OAuth2 error code, for the log line only. */
const ErrorResponse = z.object({ error: z.string() });

export class OidcExchangeFailed extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string) {
    // No body, no headers, and no URL. An error message is the one channel by
    // which a credential reaches a log, and a token response is a credential
    // (CLAUDE.md §4).
    super(`the token endpoint refused the code exchange (status ${String(status)}, ${reason})`);
    this.name = 'OidcExchangeFailed';
    this.status = status;
    this.reason = reason;
  }
}

export interface ExchangeOptions {
  readonly config: OidcConfig;
  readonly code: string;
  readonly verifier: string;
  /** Injected so a test drives the exchange without a socket. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly timeoutMs?: number;
}

/**
 * Redeem the code, and return the ID token. Nothing else.
 *
 * **No `client_secret` is sent, and there is no branch that would send one.**
 * The body is the whole of RFC 7636's public-client exchange: the code, the
 * verifier, and the two values the provider already knows because we sent them
 * in the authorization request. That is the mechanism that keeps this path
 * secret-free, and a secret added here would have to be added to the
 * configuration schema and to `docs/15-runtime.md` §2 as a correction.
 */
export async function exchangeCode(options: ExchangeOptions): Promise<string> {
  const { config } = options;
  const call = options.fetch ?? globalThis.fetch;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: options.verifier,
  });

  let response: Response;
  try {
    response = await call(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: body.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
  } catch {
    // The address is deployment detail; a fetch failure message carries it.
    throw new OidcExchangeFailed(0, 'unreachable');
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = ErrorResponse.safeParse(payload);
    // Shape-checked before it reaches a message: this string came off the wire.
    const reason =
      parsed.success && /^[a-z_]{1,64}$/i.test(parsed.data.error)
        ? parsed.data.error
        : 'unrecognised_error';
    throw new OidcExchangeFailed(response.status, reason);
  }

  const parsed = TokenResponse.safeParse(payload);
  if (!parsed.success) {
    throw new OidcExchangeFailed(response.status, 'no_id_token');
  }
  return parsed.data.id_token;
}

/**
 * One cookie value out of a `Cookie` header, or `undefined`.
 *
 * Parsed here rather than through `next/headers` so that the middleware, the
 * callback and the tests all read a cookie the same way. RFC 6265 allows
 * whitespace around the separators and around the value, and browsers do emit
 * both.
 */
export function cookieValue(header: string | null | undefined, name: string): string | undefined {
  if (header === null || header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      // A `%` that starts no escape sequence. The value is not usable as a
      // token either way, and refusing to throw here keeps a malformed cookie
      // an authentication failure rather than a 500.
      return value;
    }
  }
  return undefined;
}

/**
 * The `Cookie` header without one cookie, for the request forwarded upstream.
 *
 * The session cookie is a browser credential for *this* origin. It is not the
 * API's, and the API reads no cookie at all — so forwarding it would put the ID
 * token on the wire a second time, in a header nothing consumes, purely so that
 * a future reader could start depending on it. What travels to the API is the
 * assertion header the middleware sets, and only that (ADR-0026 rule 5).
 */
export function withoutCookie(header: string | null | undefined, name: string): string | undefined {
  if (header === null || header === undefined || header === '') return undefined;
  const kept = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      if (part === '') return false;
      const separator = part.indexOf('=');
      // A bare segment is not a cookie a browser sends; keep it rather than
      // silently rewriting the header into something else.
      if (separator === -1) return true;
      return part.slice(0, separator).trim() !== name;
    });
  return kept.length === 0 ? undefined : kept.join('; ');
}

/**
 * Where to send the browser after a successful login.
 *
 * A **path**, never a URL: the callback takes this from the query string, so it
 * is attacker-controlled text, and "return the user to wherever this link says"
 * is the open-redirect that turns a login page into a phishing hop. Only a
 * single leading slash is accepted; a protocol-relative `//host`, an absolute
 * `https://…`, a backslash (which some browsers normalise to a slash) and a
 * control character all fall back to the Focus screen, which is where somebody
 * who was not going anywhere specific expected to land.
 */
export function returnToPath(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  for (const character of value) {
    // By code point rather than with a character class, so that no invisible
    // character is written into this file: a control character has no business
    // in a path, and some of them are used to smuggle a second header.
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return '/';
  }
  return value;
}

/**
 * The in-flight state, as stored in {@link STATE_COOKIE}.
 *
 * Parsed with a schema even though prisme wrote it: a cookie arrives from the
 * client, and the `__Host-` prefix makes it hard to *plant* one rather than
 * impossible to *tamper* with it. A parse failure is a failed login, not a
 * crash.
 */
const StateCookie = z.object({
  state: z.string().min(1),
  verifier: z.string().min(1),
  returnTo: z.string(),
});

export type StatePayload = z.infer<typeof StateCookie>;

export function parseStateCookie(value: string | undefined): StatePayload | undefined {
  if (value === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return undefined;
  }
  const parsed = StateCookie.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export function serializeStateCookie(payload: StatePayload): string {
  return JSON.stringify(payload);
}

/**
 * The provider's end-session URL, when the deployment configured one.
 *
 * `client_id` is passed so that a provider which requires it does not answer
 * with an error page after the user has already been logged out — the one
 * failure mode where the user is logged out and not told.
 */
export function endSessionUrl(config: OidcConfig): string | undefined {
  if (config.endSessionEndpoint === undefined) return undefined;
  const url = new URL(config.endSessionEndpoint);
  url.searchParams.set('client_id', config.clientId);
  return url.toString();
}
