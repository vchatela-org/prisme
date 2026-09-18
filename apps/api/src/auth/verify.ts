/**
 * The verification half of `auth/`, on its own.
 *
 * ADR-0021 rule 6 says both tiers verify **with the same implementation**, and
 * this is the entry point the web tier imports. It exists as a separate export
 * rather than the web tier reaching for `@prisme/api/auth` because of what that
 * barrel drags behind it: the token service, and therefore `@node-rs/argon2`, a
 * native addon the web tier has no use for and which would have to be present
 * in its image and its bundle for no reason.
 *
 * Nothing here is a second implementation. It is the same modules, re-exported
 * — `assertion.ts`, `jwks.ts`, `origin.ts`, `principal.ts` — so a change to the
 * verifier changes both tiers by construction, which is the whole point of the
 * rule. A separate "lightweight verifier for the web" would be exactly the
 * thing ADR-0021 is written to prevent.
 */

export {
  AssertionRejection,
  assertPolicyUsable,
  effectiveAlgs,
  verifyAssertion,
} from './assertion.js';
export type {
  AssertionPolicy,
  AssertionRejectionReason,
  VerifyAssertionOptions,
} from './assertion.js';
export { assertKeySetUsable, discoverJwksUrl, resolveKeySet } from './jwks.js';
export type { KeySetOptions, ResolvedKeySet } from './jwks.js';
export { assertSameOrigin, originPolicyFor, OriginRejected } from './origin.js';
export type { OriginCheckRequest, OriginPolicy } from './origin.js';
export { ownerPrincipal, OWNER_SCOPES } from './principal.js';
export type { Principal, PrincipalDisplay } from './principal.js';
export { assertUrlAllowed, isUrlAllowed, UrlRejected } from './url-guard.js';
