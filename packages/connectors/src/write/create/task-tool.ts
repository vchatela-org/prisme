import { createCommandSender, createdId, type CommandSenderOptions } from '../command.js';
import type { IdempotencyKey } from '../types.js';
import type { CreationWriter, LooseTaskDraft, ProjectDraft, SectionDraft } from './types.js';

/**
 * The live creating writer for the task tool.
 *
 * Three commands, one request each, through the same sender the reconciler's
 * writer uses — so the idempotency-key assertion, the "no status was reported"
 * check and the redaction of the tool's error prose are the same code and not
 * a second implementation of the same intentions.
 *
 * Each command's `temp_id` is the idempotency key, as `createTask` does it: the
 * tool reads the two from different fields, both must be UUID-shaped, and both
 * must survive a retry unchanged. Here that matters more than it does in a
 * reconciler pass — the key comes out of `creation_intent` and is the *same*
 * key on every attempt for the lifetime of the intent, so a retry after a
 * timeout that had in fact succeeded gets the original id back rather than a
 * second object.
 */

export type CreationWriterOptions = CommandSenderOptions;

export function createTaskToolCreationWriter(options: CreationWriterOptions): CreationWriter {
  const command = createCommandSender(options);

  return {
    async createProject(draft: ProjectDraft, key: IdempotencyKey) {
      const operation = 'create project';
      const response = await command(
        'project_add',
        key,
        {
          name: draft.name,
          ...(draft.parentId === undefined ? {} : { parent_id: draft.parentId }),
        },
        operation,
        key,
      );
      return { externalId: createdId(response, key, operation) };
    },

    async createSection(draft: SectionDraft, key: IdempotencyKey) {
      const operation = 'create section';
      const response = await command(
        'section_add',
        key,
        {
          name: draft.name,
          project_id: draft.projectId,
          section_order: draft.order,
        },
        operation,
        key,
      );
      return { externalId: createdId(response, key, operation) };
    },

    async createLooseTask(draft: LooseTaskDraft, key: IdempotencyKey) {
      const operation = 'create capture task';
      const response = await command(
        'item_add',
        key,
        {
          content: draft.content,
          description: draft.description,
          project_id: draft.projectId,
          ...(draft.sectionId === undefined ? {} : { section_id: draft.sectionId }),
          labels: [...draft.labels],
          // No `priority` and no `deadline`, because `LooseTaskDraft` has
          // neither. A capture inherits the tool's own default, which is what
          // "it stays a task" means in the one place it has to be true.
        },
        operation,
        key,
      );
      return { externalId: createdId(response, key, operation) };
    },
  };
}
