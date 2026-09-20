import type { IdempotencyKey } from '../types.js';
import type { CreationWriter, LooseTaskDraft, ProjectDraft, SectionDraft } from './types.js';

/**
 * A creating writer that records what it was asked to make and makes nothing.
 *
 * The same reasoning as `../recording.ts`: the assertions that matter are
 * *which* creations were attempted, in what order and under which idempotency
 * keys, and none of them needs a network.
 *
 * `failOn` is what the partial-failure test is built from, and that test is in
 * the definition of done — "a simulated failure partway through project
 * creation leaves a recoverable state, not orphans in one tool". Failing the
 * third of five sections is the only way to observe that the ledger's earlier
 * rows were committed before the failure rather than rolled back with it.
 */

export type RecordedCreation =
  | { readonly kind: 'project'; readonly draft: ProjectDraft; readonly key: IdempotencyKey }
  | { readonly kind: 'section'; readonly draft: SectionDraft; readonly key: IdempotencyKey }
  | { readonly kind: 'task'; readonly draft: LooseTaskDraft; readonly key: IdempotencyKey };

export interface RecordingCreationWriter {
  readonly writer: CreationWriter;
  readonly creations: readonly RecordedCreation[];
}

export interface RecordingCreationWriterOptions {
  /** Ids handed back, in order. Defaults to `made-1`, `made-2`, … */
  readonly createdIds?: readonly string[] | undefined;
  /** Throws instead of recording. The partial-failure test's whole mechanism. */
  readonly failOn?: ((creation: RecordedCreation) => boolean) | undefined;
  /**
   * Ids returned for a key that has been seen before, standing in for the
   * tool's own idempotency: a resend of a command it already applied.
   */
  readonly replayById?: boolean | undefined;
}

export function createRecordingCreationWriter(
  options: RecordingCreationWriterOptions = {},
): RecordingCreationWriter {
  const creations: RecordedCreation[] = [];
  const byKey = new Map<IdempotencyKey, string>();
  let made = 0;

  const record = (creation: RecordedCreation): { externalId: string } => {
    if (options.failOn?.(creation) === true) {
      throw new Error('the recording creation writer was configured to fail on this creation');
    }

    // The tool recognises a key it has already applied and returns the object
    // it made the first time. Modelling that here is the only way a test can
    // show that a retry does not double-create.
    const replayed = options.replayById === true ? byKey.get(creation.key) : undefined;
    if (replayed !== undefined) {
      creations.push(creation);
      return { externalId: replayed };
    }

    creations.push(creation);
    made += 1;
    const id = options.createdIds?.[made - 1] ?? `made-${String(made)}`;
    byKey.set(creation.key, id);
    return { externalId: id };
  };

  return {
    creations,
    writer: {
      createProject(draft, key) {
        return Promise.resolve(record({ kind: 'project', draft, key }));
      },
      createSection(draft, key) {
        return Promise.resolve(record({ kind: 'section', draft, key }));
      },
      createLooseTask(draft, key) {
        return Promise.resolve(record({ kind: 'task', draft, key }));
      },
    },
  };
}
