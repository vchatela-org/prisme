import {
  AssertionRejection,
  verifyAssertion,
  type AssertionPolicy,
  type KeySource,
} from '@prisme/auth';

/**
 * What the middleware decides, as a value rather than as three early returns.
 *
 * Split out of the proxy (`middleware.ts`, as it was called then) so it can be
 * tested without a request: the
 * decision is four inputs and four outcomes, and the distinction that matters
 * most is the one an early-return version makes easy to lose —
 *
 *   - **no credential**: nobody has logged in yet, or the session has expired.
 *     A browser gets the login flow, because sending somebody to a login form
 *     is the only useful answer to "you have not logged in".
 *   - **a credential that does not verify**: somebody presented a token, and it
 *     was wrong. That is a refusal, and it stays a refusal (401). Redirecting
 *     here would be worse than unhelpful: an attacker probing the endpoint with
 *     garbage would be handed a login flow, and a user with a corrupted cookie
 *     would be sent round a loop instead of being told to clear it.
 *
 * ADR-0026 required the first behaviour and kept the second; this file is where
 * that sentence is executable, and `auth-gate.test.ts` is where it is checked.
 */

export const LOGIN_PATH = '/auth/login';
export const CALLBACK_PATH = '/auth/callback';
export const LOGOUT_PATH = '/auth/logout';

/**
 * The routes that are reachable without a session.
 *
 * `/auth/login` and `/auth/callback` because they are how a session is
 * obtained — routing them through the gate would be a redirect loop with a
 * login flow inside it. `/auth/logout` because clearing a cookie is safe for
 * anybody to ask for and it is the one operation that must work *while* the
 * session is broken: a user whose cookie no longer verifies needs to be able to
 * throw it away, and the alternative is telling them to clear cookies by hand.
 *
 * They are still origin-checked: the check runs before this gate, so a
 * cross-site POST to `/auth/logout` is refused (403) exactly like any other
 * state-changing request.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([LOGIN_PATH, CALLBACK_PATH, LOGOUT_PATH]);

/**
 * What a navigation looks like from in here.
 *
 * `text/html` is a browser opening a page; `text/x-component` is the App
 * Router fetching the same page's payload for a client-side navigation, and it
 * must behave identically — the router follows a redirect on an RSC fetch and
 * turns it into a real navigation, whereas a 401 there is an error boundary.
 * Everything else — an XHR, a server action's POST, a script — is not a
 * navigation and gets the truthful status.
 */
const NAVIGATION_ACCEPT = ['text/html', 'text/x-component'];

export interface GateInput {
  readonly pathname: string;
  /** Including the leading `?`, or empty. Carried into `return_to`. */
  readonly search: string;
  readonly method: string;
  readonly accept: string | undefined;
  /** The ID token from the session cookie, if the browser sent one. */
  readonly sessionToken: string | undefined;
}

export interface GateDeps {
  readonly policy: AssertionPolicy;
  /**
   * Resolved *inside* the gate rather than before it is called, and that is not
   * tidiness: the key set is fetched over the network, and a fetch that fails
   * has to become a `503` ("authentication is temporarily unavailable") rather
   * than an unhandled rejection two frames up. It was inside the `try` in the
   * middleware before this file existed, and it stays inside the `try` here.
   */
  readonly keySource: () => Promise<KeySource>;
  /** Injected so expiry is an ordinary test rather than a test that sleeps. */
  readonly now?: Date;
}

export type GateOutcome =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated'; readonly token: string }
  | { readonly kind: 'redirect'; readonly location: string }
  | { readonly kind: 'refused'; readonly status: number; readonly message: string };

function isNavigation(input: GateInput): boolean {
  if (input.method !== 'GET') return false;
  const accept = input.accept ?? '';
  return NAVIGATION_ACCEPT.some((type) => accept.includes(type));
}

/**
 * Where to send a browser that has no usable session.
 *
 * `return_to` is a path and never a URL, and the value is a path taken from the
 * live request rather than from anything the caller supplied — the callback
 * validates it again on the way back (`./oidc.ts`, `returnToPath`), because it
 * comes out of a query string there and out of the router here.
 */
function loginLocation(input: GateInput): string {
  const target = `${input.pathname}${input.search}`;
  return `${LOGIN_PATH}?return_to=${encodeURIComponent(target)}`;
}

export async function gate(input: GateInput, deps: GateDeps): Promise<GateOutcome> {
  if (PUBLIC_PATHS.has(input.pathname)) return { kind: 'public' };

  const token = input.sessionToken;
  if (token === undefined || token.trim() === '') {
    if (isNavigation(input)) return { kind: 'redirect', location: loginLocation(input) };
    return { kind: 'refused', status: 401, message: 'not authenticated' };
  }

  try {
    await verifyAssertion(token, deps.now ?? new Date(), {
      policy: deps.policy,
      keys: await deps.keySource(),
    });
  } catch (error) {
    if (error instanceof AssertionRejection) {
      // Presented, and wrong. No detail, and no echo of anything the request
      // supplied (docs/14-threat-model.md §5): "wrong audience" and "subject not
      // allow-listed" are different answers, and a caller who can tell them
      // apart can map the configuration by probing.
      return { kind: 'refused', status: 401, message: 'not authenticated' };
    }
    // The key set could not be fetched. That is an availability problem rather
    // than a forged token, and answering 401 would send somebody looking at
    // permissions for an outage.
    return { kind: 'refused', status: 503, message: 'authentication is temporarily unavailable' };
  }

  return { kind: 'authenticated', token };
}
