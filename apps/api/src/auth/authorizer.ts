import type { Logger } from '@prisme/observability';
import type {
  AuthorizationRequest,
  AuthorizationResult,
  Authorizer,
  Identity,
} from '../http/authorize.js';
import { ApiError } from '../http/errors.js';
import type { Scope } from '../http/scopes.js';
import {
  AssertionRejection,
  assertSameOrigin,
  OriginRejected,
  verifyAssertion,
  type AssertionPolicy,
  type KeySource,
  type OriginPolicy,
} from '@prisme/auth';
import { ownerPrincipal, type Principal } from './principal.js';
import { createRateLimiter, DEFAULT_RATE_LIMITS, type RateLimiter } from './rate-limit.js';
import { TokenRejection, type TokenService } from './tokens.js';
import { looksLikeApiToken } from './token-format.js';
import { withheldScopes, type WriteSwitch } from './write-switch.js';

/**
 * The mechanism W05 left a hole for.
 *
 * `apps/api/src/http/authorize.ts` built the *shape* of the question — this
 * caller, this scope, this request — and made the answer `no` until somebody
 * supplied one. This is that somebody. Everything below is the order the
 * question is answered in, and the order is the design.
 *
 * ```
 *   1  which credential?      assertion XOR bearer — never both, never neither
 *   2  verify it              signature or Argon2id; no path returns a fallback
 *   3  origin                 state-changing + assertion ⇒ must be same-origin
 *   4  rate limit             keyed on the credential, after it is known
 *   5  kill switch            withhold scopes, before any handler exists
 *   6  hand back an identity  and let `holdsScope` do the rest
 * ```
 *
 * ### Rule 1 has no exception, and this is where you would put one
 *
 * ADR-0021 rule 1: identity comes only from the verified assertion, and the
 * plaintext identity headers are "not a fallback, not a hint, not an audit
 * field". There is no `x-forwarded-user` in this file, or anywhere under
 * `auth/`, and `authorizer.test.ts` asserts that a request carrying nothing but
 * those headers is unauthenticated. That test is there to go red the day
 * somebody adds a convenient fallback, because a convenient fallback is exactly
 * what this looks like from the inside on a bad afternoon.
 *
 * ### Why both credentials at once is a refusal
 *
 * ADR-0021 rule 7. A precedence rule ("bearer wins", "assertion wins") reads as
 * tidier and is how one caller's credential silently becomes another's: an
 * agent's token arriving alongside a browser's ambient assertion would execute
 * as whichever the rule preferred, and nobody would find out from a log line.
 * Ambiguous authentication is a bug, so it is answered as one.
 *
 * ### Every refusal is the same refusal
 *
 * Wrong audience, expired, subject not allow-listed, token revoked: one `401`
 * and one sentence. The reason is logged, never returned — a caller that can
 * distinguish them can map the configuration by probing
 * (docs/14-threat-model.md §5).
 */

const BEARER = /^Bearer\s+(.+)$/i;

/**
 * Identity headers the gateway sets, listed **only so they can be ignored
 * loudly**.
 *
 * Nothing reads these. They are named here so that the one test that matters —
 * "a request carrying only plaintext identity headers is unauthenticated" — has
 * something concrete to send, and so a reader looking for the header path finds
 * this comment instead of a code path.
 */
export const IGNORED_IDENTITY_HEADERS: readonly string[] = [
  'x-forwarded-user',
  'x-forwarded-email',
  'x-forwarded-preferred-username',
  'x-forwarded-groups',
  'x-authentik-username',
  'x-authentik-email',
  'x-authentik-uid',
];

export interface AssertionSource {
  readonly policy: AssertionPolicy;
  readonly keys: KeySource;
  /** `AUTH_ASSERTION_HEADER`. The *header name* is configuration; its value is a credential. */
  readonly header: string;
}

export interface AuthorizerOptions {
  /**
   * Absent when the instance has no identity configuration. The bearer path
   * still works — an agent's token does not depend on the provider — and the
   * human path answers 401, which is the honest state of an instance nobody has
   * pointed at an identity provider.
   */
  readonly assertion?: AssertionSource | undefined;
  readonly tokens: TokenService;
  readonly writeSwitch: WriteSwitch;
  readonly origin: OriginPolicy;
  readonly now: () => Date;
  readonly logger: Logger;
  readonly rateLimiter?: RateLimiter | undefined;
}

const UNAUTHENTICATED = 'this request carries no credential prisme could verify';

function unauthenticated(): AuthorizationResult {
  return { ok: false, error: new ApiError('unauthenticated', UNAUTHENTICATED) };
}

