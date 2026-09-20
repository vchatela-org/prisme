/**
 * The creating write path (W15).
 *
 * A directory of its own inside `write/`, for the reason the package's
 * CLAUDE.md gives for `write/` itself: a module that can change a real task
 * list is worth being able to find by name in a review, and a module that can
 * *add* to one is worth finding faster still.
 *
 * Re-exported from `../index.ts` rather than being a third entry point — the
 * import that matters is `@prisme/connectors/write`, and splitting it further
 * would suggest there is a way to create without holding the write path.
 */

export type { CreationWriter, LooseTaskDraft, ProjectDraft, SectionDraft } from './types.js';

export { createTaskToolCreationWriter, type CreationWriterOptions } from './task-tool.js';

export { createFrozenCreationWriter } from './frozen.js';

export {
  createRecordingCreationWriter,
  type RecordedCreation,
  type RecordingCreationWriter,
  type RecordingCreationWriterOptions,
} from './recording.js';
