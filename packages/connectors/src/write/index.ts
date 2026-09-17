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

export {
  createRecordingWriter,
  type RecordedWrite,
  type RecordingWriter,
  type RecordingWriterOptions,
} from './recording.js';
