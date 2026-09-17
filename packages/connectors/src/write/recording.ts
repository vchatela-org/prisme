import type {
  AnchorDraft,
  IdempotencyKey,
  TaskLocation,
  TaskPatch,
  TaskToolWriter,
} from './types.js';

/**
 * A writer that records what it was asked to do and does nothing.
 *
 * Every test of the apply path uses this rather than a mock: the assertions
 * that matter are *which* writes were attempted, in what order, with which
 * idempotency keys — and none of them need a network, which is the rule that
 * makes the suite trustworthy (docs/16-sync.md §8).
 */

export type RecordedWrite =
  | { readonly kind: 'create'; readonly draft: AnchorDraft; readonly key: IdempotencyKey }
  | {
      readonly kind: 'update';
      readonly externalId: string;
      readonly patch: TaskPatch;
      readonly key: IdempotencyKey;
    }
  | {
      readonly kind: 'move';
      readonly externalId: string;
      readonly location: TaskLocation;
      readonly key: IdempotencyKey;
    };

export interface RecordingWriter {
  readonly writer: TaskToolWriter;
  readonly writes: readonly RecordedWrite[];
}

export interface RecordingWriterOptions {
  /** Ids handed back for creates, in order. Defaults to `created-1`, `created-2`, … */
  readonly createdIds?: readonly string[] | undefined;
  /** Throws instead of recording, for the partial-apply tests. */
  readonly failOn?: ((write: RecordedWrite) => boolean) | undefined;
}

export function createRecordingWriter(options: RecordingWriterOptions = {}): RecordingWriter {
  const writes: RecordedWrite[] = [];
  let created = 0;

  const record = (write: RecordedWrite): void => {
    if (options.failOn?.(write) === true) {
      throw new Error('the recording writer was configured to fail on this write');
    }
    writes.push(write);
  };

  return {
    writes,
    writer: {
      createTask(draft, key) {
        record({ kind: 'create', draft, key });
        created += 1;
        const id = options.createdIds?.[created - 1] ?? `created-${String(created)}`;
        return Promise.resolve({ externalId: id });
      },
      updateTask(externalId, patch, key) {
        record({ kind: 'update', externalId, patch, key });
        return Promise.resolve();
      },
      moveTask(externalId, location, key) {
        record({ kind: 'move', externalId, location, key });
        return Promise.resolve();
      },
    },
  };
}
