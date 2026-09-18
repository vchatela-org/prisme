/**
 * `@prisme/auth` — assertion verification, and nothing that decides permissions.
 *
 * ### Why this is a package rather than part of `apps/api`
 *
 * [ADR-0021](../../../docs/20-decisions/0021-verified-forward-auth-assertion.md)
 * rule 6: both tiers verify, with **one implementation**. The web tier forwards
 * the assertion it verified and the API verifies it again, because the web tier
 * is not a trusted hop.
 *
 * It lived in `apps/api/src/auth` first, with the web tier importing
 * `@prisme/api/auth/verify`. That was one implementation, and it was still
 * wrong: a `workspace:*` dependency on `@prisme/api` pulls its entire closure —
 * the Postgres driver, Hono, `@node-rs/argon2`, `@prisme/sync` — into the web
 * image and its build. The `images` workflow found it immediately, by failing.
 *
 * And it should fail, for a better reason than the build error.
 * [`docs/14-threat-model.md`](../../../docs/14-threat-model.md) §2 draws the
 * trust boundaries at browser → web → API → PostgreSQL, and `apps/web`'s own
 * Dockerfile says so out loud: the web tier holds no database credential.
 * Shipping it a database driver it has no use for widens the blast radius of an
 * XSS for no feature gain. A shared package is not a workaround for the
 * dependency graph — it is the dependency graph telling the truth about the
 * boundary.
 *
 * ### What is deliberately not here
 *
 * **Scopes.** Authorization is prisme's domain and belongs to `apps/api`
 * (docs/14-threat-model.md §3, *Why authorization stays in prisme*). This
 * package answers "who signed this, and does the signature hold" and stops.
 * `verifyAssertion` returns a subject, not a principal with permissions — so
 * there is exactly one place that turns identity into authority, and it is the
 * place with the scope vocabulary in it.
 *
 * **Token hashing.** The Argon2id token store is an API concern with a native
 * dependency, and putting it here would re-create the problem this package
 * exists to solve.
 */

export {
  AssertionRejection,
  assertPolicyUsable,
  effectiveAlgs,
  verifyAssertion,
} from './assertion.js';
export type {
  AssertionDisplay,
  AssertionPolicy,
  AssertionRejectionReason,
  KeySource,
  VerifiedAssertion,
  VerifyAssertionOptions,
} from './assertion.js';

export {
  assertKeySetUsable,
  discoverJwksUrl,
  KeySetUnreachable,
  KeySetUnusable,
  resolveKeySet,
} from './jwks.js';
export type { KeySetOptions, ResolvedKeySet } from './jwks.js';

export { assertSameOrigin, originPolicyFor, OriginRejected } from './origin.js';
export type { OriginCheckRequest, OriginPolicy } from './origin.js';

export { assertUrlAllowed, isUrlAllowed, UrlRejected } from './url-guard.js';
export type { UrlGuardOptions } from './url-guard.js';
