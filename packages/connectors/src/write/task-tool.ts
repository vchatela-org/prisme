import type { CalendarDate, TaskPriority } from '@prisme/domain';
import { ConnectorError } from '../errors.js';
import {
  createCommandSender,
  createdId,
  DEFAULT_TASK_TOOL_BASE_URL,
  type CommandArgs,
  type CommandSenderOptions,
} from './command.js';
import type {
  AnchorDraft,
  IdempotencyKey,
  TaskLocation,
  TaskPatch,
  TaskToolWriter,
} from './types.js';

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
 * which is what makes a retry after a timeout safe. The sending, the parsing
 * and the redaction of the tool's error prose live in `./command.ts`, shared
 * with W15's creating writer.
 */

export { DEFAULT_TASK_TOOL_BASE_URL };

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

export type TaskToolWriterOptions = CommandSenderOptions;

function deadlineArg(deadline: CalendarDate | null): { date: string } | null {
  return deadline === null ? null : { date: deadline };
}

export function createTaskToolWriter(options: TaskToolWriterOptions): TaskToolWriter {
  const command = createCommandSender(options);

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

      return { externalId: createdId(response, key, operation) };
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
