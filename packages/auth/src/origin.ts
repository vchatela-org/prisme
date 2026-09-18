/**
 * CSRF origin checking — W14 item 5, and the note in the brief that says not to
 * talk yourself out of it.
 *
 * ### Why this is needed when prisme sets no cookie
 *
 * The instinct is that ADR-0021 rule 5 already solved this: prisme issues no
 * session cookie, so there is no ambient credential to ride. That is the wrong
 * conclusion and both the ADR and the threat model call it out explicitly.
 *
 * The *gateway's* session cookie is ambient in the browser. A cross-site form
 * post to prisme's origin goes through the forward-auth middleware exactly like
 * a legitimate one, picks up a freshly minted, perfectly valid assertion on the
 * way through, and arrives here authenticated. Nothing about verifying the
 * signature helps: the signature is genuine. The only thing that distinguishes
 * the forged request is **where it came from**.
 *
 * ### Why it applies to the assertion path and not the bearer path
 *
 * CSRF is an *ambient credential* attack. A browser attaches the gateway cookie
 * to a cross-site request without being asked; it does not attach an
 * `Authorization` header to anything. An agent calling the API from a script
 * has no origin to speak of and would be refused by a blanket rule for no
 * security gain — so the check is bound to the credential that is ambient,
 * which is the assertion.
 *
 * ### Why a missing Origin is a refusal
 *
 * Every browser sends `Origin` on a state-changing fetch or form post; it has
 * been universal for years. Treating its absence as "probably not a browser,
 * let it through" is a bypass with a bookmark on it — anything that can omit a
 * header would get one. The refusal is safe because the only callers that
 * legitimately omit `Origin` are the ones on the bearer path, which does not
 * reach this check.
 */

export class OriginRejected extends Error {
  readonly reason: 'absent' | 'mismatch' | 'malformed';

  constructor(reason: OriginRejected['reason'], message: string) {
    super(message);
    this.name = 'OriginRejected';
    this.reason = reason;
  }
}

export interface OriginPolicy {
  /** Derived from `PRISME_BASE_URL`. Exact origins — scheme, host and port. */
  readonly allowedOrigins: readonly string[];
}

export function originPolicyFor(baseUrl: string, extra: readonly string[] = []): OriginPolicy {
  return { allowedOrigins: [new URL(baseUrl).origin, ...extra] };
}

export interface OriginCheckRequest {
  readonly stateChanging: boolean;
  readonly origin: string | undefined;
  readonly referer: string | undefined;
}

/**
 * Throws unless a state-changing request came from somewhere prisme is served.
 *
 * `Referer` is consulted only when `Origin` is absent, and only as a source for
 * an origin — never for a path. It is the weaker signal of the two and exists
 * here for the handful of navigations that still omit `Origin`.
 */
export function assertSameOrigin(request: OriginCheckRequest, policy: OriginPolicy): void {
  if (!request.stateChanging) return;

  const raw = request.origin ?? refererOrigin(request.referer);
  if (raw === undefined || raw === 'null') {
    throw new OriginRejected(
      'absent',
      'a state-changing request from a browser must carry an Origin header',
    );
  }

  if (!policy.allowedOrigins.includes(raw)) {
    // The rejected origin is not echoed: it is attacker-controlled text and
    // this message is returned to the caller (docs/14-threat-model.md §5).
    throw new OriginRejected('mismatch', 'the request did not come from this instance');
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (referer === undefined) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
