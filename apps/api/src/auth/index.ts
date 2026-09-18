import type postgres from 'postgres';
import type { AuthConfig } from '@prisme/config';
import type { Logger } from '@prisme/observability';
import type { Authorizer } from '../http/authorize.js';
import {
  assertKeySetUsable,
  assertPolicyUsable,
  originPolicyFor,
  resolveKeySet,
  type AssertionPolicy,
} from '@prisme/auth';
import { createAuthorizer } from './authorizer.js';
import { createConfirmationService, type ConfirmationService } from './confirmation.js';
import { createPostgresAuthStore } from './postgres.js';
import type { AuthDeps } from './routes.js';
import { createTokenService } from './tokens.js';
import { createWriteSwitch } from './write-switch.js';

/**
 * `apps/api/auth` — the mechanism, assembled.
 *
 * W05 built the shape of the authorization question and answered it `no` until
 * something was installed. This is the something. Everything it needs is
 * validated configuration and a database handle; nothing in this directory
 * reads `process.env`.
 *
 * **The one implementation both tiers use is `@prisme/auth`.** ADR-0021 rule 6:
 * the web tier verifies the assertion and forwards the one it verified, and the
 * API verifies it again with the same code — the web tier is not a trusted hop
 * and holds no ambient authority over the API. That code is a package rather
 * than part of this directory so the web tier can import it without inheriting
 * this app's dependency closure; the reasoning is in `packages/auth/src/index.ts`.
 */

// The verification primitives are `@prisme/auth`'s, and are not re-exported
// here: one import path per thing, so nobody has to wonder which is canonical.
export { createAuthorizer, IGNORED_IDENTITY_HEADERS } from './authorizer.js';
export { ownerPrincipal, OWNER_SCOPES } from './principal.js';
export type { Principal } from './principal.js';
export { createTokenService, TokenRejection } from './tokens.js';
export type { TokenService, IssuedToken } from './tokens.js';
export { TOKEN_PREFIX, looksLikeApiToken, parseToken } from './token-format.js';
export {
  createConfirmationService,
  ConfirmationRejection,
  hashPlan,
  CONFIRMATION_TTL_SECONDS,
} from './confirmation.js';
export type { ConfirmationService } from './confirmation.js';
export { createWriteSwitch, withheldScopes, OUTWARD_WRITE_SCOPES } from './write-switch.js';
export type { WriteSwitch } from './write-switch.js';
export { createRateLimiter, DEFAULT_RATE_LIMITS } from './rate-limit.js';
export { createPostgresAuthStore } from './postgres.js';
export { createMemoryAuthStore } from './memory-store.js';
export { createAuthRoutes } from './routes.js';
export type { AuthDeps } from './routes.js';
export type { AuthStore, ApiTokenRecord, WriteSwitchRecord } from './store.js';

export function assertionPolicyOf(auth: AuthConfig): AssertionPolicy {
  return {
    issuer: auth.issuerUrl,
    audience: auth.audience,
    allowedAlgs: auth.allowedAlgs,
    allowedSubjects: auth.allowedSubjects,
    clockSkewSeconds: auth.clockSkewSeconds,
    maxLifetimeSeconds: auth.assertionMaxLifetimeSeconds,
  };
}

export interface CreateAuthOptions {
  readonly client: postgres.Sql;
  readonly auth: AuthConfig;
  readonly baseUrl: string;
  readonly tokenPepper: string;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly fetch?: typeof globalThis.fetch | undefined;
}

export interface Auth extends AuthDeps {
  readonly authorizer: Authorizer;
  readonly confirmations: ConfirmationService;
  /** Where the keys came from. Logged at boot; it is configuration, not a secret. */
  readonly jwksUrl: string;
}

/**
 * Build the mechanism, **and refuse to start if it could never work.**
 *
 * Two checks run here rather than at the first request, and both are W14
 * definition-of-done items:
 *
 *   - {@link assertPolicyUsable} — an empty subject allow-list, or an algorithm
 *     list with nothing asymmetric left in it;
 *   - {@link assertKeySetUsable} — a key set that is empty or holds no usable
 *     asymmetric key.
 *
 * The second is the important one. A provider deployed without a signing
 * keypair is the *default* configuration of the target identity provider: it
 * signs with the client secret and publishes `{}` (ADR-0021 context, measured).
 * Nothing about that is an error anywhere — the proxy works, the browser works,
 * the assertion arrives — and every verification then fails one request at a
 * time with a 401 that reads like a permissions problem. It is, in the brief's
 * words, "the one failure that would otherwise look like a working system".
 */
export async function createAuth(options: CreateAuthOptions): Promise<Auth> {
  const policy = assertionPolicyOf(options.auth);
  assertPolicyUsable(policy);

  const keySet = await resolveKeySet({
    issuerUrl: options.auth.issuerUrl,
    jwksUrl: options.auth.jwksUrl,
    cacheTtlSeconds: options.auth.jwksCacheTtlSeconds,
    fetch: options.fetch,
  });
  await assertKeySetUsable(keySet.url, options.fetch);

  const store = createPostgresAuthStore(options.client);
  const tokens = createTokenService({
    store,
    pepper: options.tokenPepper,
    now: options.now,
  });
  const writeSwitch = createWriteSwitch({ store, now: options.now });

  return {
    tokens,
    writeSwitch,
    confirmations: createConfirmationService({ store, now: options.now }),
    jwksUrl: keySet.url.toString(),
    authorizer: createAuthorizer({
      assertion: { policy, keys: keySet.keys, header: options.auth.assertionHeader },
      tokens,
      writeSwitch,
      origin: originPolicyFor(options.baseUrl),
      now: options.now,
      logger: options.logger,
    }),
  };
}
