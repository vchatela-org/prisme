import {
  assertPolicyUsable,
  resolveKeySet,
  type AssertionPolicy,
  type ResolvedKeySet,
} from '@prisme/auth';
import type { AuthConfig, Config, OidcConfig } from '@prisme/config';
import { cookieValue, SESSION_COOKIE } from './oidc';
import { webRuntime } from './runtime';

/**
 * The verification policy, the key set, and the session cookie — the three
 * things the web tier needs before it will believe anything.
 *
 * They lived inside `middleware.ts` until the callback route needed the same
 * three. It needed them for a reason worth stating: without verifying the ID
 * token *in the callback*, a token that does not verify would be written into a
 * session cookie and refused one request later by the middleware — which sends
 * the browser back to the login route, which the provider answers with the same
 * token, which is a redirect loop rather than an error. So the callback
 * verifies, using this policy and this key set, and the loop becomes a refusal
 * with a reason on it.
 *
 * One policy and one key set, therefore, in one place. Two copies would be two
 * answers to "is this token good", and the second one is always the one that
 * rots.
 *
 * ### Loaded lazily, deliberately
 *
 * `next build` evaluates a route's module graph to collect page data, in an
 * environment with no runtime configuration, so a `loadConfig` at module scope
 * makes the build demand production values to emit a manifest. `./runtime.ts`
 * carries the long version of that note; what matters here is that everything
 * below is a function rather than a constant, and the middleware's own
 * `config`/policy construction moved with it.
 *
 * The verification path is still never switched off — there is no flag here,
 * and no branch that returns a subject without a signature check (ADR-0021
 * rule 9, kept by ADR-0026 rule 2). What moved is *when* the policy is read,
 * not whether it is enforced. The failures that must happen at boot still do:
 * an empty `AUTH_ALLOWED_SUBJECTS` and a non-asymmetric `AUTH_ALLOWED_ALGS` are
 * refused by the configuration schema itself, at start-up, before any of this
 * runs.
 */

export function webConfig(): Config {
  return webRuntime().config;
}

/**
 * No fallbacks, deliberately.
 *
 * An earlier version defaulted each field when `config.auth` was absent, and
 * that hid a real wiring bug behind a plausible error message: the variables
 * were set, the object was not being built for this service, and what the
 * process reported was "AUTH_ALLOWED_SUBJECTS is empty". A default that stands
 * in for missing configuration turns a five-second fix into an afternoon.
 */
export function authSettings(): AuthConfig {
  const { auth } = webConfig();
  if (auth === undefined) {
    throw new Error(
      'prisme-web: AUTH_* configuration is absent, so no assertion could be verified. ' +
        'Every variable is documented in docs/15-runtime.md §2',
    );
  }
  return auth;
}

/**
 * The OIDC client this tier logs people in with.
 *
 * Present whenever this service started at all — `OIDC_CLIENT_ID`,
 * `OIDC_REDIRECT_URI` and both endpoints are required for `web`, so a missing
 * one is a boot failure rather than something reachable from here. The same
 * shape as {@link authSettings} anyway, because "the configuration object was
 * not built for this service" is the bug that shape was introduced to stop
 * hiding, and it would hide here just as well.
 */
export function oidcSettings(): OidcConfig {
  const { oidc } = webConfig();
  if (oidc === undefined) {
    throw new Error(
      'prisme-web: OIDC_* configuration is absent, so no login could be started. ' +
        'Every variable is documented in docs/15-runtime.md §2',
    );
  }
  return oidc;
}

let policy: AssertionPolicy | undefined;

export function assertionPolicy(): AssertionPolicy {
  if (policy === undefined) {
    const auth = authSettings();
    const built: AssertionPolicy = {
      issuer: auth.issuerUrl,
      audience: auth.audience,
      allowedAlgs: auth.allowedAlgs,
      allowedSubjects: auth.allowedSubjects,
      clockSkewSeconds: auth.clockSkewSeconds,
      maxLifetimeSeconds: auth.assertionMaxLifetimeSeconds,
    };
    assertPolicyUsable(built);
    policy = built;
  }
  return policy;
}

/**
 * The key set, resolved once and reused.
 *
 * A promise rather than a value: middleware has no boot hook, and resolving on
 * every request would refetch discovery each time. The rejection is not cached
 * as a permanent failure — a `catch` clears it so a provider that was briefly
 * unreachable is retried rather than poisoning the process.
 */
let keySet: Promise<ResolvedKeySet> | undefined;

export function keys(): Promise<ResolvedKeySet> {
  keySet ??= resolveKeySet({
    issuerUrl: assertionPolicy().issuer,
    jwksUrl: authSettings().jwksUrl,
    cacheTtlSeconds: authSettings().jwksCacheTtlSeconds,
  }).catch((error: unknown) => {
    keySet = undefined;
    throw error;
  });
  return keySet;
}

/**
 * The ID token this request is carrying, if any.
 *
 * From the session cookie and from **nowhere else**. The assertion *header* is
 * no longer read on the way in: ADR-0026 rule 3 has it disappearing from the
 * request path, and it has to disappear rather than merely stop being required,
 * because a header path that is still accepted is a second way to be
 * authenticated — and it is the one an attacker inside the perimeter would
 * prefer, which is the whole reason ADR-0021 existed. The header still travels
 * in the other direction, from this tier to the API, where it is the thing the
 * API verifies.
 */
export function sessionToken(cookieHeader: string | null | undefined): string | undefined {
  return cookieValue(cookieHeader, SESSION_COOKIE);
}
