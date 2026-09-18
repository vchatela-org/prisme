import { createRemoteJWKSet } from 'jose';
import type { KeySource } from './assertion.js';
import { assertUrlAllowed } from './url-guard.js';

/**
 * Where the signing keys come from, and the one boot check that is worth more
 * than the rest of this directory put together.
 *
 * ### The failure this file exists to make loud
 *
 * The target identity provider, deployed the ordinary way, has **no signing
 * keypair**. It then signs with the client secret, advertises an HMAC
 * algorithm, and publishes an empty JWKS — `{}` (ADR-0021 context, measured).
 * Nothing in that is an error at any layer. The proxy works, the browser works,
 * the assertion arrives, and every verification fails one request at a time
 * with a 401 that looks like a permissions problem.
 *
 * So {@link assertKeySetUsable} runs at boot and stops the process. W14's
 * definition of done says it plainly: an empty or unusable key set is "the one
 * failure that would otherwise look like a working system".
 *
 * ### The key-set URL is configuration, always
 *
 * ADR-0021 rule 2, and it is worth being concrete about what is being refused.
 * The forward-auth middleware forwards a companion header carrying the **URL**
 * of the key set (ADR-0021 context, measured against the outpost source). Using
 * it would mean fetching verification keys from an address the request supplied
 * — which is not a signature check at all, it is an invitation. prisme reads
 * `AUTH_JWKS_URL`, or discovers the URL from `AUTH_ISSUER_URL`, and never looks
 * at the header.
 */

export interface KeySetOptions {
  readonly issuerUrl: string;
  /** `AUTH_JWKS_URL`. Discovered from the issuer when absent. */
  readonly jwksUrl: string | undefined;
  readonly cacheTtlSeconds: number;
  /** Injected so a test can serve a key set without a socket. */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

export interface ResolvedKeySet {
  readonly url: URL;
  readonly keys: KeySource;
}

/**
 * Appended to the issuer's path, not rooted at its origin.
 *
 * Deliberately not `/.well-known/…`: the issuer here has a path
 * (`…/application/o/<app>`), and a leading slash would throw that path away and
 * ask the origin's root instead — which is a different application's discovery
 * document, or a 404. RFC 8414 does specify the rooted form for path-carrying
 * issuers, but the providers this is pointed at serve the appended one, and
 * `AUTH_JWKS_URL` exists for anything that does neither.
 */
const DISCOVERY_PATH = '.well-known/openid-configuration';

/**
 * The origin allow-list for anything this module fetches: the issuer's own
 * origin, and nothing else.
 *
 * Both hops go through {@link assertUrlAllowed} — the discovery document *and*
 * the `jwks_uri` it returns. The second matters more than it looks: that value
 * is a response body from an external service, which docs/14-threat-model.md §5
 * classifies as untrusted input like any other. A provider that has been
 * tampered with could otherwise redirect key fetching anywhere in the cluster.
 */
function originsFor(issuerUrl: string): readonly string[] {
  return [new URL(issuerUrl).origin];
}

export async function discoverJwksUrl(
  issuerUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  const allowedOrigins = originsFor(issuerUrl);
  const discovery = assertUrlAllowed(
    new URL(DISCOVERY_PATH, issuerUrl.endsWith('/') ? issuerUrl : `${issuerUrl}/`).toString(),
    { allowedOrigins },
  );

  const response = await fetchImpl(discovery, { redirect: 'error' });
  if (!response.ok) {
    throw new Error(
      `AUTH_JWKS_URL is unset and discovery at the issuer answered ${String(response.status)}. ` +
        'Set AUTH_JWKS_URL explicitly, or check the issuer URL',
    );
  }

  const document = (await response.json()) as { jwks_uri?: unknown };
  if (typeof document.jwks_uri !== 'string') {
    throw new Error('the issuer discovery document has no jwks_uri');
  }

  // Checked, not trusted — see the note on `originsFor`.
  return assertUrlAllowed(document.jwks_uri, { allowedOrigins }).toString();
}

export async function resolveKeySet(options: KeySetOptions): Promise<ResolvedKeySet> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const raw = options.jwksUrl ?? (await discoverJwksUrl(options.issuerUrl, fetchImpl));
  const url = assertUrlAllowed(raw, { allowedOrigins: originsFor(options.issuerUrl) });

