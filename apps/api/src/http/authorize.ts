import { ApiError } from './errors.js';
import type { Scope } from './scopes.js';

/**
 * The authorization *hook*. W14 supplies the mechanism; W05 supplies the
 * declarations and the place they are checked.
 *
 * W05 deliberately builds no verifier, no token store and no session. What it
 * builds is the shape of the question — "this caller, this scope, this request"
 * — and the answer when nobody has been installed to answer it, which is **no**.
 *
 * ### Why the default denies rather than allows
 *
 * `apps/api/src/app.ts` already says it, from W00: a stub of an authorization
 * decision is exactly the kind of thing that survives to production. So the
 * default here is not a stub that says yes for now. It is a real decision — 401,
 * every route, every caller — and an instance with no verifier configured
 * serves no data at all. That is the correct behaviour for a process holding
 * read/write tokens to somebody's entire planning workspace
 * (docs/14-threat-model.md §1).
 */

export interface Identity {
  /** Humans arrive through the identity provider; agents present a scoped token. */
  readonly kind: 'human' | 'agent';
  /** The subject, for the event log's `actor` and for `last_used_at`. */
  readonly subject: string;
  readonly scopes: readonly Scope[];
}

export interface AuthorizationRequest {
  readonly scope: Scope;
  readonly method: string;
  readonly path: string;
  /**
   * True for anything that is not a read. CSRF is still live even though prisme
   * sets no cookie — the gateway's session cookie is ambient in the browser, so
   * a cross-site state-changing request arrives authenticated
   * (docs/14-threat-model.md §3). The origin check that follows from this is
   * W14's; the flag is here so the mechanism does not have to re-derive it.
   */
  readonly stateChanging: boolean;
  readonly header: (name: string) => string | undefined;
}

export type AuthorizationResult =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly error: ApiError };

export interface Authorizer {
  authorize(request: AuthorizationRequest): Promise<AuthorizationResult>;
}

/**
 * The authorizer an unconfigured instance gets. Refuses everything.
 *
 * It is not a placeholder to be replaced by "allow" during development: the way
 * to develop against the API is to install a real authorizer that accepts a
 * development credential, not to turn the question off.
 */
export const DENY_EVERYTHING: Authorizer = {
  authorize: () =>
    Promise.resolve({
      ok: false,
      error: new ApiError(
        'unauthenticated',
        'this instance has no authorization mechanism installed, so every request is refused',
      ),
    }),
};

/** The scope check itself, once an identity exists. No wildcard, by design. */
export function holdsScope(identity: Identity, scope: Scope): boolean {
  return identity.scopes.includes(scope);
}

export function forbidden(scope: Scope): ApiError {
  return new ApiError('forbidden', `this credential does not hold the ${scope} scope`);
}
