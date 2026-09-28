/**
 * `@prisme/connectors/write` — the outward write path (W04).
 *
 * A separate entry point from the read path, for the same reason `./testing` is
 * one: the module that can change a real task list is worth being unable to
 * import by accident, and worth being able to find by name in a review
 * (packages/connectors/CLAUDE.md, *Shape*).
 *
 * Everything the ownership matrix says prisme may write is here; everything it
 * says prisme may not is absent rather than guarded — see `types.ts`.
 */

export type {
  AnchorDraft,
  IdempotencyKey,
  TaskLocation,
  TaskPatch,
  TaskToolWriter,
} from './types.js';

export { idempotencyKey, isUuid } from './idempotency.js';

export {
  createTaskToolWriter,
  DEFAULT_TASK_TOOL_BASE_URL,
  type TaskToolWriterOptions,
} from './task-tool.js';

export { createFrozenWriter } from './frozen.js';

/** The editing half (ADR-0034): one property of an objectives-store entry. */
export {
  createDocToolEntryWriter,
  createFrozenDocumentEntryWriter,
  type DocToolEntryWriterOptions,
  type DocumentEntryWriter,
  type ObjectivePageDates,
} from './entry.js';

/** Every writer a pass holds is one of these (ADR-0031). `./audit.ts` says why at construction. */
export {
  auditCreationWriter,
  auditDocumentCreationWriter,
  auditDocumentEntryWriter,
  auditTaskToolWriter,
  type AuditOptions,
  type WriteAttempt,
  type WriteAuditSink,
} from './audit.js';

export {
  createRecordingWriter,
  type RecordedWrite,
  type RecordingWriter,
  type RecordingWriterOptions,
} from './recording.js';

export {
  createCommandSender,
  createdId,
  type CommandArgs,
  type CommandSender,
  type CommandSenderOptions,
} from './command.js';

/** The creating half (W15). `./create/index.ts` says why it is a directory. */
export {
  createDocToolCreationWriter,
  createFrozenCreationWriter,
  createFrozenDocumentCreationWriter,
  createRecordingCreationWriter,
  createRecordingDocumentCreationWriter,
  createTaskToolCreationWriter,
  type CreationWriter,
  type CreationWriterOptions,
  type DocToolCreationWriterOptions,
  type DocumentCreationWriter,
  type LooseTaskDraft,
  type PageDraft,
  type ProjectDraft,
  type RecordedCreation,
  type RecordedPageCreation,
  type RecordingCreationWriter,
  type RecordingCreationWriterOptions,
  type RecordingDocumentCreationWriter,
  type RecordingDocumentCreationWriterOptions,
  type SectionDraft,
} from './create/index.js';
