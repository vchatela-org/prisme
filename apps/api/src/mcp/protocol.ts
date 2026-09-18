import { z } from 'zod';

/**
 * The wire format: JSON-RPC 2.0, as MCP constrains it.
 *
 * Written against the specification rather than taken from the reference SDK —
 * the reasoning, and the seventeen dependencies that decision avoids, are in
 * [ADR-0024](../../../../docs/20-decisions/0024-mcp-without-the-sdk.md). What
 * follows from it is that this file is the *only* place the envelope is
 * understood: `server.ts` receives a parsed message and `mount.ts` receives a
 * parsed response, and neither reaches for a raw field.
 *
 * Parsed with Zod at the boundary, like every other input into this process
 * (apps/api/CLAUDE.md §2). An MCP message arrives from an agent, which is the
 * caller the threat model assumes is *confused* rather than hostile — and a
 * confused caller produces malformed input far more often than a hostile one
 * does.
 */

/**
 * The revision this server speaks.
 *
 * Pinned as a constant because two things depend on it being exactly one value:
 * the `initialize` result, and the `MCP-Protocol-Version` header check in
 * `mount.ts`. It is also the revision that **removed JSON-RPC batching**, which
 * is why {@link parseMessage} refuses an array rather than iterating one.
 */
export const PROTOCOL_VERSION = '2025-06-18';

/**
 * What a client is assumed to speak when it sends no `MCP-Protocol-Version`
 * header. The specification names this exact value for backwards compatibility;
 * it is not a default we chose.
 */
export const ASSUMED_PROTOCOL_VERSION = '2025-03-26';

/** Revisions this server will answer. Anything else is a `400` from `mount.ts`. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  PROTOCOL_VERSION,
  ASSUMED_PROTOCOL_VERSION,
];

/**
 * JSON-RPC 2.0 error codes, plus the one MCP adds.
 *
 * `-32002` is used for a request that is well-formed and refused — an
 * unauthorized tool, a withheld scope. It is deliberately *not* `-32600`: an
 * agent that cannot tell "you may not" from "you sent nonsense" retries the
 * second one forever.
 */
export const JSON_RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** MCP's reserved range. Here: not authorized. */
  requestRefused: -32002,
} as const;

/**
 * An id is a string or a number. `null` is legal JSON-RPC for an error response
 * but is never accepted *as* a request id: a request whose id is null cannot be
 * correlated with its answer.
 */
export const requestId = z.union([z.string().min(1).max(200), z.int()]);
export type RequestId = z.infer<typeof requestId>;

const VERSION = z.literal('2.0');

/** A method name. Bounded, because it is used as a map key and logged. */
const method = z.string().min(1).max(100);

/**
 * `params` is an object or absent. The specification allows an array by-position
 * and MCP uses none, so accepting one would only widen what has to be handled.
 */
const params = z.record(z.string(), z.unknown()).optional();

export const jsonRpcRequest = z.strictObject({
  jsonrpc: VERSION,
  id: requestId,
  method,
  params,
});

export const jsonRpcNotification = z.strictObject({
  jsonrpc: VERSION,
  method,
  params,
});

export type JsonRpcRequest = z.infer<typeof jsonRpcRequest>;
export type JsonRpcNotification = z.infer<typeof jsonRpcNotification>;

export interface JsonRpcErrorBody {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: RequestId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: RequestId | null;
  readonly error: JsonRpcErrorBody;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export function success(id: RequestId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result };
}

export function failure(
  id: RequestId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

export type ParsedMessage =
  | { readonly kind: 'request'; readonly message: JsonRpcRequest }
  | { readonly kind: 'notification'; readonly message: JsonRpcNotification }
  /**
   * A JSON-RPC *response* from the client. Legal on the wire — the transport
   * allows a client to answer a server-initiated request — and this server
   * initiates none, so it is accepted and dropped rather than answered.
   */
  | { readonly kind: 'response' }
  | { readonly kind: 'invalid'; readonly id: RequestId | null; readonly reason: string };

/**
 * Classify one incoming message.
 *
 * Order matters. `id` is what separates a request from a notification, so it is
 * read *before* either schema runs — otherwise a request with a bad `method`
 * would be reported as "not a notification either", and the client would be told
 * the wrong thing about what it sent.
 */
export function parseMessage(value: unknown): ParsedMessage {
  if (Array.isArray(value)) {
    // Batching was removed in 2025-06-18. Refusing it is conformance, not a
    // shortcut: a server that half-supports batches answers some of one.
    return {
      kind: 'invalid',
      id: null,
      reason: `JSON-RPC batching is not part of MCP ${PROTOCOL_VERSION}; send one message per request`,
    };
  }

  if (typeof value !== 'object' || value === null) {
    return { kind: 'invalid', id: null, reason: 'a JSON-RPC message must be a JSON object' };
  }

  const record = value as Record<string, unknown>;
  const declaredId = requestId.safeParse(record['id']);
  const id = declaredId.success ? declaredId.data : null;

  if ('result' in record || 'error' in record) return { kind: 'response' };

  if ('id' in record) {
    if (record['id'] === null) {
      // Neither thing: a notification has no `id` member at all, and MCP says a
      // request's id MUST NOT be null. Reported as itself rather than falling
      // through to the notification schema, which would have called it an
      // unrecognised key — true, and useless to whoever sent it.
      return {
        kind: 'invalid',
        id: null,
        reason: 'a request id must not be null; omit `id` entirely to send a notification',
      };
    }
    const parsed = jsonRpcRequest.safeParse(value);
    if (parsed.success) return { kind: 'request', message: parsed.data };
    return { kind: 'invalid', id, reason: describe(parsed.error) };
  }

  const parsed = jsonRpcNotification.safeParse(value);
  if (parsed.success) return { kind: 'notification', message: parsed.data };
  return { kind: 'invalid', id: null, reason: describe(parsed.error) };
}

/**
 * A Zod error as one sentence a client can act on.
 *
 * Envelope problems only — the shape of the message, never the contents of a
 * tool's arguments — so there is nothing here that could carry instance data
 * back out. Tool argument errors take the {@link JSON_RPC.invalidParams} path in
 * `server.ts`, which reports the field names its own schema named.
 */
export function describe(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');
}
