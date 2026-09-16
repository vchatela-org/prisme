/**
 * Domain errors.
 *
 * An invariant is a rule the model guarantees rather than hopes for. When one is
 * violated the construction fails here, in the pure layer, before anything has
 * been written anywhere — which is the only place a violation is still cheap.
 *
 * Errors carry no secrets (CLAUDE.md §4). A domain error names entity ids,
 * field names and numbers; never a token, a header or a connection string.
 */

export type InvariantCode =
  | 'dependency_cycle'
  | 'duplicate_external_ref'
  | 'duplicate_method'
  | 'invalid_calendar_date'
  | 'invalid_fibonacci'
  | 'invalid_limits'
  | 'invalid_params'
  | 'invalid_share'
  | 'invalid_weight'
  | 'invalid_year'
  | 'multiple_active_methods'
  | 'no_active_method'
  | 'origin_immutable'
  | 'self_dependency'
  | 'unknown_area'
  | 'unknown_initiative'
  | 'unknown_method';

export interface InvariantDetails {
  /** For `dependency_cycle`: the cycle, in order, first id repeated at the end. */
  readonly path?: readonly string[] | undefined;
}

export class InvariantError extends Error {
  override readonly name = 'InvariantError';
  readonly code: InvariantCode;
  readonly path: readonly string[] | undefined;

  constructor(code: InvariantCode, message: string, details: InvariantDetails = {}) {
    super(message);
    this.code = code;
    this.path = details.path;
  }
}

export function isInvariantError(error: unknown): error is InvariantError {
  return error instanceof InvariantError;
}
