/**
 * One error type for the whole read path, with a closed set of failure kinds.
 *
 * Two rules govern everything in this file, and both come from the fact that
 * the repository is public and the logger is not:
 *
 *   - **An error carries no secret.** Never a token, never an `Authorization`
 *     header, never a connection string (CLAUDE.md §4).
 *   - **An error carries no instance data.** Never a title, never a body,
 *     never an external page or task ID, never a URL found in content. Those
 *     are the very things docs/17-privacy.md §1 keeps out of git, and an error
 *     message is the shortest path from a live workspace into a journal entry.
 *
 * What is left is still enough to debug with: which tool, which operation,
 * which *field of the wire format* — vendor vocabulary, fixed in an API
 * reference, and identical for every workspace on earth.
 */

export const EXTERNAL_TOOLS = ['doc', 'task'] as const;

/** Which side of the boundary in docs/14-threat-model.md §2 ⑤ failed. */
export type ExternalTool = (typeof EXTERNAL_TOOLS)[number];

export type ConnectorFailure =
  /** The response did not match the schema. Never guess a mapping. */
  | 'invalid_shape'
  /** 401 or 403. Terminal on purpose — retrying a bad credential risks lockout. */
  | 'invalid_token'
  /** 429, after `Retry-After` was honoured and the attempts were spent. */
  | 'rate_limited'
  /** 5xx or 408, after the backoff was spent. */
  | 'unavailable'
  /** A 4xx that is neither auth nor rate limiting. Retrying will not help. */
  | 'refused'
  /** The transport itself failed — DNS, TLS, connection reset, timeout. */
  | 'transport'
  /** A role key with no binding. Configuration, not a runtime condition. */
  | 'unbound_role'
  /** A role prisme holds no read capability for (docs/14-threat-model.md §5). */
  | 'role_not_readable'
  /** A creation against a role that does not carry the `create` capability (ADR-0025). */
  | 'role_not_creatable'
  /** Pagination that does not terminate: a repeated cursor, or too many pages. */
  | 'pagination';

/** Failures where trying the same request again could plausibly succeed. */
const RETRYABLE: ReadonlySet<ConnectorFailure> = new Set<ConnectorFailure>([
  'rate_limited',
  'unavailable',
  'transport',
]);

export interface ConnectorErrorInit {
  readonly tool: ExternalTool;
  /** What was being attempted, in prisme's words: `sync incremental`, `query objectives_db`. */
  readonly operation: string;
  /** HTTP status, when the failure had one. */
  readonly status?: number;
  readonly cause?: unknown;
}

export class ConnectorError extends Error {
  readonly failure: ConnectorFailure;
  readonly tool: ExternalTool;
  readonly operation: string;
  readonly status: number | undefined;

  constructor(failure: ConnectorFailure, detail: string, init: ConnectorErrorInit) {
    super(`${init.tool} tool: ${init.operation}: ${detail}`, { cause: init.cause });
    this.name = 'ConnectorError';
    this.failure = failure;
    this.tool = init.tool;
    this.operation = init.operation;
    this.status = init.status;
  }

  /** True when the caller may reasonably run the same pass again later. */
  get retryable(): boolean {
    return RETRYABLE.has(this.failure);
  }
}

export function isConnectorError(value: unknown): value is ConnectorError {
  return value instanceof ConnectorError;
}