  const keys = createRemoteJWKSet(url, {
    cacheMaxAge: options.cacheTtlSeconds * 1000,
    // Refetched early on an unknown `kid`, so a key rotation does not need a
    // restart (docs/15-runtime.md §2). The cooldown is what stops an unknown
    // `kid` in a forged token from becoming a fetch amplifier.
    cooldownDuration: 30_000,
    [Symbol.for('jose.customFetch') as never]: fetchImpl as never,
  });

  return { url, keys };
}

/**
 * The key set is there and cannot verify anything. **A configuration failure.**
 *
 * This is the case W14's definition of done calls "the one failure that would
 * otherwise look like a working system": a provider deployed with no signing
 * keypair signs with the client secret and publishes `{}`, and nothing about
 * that is an error at any layer. It will never fix itself, so a process that
 * starts is a process that will answer 401 to its owner forever. Callers are
 * expected to treat this as fatal.
 */
export class KeySetUnusable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeySetUnusable';
  }
}

/**
 * The key set could not be fetched. **An availability failure, and not fatal.**
 *
 * Distinguished from {@link KeySetUnusable} because the right response is the
 * opposite one. Refusing to start would make a brief identity-provider outage
 * into a crash-looping API — and `/healthz` "has no dependencies" is a
 * requirement (docs/15-runtime.md §1), which an unreachable provider must not
 * be allowed to break. Start, serve the probes, answer the human path closed,
 * and resolve the key set when it can be reached.
 */
export class KeySetUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeySetUnreachable';
  }
}

interface JsonWebKey {
  readonly kty?: unknown;
  readonly use?: unknown;
  readonly alg?: unknown;
}

/** RSA, elliptic curve and Edwards keys. `oct` — a shared secret — is not a signing key here. */
const ASYMMETRIC_KTY = new Set(['RSA', 'EC', 'OKP']);

/**
 * Fetch the key set once, at boot, and refuse to start unless it can verify
 * something.
 *
 * Deliberately a separate fetch from {@link resolveKeySet}'s cache: this one
 * has to *look at* the keys, and a `JWTVerifyGetKey` is a closure that resolves
 * one key for one token. The duplicate request happens once per process.
 */
export async function assertKeySetUsable(
  url: URL,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> {
  const advice =
    'The identity provider almost certainly has no signing keypair assigned, which is its default: ' +
    'it then signs with the client secret and publishes an empty key set. ' +
    'docs/15-runtime.md §6 records this as obligation 1 on the deployment.';

  let payload: { keys?: unknown };
  try {
    const response = await fetchImpl(url, { redirect: 'error' });
    if (!response.ok) {
      throw new Error(`the key set answered ${String(response.status)}`);
    }
    payload = (await response.json()) as { keys?: unknown };
  } catch (error) {
    // The URL is named because it is configuration, not a secret
    // (docs/15-runtime.md §2). The error's own message is not interpolated: it
    // can carry a proxy's response body.
    throw new KeySetUnreachable(
      `the signing key set at ${url.toString()} could not be read, so no assertion can be verified ` +
        `until it can. ${advice} (${error instanceof Error ? error.name : 'error'})`,
    );
  }

  const keys = Array.isArray(payload.keys) ? (payload.keys as readonly JsonWebKey[]) : [];
  const usable = keys.filter(
    (key) =>
      typeof key.kty === 'string' &&
      ASYMMETRIC_KTY.has(key.kty) &&
      (key.use === undefined || key.use === 'sig'),
  );

  if (usable.length === 0) {
    throw new KeySetUnusable(
      `the signing key set at ${url.toString()} holds no usable asymmetric key ` +
        `(${String(keys.length)} key(s) present), so no assertion could ever be verified. ${advice}`,
    );
  }
}
