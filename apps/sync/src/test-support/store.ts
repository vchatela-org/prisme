import type { InitiativeId } from '@prisme/domain';
import type {
  BindRefInput,
  CaptureInput,
  ReconcilerStore,
  SyncCursor,
  SyncEvent,
} from '../apply/ports.js';
import type {
  ConflictRecord,
  DesiredState,
  LastAppliedIndex,
  LastAppliedWrite,
  Rollup,
} from '../reconcile/types.js';

/**
 * An in-memory {@link ReconcilerStore}.
 *
 * Every test of the apply path runs against this rather than a database: the
 * assertions that matter are about *what was recorded and in what order*, and
 * none of them are made more true by a running PostgreSQL.
 */

export interface RecordingStore extends ReconcilerStore {
  readonly binds: readonly BindRefInput[];
  readonly captures: readonly CaptureInput[];
  readonly statuses: readonly { readonly initiativeId: InitiativeId; readonly to: string }[];
  readonly rollups: readonly { readonly initiativeId: InitiativeId; readonly rollup: Rollup }[];
  readonly lastAppliedWrites: readonly LastAppliedWrite[];
  readonly conflicts: readonly ConflictRecord[];
  readonly events: readonly SyncEvent[];
  readonly cursors: readonly SyncCursor[];
}

export function createRecordingStore(
  desired: DesiredState = { anchors: [], areaByLocation: new Map() },
  lastApplied: LastAppliedIndex = new Map(),
  cursor: SyncCursor = {},
): RecordingStore {
  const binds: BindRefInput[] = [];
  const captures: CaptureInput[] = [];
  const statuses: { initiativeId: InitiativeId; to: string }[] = [];
  const rollups: { initiativeId: InitiativeId; rollup: Rollup }[] = [];
  const lastAppliedWrites: LastAppliedWrite[] = [];
  const conflicts: ConflictRecord[] = [];
  const events: SyncEvent[] = [];
  const cursors: SyncCursor[] = [];

  return {
    binds,
    captures,
    statuses,
    rollups,
    lastAppliedWrites,
    conflicts,
    events,
    cursors,

    loadDesired: () => Promise.resolve(desired),
    loadLastApplied: () => Promise.resolve(lastApplied),
    loadCursor: () => Promise.resolve(cursor),
    saveCursor: (cursor) => {
      cursors.push(cursor);
      return Promise.resolve();
    },
    bindExternalRef: (input) => {
      binds.push(input);
      return Promise.resolve();
    },
    captureInitiative: (input) => {
      captures.push(input);
      return Promise.resolve(`init-captured-${String(captures.length)}`);
    },
    setStatus: (input) => {
      statuses.push({ initiativeId: input.initiativeId, to: input.to });
      return Promise.resolve();
    },
    recordRollup: (input) => {
      rollups.push({ initiativeId: input.initiativeId, rollup: input.rollup });
      return Promise.resolve();
    },
    recordLastApplied: (writes) => {
      lastAppliedWrites.push(...writes);
      return Promise.resolve();
    },
    recordConflict: (conflict) => {
      conflicts.push(conflict);
      return Promise.resolve();
    },
    recordEvent: (event) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}
