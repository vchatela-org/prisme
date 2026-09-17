import type { CalendarDate, TaskPriority } from '@prisme/domain';
import { ConnectorError } from '../errors.js';
import { executeJson, type RequestOptions } from '../http/request.js';
import type { RetryPolicy } from '../http/backoff.js';
import { createRefusingTransport, type Transport } from '../http/transport.js';
import type { ConnectorMetrics } from '../metrics.js';
import { parseOrThrow } from '../parse.js';
import { trimTrailing } from '../util/trim.js';
import { isUuid } from './idempotency.js';
import type {
  AnchorDraft,
  IdempotencyKey,
  TaskLocation,
  TaskPatch,
  TaskToolWriter,
} from './types.js';
import { wireCommandResponseSchema } from './wire.js';

/**
 * The live task-tool writer.
 *
 * One command per request. Batching would be fewer round trips and is
 * deliberately not done: at this cadence the saving is nothing, and a batch
 * turns a partial failure into a question about which half applied. Every
 * action in a plan is independent and idempotent (docs/16-sync.md §6), so the
 * expensive property to keep is *attributability*, not throughput.
 *
 * Each command carries prisme's idempotency key as the tool's command `uuid`,
 * which is what makes a retry after a timeout safe.
 */

export const DEFAULT_TASK_TOOL_BASE_URL = 'https://api.todoist.com';

/**
 * prisme's vocabulary → the tool's. The inverse of the read mapping, which
 * counts *up* to most urgent; `map.test.ts`-adjacent round-trip coverage in
 * `task-tool.test.ts` is what keeps the two tables honest.
 */
const WIRE_VALUE_BY_PRIORITY: Readonly<Record<TaskPriority, number>> = {
  highest: 4,
  high: 3,
  medium: 2,
  lowest: 1,
};

export interface TaskToolWriterOptions {
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

type CommandArgs = Record<string, unknown>;

function deadlineArg(deadline: CalendarDate | null): { date: string } | null {
  return deadline === null ? null : { date: deadline };
}

export function createTaskToolWriter(options: TaskToolWriterOptions): TaskToolWriter {
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

  /**
   * Sends one command and returns the parsed response.
   *
   * A command the tool reports as failed throws with the error *code* and never
   * the error *text*: the tool quotes the task's own content back, and that is
   * instance data (packages/connectors/src/errors.ts).
   */
  async function command(
    type: string,
    key: IdempotencyKey,
    args: CommandArgs,
    operation: string,
    tempId?: string,
  ) {
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
  }

  return {
    async createTask(draft: AnchorDraft, key: IdempotencyKey) {
      const operation = 'create anchor';
      // The temporary id and the command id are the same derived value: both
      // must be UUID-shaped, both must survive a retry unchanged, and the tool
      // reads them from different fields.
      const response = await command(
        'item_add',
        key,
        {
          content: draft.content,
          description: draft.description,
          project_id: draft.projectId,
          ...(draft.sectionId === undefined ? {} : { section_id: draft.sectionId }),
          labels: [...draft.labels],
          priority: WIRE_VALUE_BY_PRIORITY[draft.priority],
          ...(draft.deadline === undefined ? {} : { deadline: deadlineArg(draft.deadline) }),
        },
        operation,
        key,
      );

      const externalId = response.temp_id_mapping?.[key];
      if (externalId === undefined) {
        throw new ConnectorError(
          'invalid_shape',
          'the tool accepted the create but returned no id for it, so the new object cannot be linked',
          { tool: 'task', operation },
        );
      }
      return { externalId };
    },

    async updateTask(externalId: string, patch: TaskPatch, key: IdempotencyKey) {
      const args: CommandArgs = { id: externalId };
      if (patch.content !== undefined) args['content'] = patch.content;
      if (patch.description !== undefined) args['description'] = patch.description;
      if (patch.labels !== undefined) args['labels'] = [...patch.labels];
      if (patch.priority !== undefined) args['priority'] = WIRE_VALUE_BY_PRIORITY[patch.priority];
      // `null` clears the deadline and `undefined` leaves it alone, so the
      // check is for the property's presence rather than its truth.
      if (patch.deadline !== undefined) args['deadline'] = deadlineArg(patch.deadline);

      if (Object.keys(args).length === 1) {
        throw new ConnectorError(
          'refused',
          'an update with no fields would be a write with no decision behind it',
          { tool: 'task', operation: 'update task' },
        );
      }

      await command('item_update', key, args, 'update task');
    },

    async moveTask(externalId: string, location: TaskLocation, key: IdempotencyKey) {
      await command(
        'item_move',
        key,
        {
          id: externalId,
          ...(location.sectionId === undefined
            ? { project_id: location.projectId }
            : { section_id: location.sectionId }),
        },
        'move task',
      );
    },
  };
}
