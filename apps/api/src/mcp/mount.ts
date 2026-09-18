import type { Context, Hono } from 'hono';
import type { Logger } from '@prisme/observability';
import { holdsScope, type Authorizer } from '../http/authorize.js';
import { ApiError } from '../http/errors.js';
import type { Services } from '../services/index.js';
import {
  failure,
  JSON_RPC,
  parseMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcFailure,
  type RequestId,
} from './protocol.js';
import type { McpServer } from './server.js';

/**
 * The MCP endpoint: one path, Streamable HTTP, stateless.
 *
 * Mounted on the API process so that it shares one authenticator, one service
 * layer and one database handle (W06 contract, item 1). It is deliberately
 * **not** under `/api/v1`: it is not a REST route, it is not in the OpenAPI
 * document, and the deployment routes it separately — the forward-auth
 * middleware is attached to the UI route only, because the proxy consumes
 * inbound `Authorization` headers and would eat every agent's bearer token
 * (docs/15-runtime.md §6, obligation 3).
 *
 * ### The order, and why the body is parsed before the caller is known
 *
 * ```
 *   1  transport checks     method, Accept, protocol version, size
 *   2  parse the envelope   Zod, so step 3 has something to ask about
 *   3  which scope?         the *tool's* scope, not the endpoint's
 *   4  authorize            W14's authorizer, with that scope
 *   5  hold the scope?      `holdsScope`, the same check every REST route uses
 *   6  dispatch
 * ```
 *
 * Step 3 before step 4 looks backwards and is the point. `authorize` takes the
 * required scope as an argument, and that argument is what the kill switch
 * compares against: engaging it withholds `write:*` from every principal *in the
 * authorizer*, so a write tool becomes unreachable without W06 writing a check
 * for it. An endpoint that authorized itself once with some fixed scope and then
 * dispatched seventeen tools behind it would have removed that property, and
 * `auth/write-switch.ts` says in as many words that this is the failure it was
 * built to avoid.
 *
 * Parsing untrusted JSON before authenticating is therefore load-bearing rather
 * than sloppy. It is bounded: a size cap, then Zod, then nothing else touches it.
 *
 * ### No session
 *
 * `Mcp-Session-Id` is a MAY in the transport specification and prisme issues
 * none (ADR-0024). A session would be a second thing carrying authority
 * alongside the credential, and there is exactly one credential per request
 * here — which is also why `GET` answers `405` rather than opening a stream the
 * server has nothing to put on.
 */

export const MCP_PATH = '/mcp';

/**
 * A ceiling on a request body. An MCP call is a tool name and a small argument
 * object; nothing legitimate approaches this, and an unbounded read is a way to
 * turn one request into the process's memory.
 */
const MAX_BODY_BYTES = 256 * 1024;

export interface McpMountOptions {
  readonly server: McpServer;
  readonly authorizer: Authorizer;
  readonly services: Services;
  readonly logger: Logger;
  readonly now: () => Date;
}

/**
 * Whether this client will take a JSON answer.
 *
 * The specification says a client MUST offer both `application/json` and
 * `text/event-stream`. prisme only ever answers the first, so it checks for the
 * first and ignores the absence of the second: refusing a client that cannot
 * accept a stream this server never opens would be strictness with a cost and
 * no benefit. An absent `Accept` is treated as the wildcard, as HTTP intends.
 */
function acceptsJson(header: string | undefined): boolean {
  if (header === undefined || header.trim() === '') return true;
  return header
    .split(',')
    .map((entry) => (entry.split(';')[0] ?? '').trim().toLowerCase())
    .some((type) => type === 'application/json' || type === 'application/*' || type === '*/*');
}

function rpcError(
  c: Context,
  status: number,
  id: RequestId | null,
  code: number,
  message: string,
): Response {
  const body: JsonRpcFailure = failure(id, code, message);
  return c.json(body, status as 400);
}

