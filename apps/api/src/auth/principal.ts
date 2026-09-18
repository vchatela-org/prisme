import type { VerifiedAssertion } from '@prisme/auth';
import { SCOPE_NAMES, type Scope } from '../http/scopes.js';

/**
 * Who is asking, once something has been verified — **and what they may do**.
 *
 * This is the seam. `@prisme/auth` answers "whose signature is this" and stops;
 * the scope vocabulary is prisme's domain, so turning a verified subject into
 * authority happens here and only here (docs/14-threat-model.md §3, *Why
 * authorization stays in prisme*).
 *
 * Two kinds, and they arrive by genuinely different routes (ADR-0015): a human
 * through the identity provider's signed assertion, an agent through a
 * prisme-issued scoped token. Both end up here, and both then pass through the
 * same scope check — being human is not a wildcard (ADR-0021 rule 8).
 *
 * ### `subject` is `sub`, and nothing else
 *
 * ADR-0021 rule 4. Username, name and email are display material and live in
 * {@link Principal.display}, unused by any decision. A rename in the identity
 * provider must not silently become a different principal, and must not
 * silently become the *same* one — which is what happens the moment an
 * `email` is used as the key.
 */

export interface PrincipalDisplay {
  readonly username?: string | undefined;
  readonly name?: string | undefined;
  readonly email?: string | undefined;
}

export interface Principal {
  readonly kind: 'human' | 'agent';
  /** The identity key. `sub` for a human, the token id for an agent. */
  readonly subject: string;
  readonly scopes: readonly Scope[];
  /** Never used in a decision. Present so a UI can say who is signed in. */
  readonly display?: PrincipalDisplay | undefined;
  /** Set for an agent, so `last_used_at` and the event log can name the token. */
  readonly tokenId?: string | undefined;
}

/**
 * What a verified human holds.
 *
 * Every scope, explicitly enumerated rather than expressed as a wildcard. The
 * distinction is not cosmetic: `holdsScope` asks `scopes.includes(scope)`, so a
 * scope added to the vocabulary tomorrow is granted here automatically, while
 * there is still no code path anywhere that answers "yes" without being asked
 * about a specific scope. A wildcard would be a second answer to the
 * authorization question, and the second answer is the one that goes wrong.
 */
export const OWNER_SCOPES: readonly Scope[] = SCOPE_NAMES;

export function ownerPrincipal(verified: VerifiedAssertion): Principal {
  return {
    kind: 'human',
    subject: verified.subject,
    scopes: OWNER_SCOPES,
    display: verified.display,
  };
}
