/**
 * What a call to the API can end as, and how a screen is meant to say it.
 *
 * Separate from `api.ts` on purpose: everything here is pure, so it is tested
 * in the ordinary node environment beside the domain tests, while the module
 * that actually opens a socket reads configuration at import time and cannot
 * be. The same split `packages/ui` uses for its cores.
 *
 * ## Four failures, not one
 *
 * A screen that renders "something went wrong" for all of these teaches its
 * reader to reload and hope. The four the surfaces distinguish are the four a
 * reader can actually do something different about:
 *
 * - `unauthenticated` — the assertion did not verify. Sign in again.
 * - `forbidden` — verified, but the token lacks the scope this screen reads
 *   with. Deny-by-default is working; the answer is a wider token, not a retry.
 * - `not_found` — the id in the URL is gone. Not an error state, a 404 page.
 * - `unavailable` — everything else: a 5xx, a timeout, an unparseable body.
 *   This is the only one a reload might fix.
 */

export type ApiFailureKind = 'unauthenticated' | 'forbidden' | 'not_found' | 'unavailable';

export interface ApiFailure {
  readonly ok: false;
  readonly kind: ApiFailureKind;
  /**
   * The API's correlation id when it sent one.
   *
   * It is the entire content of what a reader is told about a failure: the
   * message itself is deliberately generic on both tiers, and this is what
   * turns "it broke" into a log line somebody can find
   * (docs/14-threat-model.md §5).
   */
  readonly correlationId: string | null;
  /**
   * The HTTP status, when the API answered at all. A write form needs it to
   * tell "that key is taken" (409) from "that value is refused" (400); the
   * four kinds above deliberately fold both into `unavailable`.
   */
  readonly status?: number | undefined;
}

export interface ApiSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/**
 * An HTTP status, as one of the four things a screen can say.
 *
 * `429` and `423` land in `unavailable` deliberately. A rate limit and the
 * write freeze are both "not now, and not because of who you are"; the screens
 * that can hit either say so in their own words, with the correlation id.
 */
export function classifyStatus(status: number): ApiFailureKind {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'unavailable';
}

/** The correlation id out of an error body, if that is what the body is. */
export function correlationIdOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as { correlationId?: unknown }).correlationId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface FailureCopy {
  readonly title: string;
  readonly description: string;
}

/**
 * The sentence each failure gets.
 *
 * Written here rather than at four call sites so that the same failure reads
 * the same way on Focus, on the backlog and on a detail page. Nothing in these
 * strings quotes anything the API sent back: an upstream message is the one
 * place a stack trace or a SQL fragment reaches a screen.
 */
export function failureCopy(failure: ApiFailure, surface: string): FailureCopy {
  const trace = failure.correlationId === null ? '' : ` Correlation id: ${failure.correlationId}.`;

  switch (failure.kind) {
    case 'unauthenticated':
      return {
        title: 'Not signed in',
        description: `Your session is no longer valid, so ${surface} could not be read. Sign in again.${trace}`,
      };
    case 'forbidden':
      return {
        title: 'Not permitted',
        description: `This session is authenticated but does not carry the scope ${surface} is read with.${trace}`,
      };
    case 'not_found':
      return {
        title: 'Not found',
        description: `${surface} does not exist, or it was dropped since this link was made.${trace}`,
      };
    case 'unavailable':
      return {
        title: 'prisme could not answer',
        description: `${surface} could not be read. The API did not answer, or answered with something this page could not parse.${trace}`,
      };
  }
}