export function mountMcp(app: Hono, options: McpMountOptions): void {
  /**
   * The transport offers no server-initiated stream and no session, so both of
   * the other verbs it defines are answered exactly as it permits: `405`, with
   * `Allow`, rather than a 404 that would make a client think it had the wrong
   * URL and go looking for the deprecated HTTP+SSE transport.
   */
  const notAllowed = (c: Context): Response => {
    c.header('Allow', 'POST');
    return rpcError(
      c,
      405,
      null,
      JSON_RPC.invalidRequest,
      "prisme's MCP endpoint is POST-only: it opens no server-initiated stream and issues no session id",
    );
  };

  app.get(MCP_PATH, notAllowed);
  app.delete(MCP_PATH, notAllowed);

  app.post(MCP_PATH, async (c: Context) => {
    const correlationId = c.res.headers.get('x-request-id') ?? c.req.header('x-request-id') ?? '';

    const version = c.req.header('mcp-protocol-version');
    if (version !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      // The transport specification is explicit that this is a 400 rather than
      // a negotiation: the client already chose, and it chose something this
      // server does not speak.
      return rpcError(
        c,
        400,
        null,
        JSON_RPC.invalidRequest,
        `unsupported MCP-Protocol-Version: ${version}. This server speaks ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
      );
    }

    if (!acceptsJson(c.req.header('accept'))) {
      return rpcError(
        c,
        406,
        null,
        JSON_RPC.invalidRequest,
        'this endpoint answers application/json only',
      );
    }

    const raw = await c.req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return rpcError(c, 413, null, JSON_RPC.invalidRequest, 'that request body is too large');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw) as unknown;
    } catch {
      return rpcError(c, 400, null, JSON_RPC.parseError, 'the request body is not valid JSON');
    }

    const message = parseMessage(parsedJson);

    if (message.kind === 'invalid') {
      return rpcError(c, 400, message.id, JSON_RPC.invalidRequest, message.reason);
    }

    if (message.kind === 'response') {
      // A client answering a request this server never sent. Accepted and
      // dropped, which is what the transport asks for.
      return c.body(null, 202);
    }

    const requirement = options.server.requirementFor(message.message);

    const decision = await options.authorizer.authorize({
      scope: requirement.scope,
      method: 'POST',
      path: MCP_PATH,
      stateChanging: requirement.stateChanging,
      header: (name: string) => c.req.header(name),
    });

    if (!decision.ok) {
      for (const [name, value] of Object.entries(decision.error.headers ?? {})) {
        c.header(name, value);
      }
      return rpcError(
        c,
        decision.error.status,
        message.kind === 'request' ? message.message.id : null,
        JSON_RPC.requestRefused,
        decision.error.message,
      );
    }

    if (!holdsScope(decision.identity, requirement.scope)) {
      return rpcError(
        c,
        403,
        message.kind === 'request' ? message.message.id : null,
        JSON_RPC.requestRefused,
        `this credential does not hold the ${requirement.scope} scope`,
      );
    }

    const context = {
      services: options.services,
      identity: decision.identity,
      now: options.now(),
      correlationId,
    };

    try {
      const response = await options.server.handle(message.message, context);
      // A notification is answered with 202 and no body, per the transport.
      if (response === undefined) return c.body(null, 202);
      return c.json(response, 200);
    } catch (error) {
      // `server.ts` turns an expected refusal into a result and an unexpected
      // failure into a JSON-RPC error, so reaching here means something outside
      // both. The caller gets the correlation id and nothing else.
      if (error instanceof ApiError && error.status < 500) {
        return rpcError(
          c,
          error.status,
          message.kind === 'request' ? message.message.id : null,
          JSON_RPC.requestRefused,
          error.message,
        );
      }
      options.logger.error('the MCP endpoint failed outside a tool', { error, correlationId });
      return rpcError(
        c,
        500,
        message.kind === 'request' ? message.message.id : null,
        JSON_RPC.internalError,
        `the request could not be completed (correlation ${correlationId})`,
      );
    }
  });
}
