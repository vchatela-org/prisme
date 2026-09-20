import { ConnectorError } from '../errors.js';
import { executeJson, type RequestOptions } from '../http/request.js';
import type { RetryPolicy } from '../http/backoff.js';
import { createRefusingTransport, type Transport } from '../http/transport.js';
import type { ConnectorMetrics } from '../metrics.js';
import { parseOrThrow } from '../parse.js';
import { trimTrailing } from '../util/trim.js';
import { isUuid } from './idempotency.js';
import type { IdempotencyKey } from './types.js';
import { wireCommandResponseSchema, type WireCommandResponse } from './wire.js';

/**
 * Sending one command to the task tool, and understanding the answer.
 *
 * This was private to `task-tool.ts` until W15 needed to create a project and
 * its sections through the same door. Two copies of it would have been two
 * copies of three things that must not diverge: the idempotency-key assertion,
 * the "the response reported no status" check, and the rule that an error's
 * *code* is surfaced and its *text* never is — the tool quotes the object's own
 * content back, and that is instance data (`../errors.ts`).
 *
 * One command per request, still. Batching would be fewer round trips and is
 * deliberately not done: at this cadence the saving is nothing, and a batch
 * turns a partial failure into a question about which half applied.
 */

export const DEFAULT_TASK_TOOL_BASE_URL = 'https://api.todoist.com';

export interface CommandSenderOptions {
  /** The integration token. Held here, logged nowhere. */
  readonly token: string;
  readonly baseUrl?: string | undefined;
  readonly transport?: Transport | undefined;
  readonly retry?: RetryPolicy | undefined;
  readonly metrics?: ConnectorMetrics | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => Date) | undefined;
}

export type CommandArgs = Record<string, unknown>;

export type CommandSender = (
  type: string,
  key: IdempotencyKey,
  args: CommandArgs,
  operation: string,
  tempId?: string,
) => Promise<WireCommandResponse>;

export function createCommandSender(options: CommandSenderOptions): CommandSender {
  const baseUrl = trimTrailing(options.baseUrl ?? DEFAULT_TASK_TOOL_BASE_URL, '/');
  const transport = options.transport ?? createRefusingTransport('task');

  const requestOptions = (operation: string): RequestOptions => ({
    tool: 'task',
    operation,
    transport,
    retry: options.retry,
    metrics: options.metrics,
    sleep: options.sleep,
    random: options.random,
    now: options.now,
  });

  return async function command(type, key, args, operation, tempId) {
    if (!isUuid(key)) {
      throw new ConnectorError(
        'refused',
        'the idempotency key is not a UUID; refusing to send a write whose retry cannot be recognised',
        { tool: 'task', operation },
      );
    }

    const form = new URLSearchParams({
      commands: JSON.stringify([
        { type, uuid: key, args, ...(tempId === undefined ? {} : { temp_id: tempId }) },
      ]),
    });

    const body = await executeJson(
      {
        method: 'POST',
        url: `${baseUrl}/sync/v9/sync`,
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
      requestOptions(operation),
    );

    const response = parseOrThrow(wireCommandResponseSchema, body, {
      tool: 'task',
      operation,
      shape: 'command response',
    });

    const status = response.sync_status[key];
    if (status === undefined) {
      throw new ConnectorError(
        'invalid_shape',
        'the response reported no status for the command that was sent, so whether it applied is unknown',
        { tool: 'task', operation },
      );
    }
    if (status !== 'ok') {
      throw new ConnectorError(
        'refused',
        `the tool refused the command with error code ${String(status.error_code)}`,
        {
          tool: 'task',
          operation,
          ...(status.http_code === undefined ? {} : { status: status.http_code }),
        },
      );
    }

    return response;
  };
}

/**
 * The id the tool assigned to the object a `create` just made.
 *
 * Its absence is an error rather than an `undefined` return, and W15 leans on
 * that harder than W04 did: a creation whose id is lost is the orphan the
 * creation ledger exists to prevent, so it must be impossible to record as a
 * success (`creation_intent.satisfied_intents_name_what_they_made`).
 */
export function createdId(
  response: WireCommandResponse,
  key: IdempotencyKey,
  operation: string,
): string {
  const externalId = response.temp_id_mapping?.[key];
  if (externalId === undefined) {
    throw new ConnectorError(
      'invalid_shape',
      'the tool accepted the create but returned no id for it, so the new object cannot be linked',
      { tool: 'task', operation },
    );
  }
  return externalId;
}
