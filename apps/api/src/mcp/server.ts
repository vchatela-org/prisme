import { z } from 'zod';
import type { Logger } from '@prisme/observability';
import { ConfirmationRejection, hashPlan, type ConfirmationService } from '../auth/confirmation.js';
import { CONFIRMATION_TTL_SECONDS } from '../auth/confirmation.js';
import { ApiError } from '../http/errors.js';
import { holdsScope, type Identity } from '../http/authorize.js';
import type { Scope } from '../http/scopes.js';
import type { Services } from '../services/index.js';
import {
  failure,
  JSON_RPC,
  PROTOCOL_VERSION,
  success,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol.js';
import { countCreates, type McpTool, type ToolPlan } from './tool.js';
import { toolManifest, type ToolDescriptor } from './manifest.js';

/**
 * The dispatcher: five methods, and the one that matters.
 *
 * Four of them — `initialize`, `ping`, `tools/list`, the notifications — are
 * bookkeeping. `tools/call` is the surface the threat model is about, and the
 * order it does things in is the design:
 *
 * ```
 *   1  find the tool            unknown name is a protocol error, not a refusal
 *   2  parse the arguments      Zod, strict, before a service sees anything
 *   3  read tool?               run it and answer
 *   4  write tool: plan         no writes; read the world into the diff
 *   5  no confirmation?         hand back the diff and a token bound to it. Stop
 *   6  confirmation?            re-derive the plan, verify against *this* hash
 *   7  execute                  only now, and only the plan that was confirmed
 * ```
 *
 * Step 6 is the control. The plan is computed again, from the world as it is at
 * execution time, and the token is checked against a hash of *that* — so a
 * confirmation cannot authorise a diff its holder never saw, and cannot be
 * replayed after the world has moved. It is single-use and consumed atomically
 * by `auth/confirmation.ts`, which is W14's and not reinvented here.
 *
 * ### Two kinds of error, deliberately
 *
 * MCP separates *protocol* errors from *tool execution* errors, and the
 * distinction is not cosmetic for an agent. A malformed call is a JSON-RPC
 * error: the agent sent something wrong and should not retry it unchanged. A
 * refused promotion, a stale confirmation, a missing initiative is a result with
 * `isError: true`: the call was well-formed, the answer is no, and the sentence
 * explaining it is something the agent can act on. An agent that cannot tell
 * those apart retries the first one forever.
 */

export const SERVER_INFO = {
  name: 'prisme',
  title: 'prisme — the decision layer',
  version: '1',
} as const;

/**
 * Shown to an agent once, at initialization. It is the only place to say the
 * things that are true of every tool rather than of one.
 */
export const INSTRUCTIONS = [
  'prisme is the decision layer between a document tool (thinking) and a task tool (doing). It decides what to work on; it does not hold the notes or the tasks.',
  '',
  'Four rules govern every answer here:',
  '- Capacity is allocated to areas first, and only then is work ranked *within* an area. Comparing two scores from different areas is meaningless.',
  '- Only initiatives are scored. Tasks inherit from their initiative and never carry a score of their own.',
  '- A deadline prioritises; a date plans. prisme writes `deadline` and never writes `due`.',
  '- Weights are scoped to a year. There is no current weight, only the weight in force for a given year.',
  '',
  'Every tool that writes is a dry run unless you send a `confirmationToken`. Call it once to see the diff, show that diff to a human, then call it again with the token it returned. The token is bound to the exact diff: if anything it described has changed, it is refused and you should read the new diff rather than retrying.',
].join('\n');

/** The scope a protocol-level method needs: the manifest is metadata about the API. */
export const PROTOCOL_SCOPE: Scope = 'read:meta';

export interface McpServerOptions {
  readonly tools: readonly McpTool[];
  /**
   * W14's mechanism. **Absent means no write tool can execute** — the dispatcher
   * refuses rather than falling back, because the fallback from "cannot issue a
   * confirmation" to "proceed without one" is the whole control removing itself.
   */
  readonly confirmations: ConfirmationService | undefined;
  readonly logger: Logger;
}

export interface CallContext {
  readonly services: Services;
  readonly identity: Identity;
  readonly now: Date;
  readonly correlationId: string;
}

/**
 * What a message needs before it may be dispatched.
 *
 * Read by `mount.ts` *before* authentication, because the authorizer takes the
 * scope as an argument — that is how W14's kill switch reaches a tool written
 * today without W06 writing a check for it (`auth/write-switch.ts`).
 */
export interface Requirement {
  readonly scope: Scope;
  /**
   * Drives the origin check and which rate-limit bucket applies. True for
   * anything needing a write or admin scope — including `plan_preview`, which
   * changes nothing but does reach the external tools.
   */
  readonly stateChanging: boolean;
  /** The tool this message names, when it names one that exists. */
  readonly tool: McpTool | undefined;
}

const callParams = z.object({
  name: z.string().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export interface McpServer {
  requirementFor(message: JsonRpcRequest | JsonRpcNotification): Requirement;
  /** `undefined` for a notification: accepted, nothing to answer. */
  handle(
    message: JsonRpcRequest | JsonRpcNotification,
    context: CallContext,
  ): Promise<JsonRpcResponse | undefined>;
  /** Every tool, unfiltered. The machine-readable manifest the contract promises. */
  manifest(): readonly ToolDescriptor[];
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));
  if (byName.size !== options.tools.length) {
    // A duplicate name means one of the two is unreachable, and which one
    // depends on array order. That is not something to discover at runtime.
    throw new Error('two MCP tools share a name');
  }
  const descriptors = toolManifest(options.tools);

  function requirementFor(message: JsonRpcRequest | JsonRpcNotification): Requirement {
    if (message.method !== 'tools/call') {
      return { scope: PROTOCOL_SCOPE, stateChanging: false, tool: undefined };
    }
    const parsed = callParams.safeParse(message.params ?? {});
    const tool = parsed.success ? byName.get(parsed.data.name) : undefined;
    if (tool === undefined) {
      // An unnameable or unknown tool is answered, not authorized — but the
      // caller still has to be somebody, so it takes the protocol scope.
      return { scope: PROTOCOL_SCOPE, stateChanging: false, tool: undefined };
    }
    return {
      scope: tool.scope,
      stateChanging: tool.scope.startsWith('write:') || tool.scope.startsWith('admin:'),
      tool,
    };
  }

  async function call(message: JsonRpcRequest, context: CallContext): Promise<JsonRpcResponse> {
    const parsed = callParams.safeParse(message.params ?? {});
    if (!parsed.success) {
      return failure(
        message.id,
        JSON_RPC.invalidParams,
        'tools/call takes a tool `name` and an `arguments` object',
      );
    }

    const tool = byName.get(parsed.data.name);
    if (tool === undefined) {
      return failure(message.id, JSON_RPC.invalidParams, `Unknown tool: ${parsed.data.name}`);
    }

    const rawArguments = { ...parsed.data.arguments };
    const checked = tool.input.safeParse(rawArguments);
    if (!checked.success) {
      return failure(message.id, JSON_RPC.invalidParams, `invalid arguments for ${tool.name}`, {
        fields: checked.error.issues.map((issue) => ({
          field: issue.path.length === 0 ? '(arguments)' : issue.path.join('.'),
          reason: issue.message,
        })),
      });
    }

    try {
      const result =
        tool.kind === 'read'
          ? await tool.run(checked.data, context)
          : await runWrite(tool, checked.data, context);
      return success(message.id, toolResult(tool, result, options.logger, context.correlationId));
    } catch (error) {
      if (error instanceof ApiError || error instanceof ConfirmationRejection) {
        // Well-formed call, answer is no. The sentence was written to be read.
        return success(message.id, errorResult(error.message));
      }
      options.logger.error('an MCP tool failed', {
        tool: tool.name,
        error,
        correlationId: context.correlationId,
      });
      return failure(
        message.id,
        JSON_RPC.internalError,
        `the call could not be completed (correlation ${context.correlationId})`,
      );
    }
  }

  /**
   * The dry-run / confirm cycle, for one write tool.
   *
   * Note what is *not* here: no branch that executes without a confirmation, and
   * no branch that trusts a token without re-deriving the plan. Both would be
   * shorter and both would delete the control.
   */
  async function runWrite(
    tool: McpTool & { kind: 'write' },
    input: unknown,
    context: CallContext,
  ): Promise<unknown> {
    const token = (input as { confirmationToken?: unknown }).confirmationToken;
    // Removed before the plan is derived *and* before it is hashed: the token is
    // how the caller refers to a plan, never part of what the plan describes.
    const argumentsWithoutToken = { ...(input as Record<string, unknown>) };
    delete argumentsWithoutToken['confirmationToken'];

    const plan = normalise(await tool.plan(input, context));
    const diffHash = hashPlan({
      tool: tool.name,
      // Bound to the arguments as well as the diff. Two tools can produce the
      // same diff from different requests, and a confirmation that did not say
      // which request it came from would be transferable between them.
      arguments: argumentsWithoutToken,
      plan,
    });

    const envelope = {
      tool: tool.name,
      plan: { ...plan, creates: countCreates(plan.changes) },
    };

    if (token === undefined) {
      if (plan.changes.length === 0) {
        // Nothing to confirm. Issuing a token here would teach a caller that an
        // empty diff is something to go and execute.
        return { ...envelope, applied: false, confirmation: null, result: null };
      }

      if (options.confirmations === undefined) {
        throw new ApiError(
          'locked',
          'this instance has no confirmation service configured, so no write tool can be executed',
        );
      }

      const issued = await options.confirmations.issue({
        operation: `mcp:${tool.name}`,
        diffHash,
        subject: context.identity.subject,
      });

      return {
        ...envelope,
        applied: false,
        confirmation: {
          token: issued.token,
          expiresAt: issued.expiresAt.toISOString(),
          expiresInSeconds: CONFIRMATION_TTL_SECONDS,
        },
        result: null,
      };
    }

    if (typeof token !== 'string') {
      throw new ApiError(
        'invalid_request',
        'confirmationToken must be the string the dry run returned',
      );
    }
    if (options.confirmations === undefined) {
      throw new ApiError(
        'locked',
        'this instance has no confirmation service configured, so no write tool can be executed',
      );
    }

    // Throws on stale, consumed, expired, or a different principal. The plan
    // just re-derived above is the one it is checked against.
    const record = await options.confirmations.verify(token, diffHash, context.identity.subject);

    const result = await tool.execute(input, plan, context);

    // The durable audit line. The event log records the actor *kind* — its
    // column is a three-value check constraint — so the subject that executed
    // a tool lives on the consumed confirmation row, which names the operation,
    // the subject and the diff it authorised.
    options.logger.info('an MCP write was executed', {
      tool: tool.name,
      subject: context.identity.subject,
      identityKind: context.identity.kind,
      confirmationId: record.id,
      changes: plan.changes.length,
      creates: countCreates(plan.changes),
      correlationId: context.correlationId,
    });

    return { ...envelope, applied: true, confirmation: null, result };
  }

  return {
    requirementFor,
    manifest: () => descriptors,

    async handle(message, context): Promise<JsonRpcResponse | undefined> {
      if (!('id' in message)) {
        // Notifications. `initialized` and `cancelled` are the two a tools-only
        // server sees; neither needs anything done, and both are accepted
        // rather than refused so a conforming client is not told it is wrong.
        return undefined;
      }

      switch (message.method) {
        case 'initialize':
          return success(message.id, {
            protocolVersion: PROTOCOL_VERSION,
            // `tools` only. No resources, prompts, sampling or logging: a
            // capability declared and not implemented is a client making calls
            // that fail (ADR-0024).
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          });

        case 'ping':
          return success(message.id, {});

        case 'tools/list':
          // Filtered to what this credential may actually call. A read-only
          // agent that cannot see the write tools cannot spend a turn trying
          // one — and the manifest stops being a map of what to attempt.
          return success(message.id, {
            tools: descriptors
              .filter((descriptor) => holdsScope(context.identity, descriptor.scope))
              .map((descriptor) => descriptor.tool),
          });

        case 'tools/call':
          return call(message, context);

        default:
          return failure(
            message.id,
            JSON_RPC.methodNotFound,
            `prisme's MCP server implements tools only; it does not implement ${message.method}`,
          );
      }
    },
  };
}

function normalise(plan: ToolPlan): {
  summary: string;
  changes: readonly ToolPlan['changes'][number][];
  warnings: readonly string[];
} {
  // `warnings` is optional on the definition and must not be optional in the
  // hash: `{warnings: undefined}` and `{}` canonicalise identically today, and
  // relying on that is how a plan silently changes shape later.
  return { summary: plan.summary, changes: plan.changes, warnings: plan.warnings ?? [] };
}

/**
 * A tool's answer, in MCP's shape.
 *
 * The result is parsed against the tool's own output schema first — the same
 * discipline `http/mount.ts` applies to every REST response, and for the same
 * reason: "return DTOs, never database rows" decays quietly, and a field the
 * contract does not describe must not be able to reach an agent's context even
 * if a handler produces one. It is also a promise the protocol makes on our
 * behalf, since `outputSchema` is advertised: *servers MUST provide structured
 * results that conform to this schema*.
 */
function toolResult(
  tool: McpTool,
  value: unknown,
  logger: Logger,
  correlationId: string,
): Record<string, unknown> {
  const checked = tool.output.safeParse(value);
  if (!checked.success) {
    logger.error('an MCP tool returned a value its own output schema refused', {
      tool: tool.name,
      issues: checked.error.issues.map((issue) => issue.path.join('.')),
      correlationId,
    });
    return errorResult(
      `the tool produced a result prisme could not describe (correlation ${correlationId})`,
    );
  }

  const structured = checked.data as Record<string, unknown>;
  return {
    // Both, as the specification asks: a client that reads `structuredContent`
    // gets the object, and one that reads `content` gets the same thing as text.
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: structured,
    isError: false,
  };
}

function errorResult(message: string): Record<string, unknown> {
  return { content: [{ type: 'text', text: message }], isError: true };
}
