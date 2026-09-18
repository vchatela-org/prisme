/**
 * One error shape, and nothing inside it a caller was not meant to see.
 *
 * docs/14-threat-model.md §5: no stack traces, no SQL, no upstream messages. An
 * error carries a machine-readable `error` code, a sentence written here rather
 * than anywhere downstream, and the correlation ID that ties it to the log line
 * holding the detail. That pairing is the whole design — the operator can find
 * the cause, and the caller learns nothing about the inside of the process.
 *
 * `fields` is the one place detail is allowed, because validation detail *is*
 * the answer: a caller that does not learn which field it got wrong will guess,
 * and guessing against a write API is how a field ends up mass-assigned.
 */

export type ApiErrorCode =
  | 'invalid_request'
  | 'unknown_field'
  | 'read_only_field'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'locked'
  | 'rate_limited'
  | 'internal_error';

export interface FieldProblem {
  readonly field: string;
  readonly reason: string;
}

export interface ErrorBody {
  readonly error: ApiErrorCode;
  readonly message: string;
  readonly correlationId: string;
  readonly fields?: readonly FieldProblem[];
}

const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  invalid_request: 400,
  unknown_field: 400,
  read_only_field: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  locked: 423,
  rate_limited: 429,
  internal_error: 500,
};

/**
 * An error whose message is safe to return.
 *
 * Anything thrown that is *not* one of these becomes `internal_error` with a
 * fixed sentence — which is the safe default, and the reason this class exists
 * rather than a convention about which messages are public.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fields: readonly FieldProblem[] | undefined;
  /**
   * Response headers this error needs to be actionable — `Retry-After` on a
   * `429`, and nothing else so far (W14).
   *
   * Deliberately a fixed map set at the throw site rather than anything the
   * caller's input can reach: a header assembled from request data is a
   * response-splitting vector, and the whole point of this class is that a
   * caller learns only what was written here on purpose.
   */
  readonly headers: Readonly<Record<string, string>> | undefined;

  constructor(
    code: ApiErrorCode,
    message: string,
    fields?: readonly FieldProblem[],
    headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = fields;
    this.headers = headers;
  }

  body(correlationId: string): ErrorBody {
    return {
      error: this.code,
      message: this.message,
      correlationId,
      ...(this.fields === undefined ? {} : { fields: this.fields }),
    };
  }
}

export function notFound(what: string, id: string): ApiError {
  return new ApiError('not_found', `no ${what} with id ${id}`);
}

/**
 * The body for anything that is not an {@link ApiError}.
 *
 * Deliberately identical whatever went wrong. A caller distinguishing a
 * constraint violation from a driver failure is a caller mapping the inside of
 * the process, and the correlation ID is what a human uses instead.
 */
export function internalErrorBody(correlationId: string): ErrorBody {
  return {
    error: 'internal_error',
    message: 'the request could not be completed',
    correlationId,
  };
}