export function createAuthorizer(options: AuthorizerOptions): Authorizer {
  const limiter = options.rateLimiter ?? createRateLimiter();

  /** One line per refusal, with the reason the caller does not get. */
  function refuse(reason: string, detail: Record<string, unknown> = {}): AuthorizationResult {
    options.logger.warn('authentication refused', { reason, ...detail });
    return unauthenticated();
  }

  async function authenticate(
    request: AuthorizationRequest,
  ): Promise<Principal | AuthorizationResult> {
    const assertionHeader = options.assertion?.header;
    const rawAssertion =
      assertionHeader === undefined ? undefined : request.header(assertionHeader)?.trim();
    const rawAuthorization = request.header('authorization')?.trim();

    const bearer = rawAuthorization === undefined ? undefined : BEARER.exec(rawAuthorization)?.[1];

    if (rawAssertion !== undefined && rawAssertion !== '' && rawAuthorization !== undefined) {
      // Rule 7. Note this fires on *any* Authorization header, not only a
      // well-formed bearer: "both credentials present" is about ambiguity, and
      // a malformed second credential is still a second credential.
      return refuse('assertion and Authorization header presented together');
    }

    if (bearer !== undefined) {
      try {
        return await options.tokens.verify(bearer);
      } catch (error) {
        if (error instanceof TokenRejection) {
          return refuse(`token: ${error.reason}`, { path: request.path });
        }
        throw error;
      }
    }

    if (rawAuthorization !== undefined) {
      // Something was offered in `Authorization` that is not a bearer token, or
      // a bearer scheme carrying something that is not one of prisme's tokens.
      return refuse(
        looksLikeApiToken(rawAuthorization)
          ? 'a prisme token was sent without the Bearer scheme'
          : 'the Authorization header is not a Bearer credential prisme issues',
      );
    }

    if (rawAssertion === undefined || rawAssertion === '') {
      // Also the landing place for a request carrying nothing but the gateway's
      // plaintext identity headers. They are not consulted, so it is identical
      // to a request carrying no credential at all — which is the point.
      return refuse('no credential presented');
    }

    const source = options.assertion;
    if (source === undefined) return refuse('no identity provider is configured');

    try {
      // The one place a verified subject becomes authority. `@prisme/auth`
      // deliberately does not know what a scope is.
      return ownerPrincipal(
        await verifyAssertion(rawAssertion, options.now(), {
          policy: source.policy,
          keys: source.keys,
        }),
      );
    } catch (error) {
      if (error instanceof AssertionRejection) {
        return refuse(`assertion: ${error.reason}`, { path: request.path });
      }
      // A key-set fetch that failed is an availability problem, not a forged
      // token, and it deserves a different log level and a 500 rather than a
      // 401 that sends an operator looking at permissions.
      options.logger.error('the assertion could not be verified', { error });
      return {
        ok: false,
        error: new ApiError('internal_error', 'the request could not be completed'),
      };
    }
  }

  return {
    async authorize(request: AuthorizationRequest): Promise<AuthorizationResult> {
      const outcome = await authenticate(request);
      if ('ok' in outcome) return outcome;
      const principal = outcome;

      // Step 3. Bound to the assertion path: CSRF is an ambient-credential
      // attack, and an `Authorization` header is not ambient. See `origin.ts`.
      if (principal.kind === 'human') {
        try {
          assertSameOrigin(
            {
              stateChanging: request.stateChanging,
              origin: request.header('origin'),
              referer: request.header('referer'),
            },
            options.origin,
          );
        } catch (error) {
          if (error instanceof OriginRejected) {
            options.logger.warn('cross-origin state-changing request refused', {
              reason: error.reason,
              method: request.method,
              path: request.path,
            });
            return {
              ok: false,
              error: new ApiError('forbidden', 'this request did not come from prisme'),
            };
          }
          throw error;
        }
      }

      // Step 4. Keyed on the credential, which is only known now.
      const policy = request.stateChanging ? DEFAULT_RATE_LIMITS.write : DEFAULT_RATE_LIMITS.read;
      const decision = limiter.take(
        `${principal.kind === 'human' ? 'sub' : 'token'}:${principal.subject}:${request.stateChanging ? 'w' : 'r'}`,
        policy,
        options.now(),
      );
      if (!decision.allowed) {
        options.logger.warn('rate limit exceeded', {
          kind: principal.kind,
          stateChanging: request.stateChanging,
          path: request.path,
        });
        return {
          ok: false,
          error: new ApiError(
            'rate_limited',
            `too many requests; retry in ${String(decision.retryAfterSeconds)} seconds`,
            undefined,
            { 'retry-after': String(decision.retryAfterSeconds) },
          ),
        };
      }

      // Step 5. Before any handler exists, for every route at once.
      const withheld = withheldScopes(await options.writeSwitch.current());
      if (withheld.includes(request.scope)) {
        return {
          ok: false,
          error: new ApiError(
            'locked',
            'prisme is under a write freeze engaged from the API; reads are unaffected. ' +
              'Release it through the write switch once the cause is understood',
          ),
        };
      }

      const scopes: readonly Scope[] =
        withheld.length === 0
          ? principal.scopes
          : principal.scopes.filter((scope) => !withheld.includes(scope));

      const identity: Identity = {
        kind: principal.kind,
        subject: principal.subject,
        scopes,
      };
      return { ok: true, identity };
    },
  };
}
