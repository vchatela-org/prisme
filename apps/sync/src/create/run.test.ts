import { describe, expect, it } from 'vitest';
import {
  createFrozenCreationWriter,
  createFrozenDocumentCreationWriter,
  createRecordingCreationWriter,
  createRecordingDocumentCreationWriter,
  idempotencyKey,
  type RecordedCreation,
  type RecordingDocumentCreationWriter,
} from '@prisme/connectors/write';
import type { CreationStore } from './ports.js';
import { converge } from './run.js';
import type { EntityRefs, Intent } from './types.js';

/**
 * The converge pass, end to end, in memory.
 *
 * The store is a fake here and the writer is the recording one, because what
 * these tests are about is the *sequence*: which creations are attempted, in
 * what order, and — the property the workstream exists for — what the ledger
 * says after a failure partway through.
 *
 * `store.integration.test.ts` covers the SQL. Neither needs a network.
 */

/** Derived, never a literal: a UUID literal is refused by the deny-list. */
const keyFor = (slot: string): string =>
  idempotencyKey({ runId: 'creation-intent', operation: 'create', subject: slot });

function intent(overrides: Partial<Intent> & Pick<Intent, 'id' | 'objectKind'>): Intent {
  return {
    entityKind: 'project',
    entityId: 'entity-1',
    tool: 'task',
    ordinal: 0,
    draft: {},
    idempotencyKey: keyFor(overrides.id),
    state: 'pending',
    attempts: 0,
    ...overrides,
  };
}

/**
 * A document recorder, and the page kinds an instance has bound (ADR-0025).
 *
 * Every pass needs both, so they are made once here rather than at fourteen
 * call sites. `NOTHING_ADDRESSABLE` is the default because it is the truthful
 * default: an installation that has not run `bindings` has bound nothing, and
 * a test that is not about pages should be running the pass in that state.
 */
const NOTHING_ADDRESSABLE: ReadonlySet<'initiative' | 'project'> = new Set();

function pages(): RecordingDocumentCreationWriter {
  return createRecordingDocumentCreationWriter();
}

/** An in-memory ledger that behaves as the SQL one does for these purposes. */
function fakeStore(
  initial: readonly Intent[],
  refs: ReadonlyMap<string, EntityRefs> = new Map(),
): CreationStore & { readonly rows: Map<string, Intent> } {
  const rows = new Map(initial.map((row) => [row.id, row]));
  return {
    rows,
    loadOutstanding: () => Promise.resolve([...rows.values()]),
    loadEntityRefs: () => Promise.resolve(refs),
    recordSatisfied({ intentId, externalId }) {
      const row = rows.get(intentId);
      if (row === undefined) throw new Error('no such intent');
      rows.set(intentId, {
        ...row,
        state: 'satisfied',
        externalId,
        attempts: row.attempts + 1,
      });
      return Promise.resolve();
    },
    recordFailed({ intentId }) {
      const row = rows.get(intentId);
      if (row === undefined) throw new Error('no such intent');
      rows.set(intentId, { ...row, state: 'failed', attempts: row.attempts + 1 });
      return Promise.resolve();
    },
  };
}

const PROJECT_WITH_THREE_SECTIONS: readonly Intent[] = [
  intent({ id: 'p-01', objectKind: 'project', draft: { name: 'A large effort' } }),
  intent({
    id: 's-01',
    objectKind: 'section',
    ordinal: 0,
    draft: { name: 'First', order: 0 },
    requires: 'p-01',
  }),
  intent({
    id: 's-02',
    objectKind: 'section',
    ordinal: 1,
    draft: { name: 'Second', order: 1 },
    requires: 'p-01',
  }),
  intent({
    id: 's-03',
    objectKind: 'section',
    ordinal: 2,
    draft: { name: 'Third', order: 2 },
    requires: 'p-01',
  }),
];

const NOW = (): Date => new Date('2026-09-20T10:00:00.000Z');

describe('planning a convergence', () => {
  it('writes nothing at all, so it runs under the write freeze', async () => {
    const store = fakeStore(PROJECT_WITH_THREE_SECTIONS);
    const recording = createRecordingCreationWriter();

    const result = await converge({
      mode: 'plan',
      store,
      writer: recording.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: false,
      maxPerPass: 20,
      now: NOW,
    });

    expect(recording.creations).toHaveLength(0);
    expect(result.created).toBe(0);
    expect([...store.rows.values()].every((row) => row.state === 'pending')).toBe(true);
    // Not even an attempt count moved.
    expect([...store.rows.values()].every((row) => row.attempts === 0)).toBe(true);
    expect(result.report).toContain('write freeze');
  });
});

describe('the write freeze', () => {
  /**
   * The defect a real frozen instance found. The frozen writer refuses each
   * call, so an `apply` that ran into it recorded every intent `failed` and
   * climbed every attempt counter — and the next pass did it again. A
   * correctly-frozen deployment ended up showing a ledger full of failures
   * and a CronJob red every fifteen minutes.
   *
   * A freeze is a **refusal**, not a failure, and nothing is attempted.
   */
  it('attempts nothing and records nothing, rather than failing every intent', async () => {
    const store = fakeStore(PROJECT_WITH_THREE_SECTIONS);

    const result = await converge({
      mode: 'apply',
      store,
      writer: createFrozenCreationWriter(),
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: false,
      maxPerPass: 20,
      now: NOW,
    });

    expect(result.refused).toContain('write freeze');
    expect(result.failed).toBe(0);
    expect(result.created).toBe(0);
    expect([...store.rows.values()].every((row) => row.state === 'pending')).toBe(true);
    // The counter is what a person reads as "this has been tried five times".
    expect([...store.rows.values()].every((row) => row.attempts === 0)).toBe(true);
  });

  it('says nothing was attempted, so an empty failure count is not read as success', async () => {
    const result = await converge({
      mode: 'apply',
      store: fakeStore(PROJECT_WITH_THREE_SECTIONS),
      writer: createFrozenCreationWriter(),
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: false,
      maxPerPass: 20,
      now: NOW,
    });

    expect(result.report).toContain('nothing was attempted');
  });
});

describe('a whole project, in one pass', () => {
  it('creates the project, then its sections in order, each under its new parent', async () => {
    const store = fakeStore(PROJECT_WITH_THREE_SECTIONS);
    const recording = createRecordingCreationWriter({
      createdIds: ['made-project', 'made-s0', 'made-s1', 'made-s2'],
    });

    const result = await converge({
      mode: 'apply',
      store,
      writer: recording.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    expect(result.created).toBe(4);
    expect(result.failed).toBe(0);
    expect(recording.creations.map((creation) => creation.kind)).toEqual([
      'project',
      'section',
      'section',
      'section',
    ]);
    // Every section landed under the project this pass made, which is only
    // possible because the plan is recomputed after each outcome.
    for (const creation of recording.creations.slice(1)) {
      expect(creation.kind === 'section' && creation.draft.projectId).toBe('made-project');
    }
  });

  it('is a no-op on a second run, because every intent is satisfied', async () => {
    const store = fakeStore(PROJECT_WITH_THREE_SECTIONS);
    const first = createRecordingCreationWriter();
    await converge({
      mode: 'apply',
      store,
      writer: first.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    const second = createRecordingCreationWriter();
    const result = await converge({
      mode: 'apply',
      store,
      writer: second.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    expect(second.creations).toHaveLength(0);
    expect(result.created).toBe(0);
  });
});

describe('a failure partway through', () => {
  /**
   * The definition of done: *a simulated failure partway through project
   * creation leaves a recoverable state, not orphans in one tool.*
   *
   * The second section fails. What must be true afterwards: the project and
   * the first section are recorded with the ids they got, the failure is
   * recorded, and nothing was rolled back — because rolling back would mean
   * deleting real objects, which prisme never does.
   */
  it('keeps what worked, records what did not, and rolls nothing back', async () => {
    const store = fakeStore(PROJECT_WITH_THREE_SECTIONS);
    const recording = createRecordingCreationWriter({
      createdIds: ['made-project', 'made-s0'],
      failOn: (creation: RecordedCreation) =>
        creation.kind === 'section' && creation.draft.name === 'Second',
    });

    const result = await converge({
      mode: 'apply',
      store,
      writer: recording.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    expect(store.rows.get('p-01')).toMatchObject({
      state: 'satisfied',
      externalId: 'made-project',
    });
    expect(store.rows.get('s-01')).toMatchObject({ state: 'satisfied', externalId: 'made-s0' });
    expect(store.rows.get('s-02')).toMatchObject({ state: 'failed', attempts: 1 });
    // The pass continued: a sibling's failure does not block an independent step.
    expect(store.rows.get('s-03')).toMatchObject({ state: 'satisfied' });
    expect(result.created).toBe(3);
    expect(result.failed).toBe(1);
  });

  /**
   * Resuming is the other half. The next pass attempts only what is still
   * outstanding — and it sends the *same idempotency key*, which is what makes
   * a retry of a write that in fact succeeded return the original object.
   */
  it('resumes with only what is outstanding, under the key it always carried', async () => {
    const store = fakeStore(PROJECT_WITH_THREE_SECTIONS);
    const firstKey = store.rows.get('s-02')?.idempotencyKey;

    await converge({
      mode: 'apply',
      store,
      writer: createRecordingCreationWriter({
        failOn: (creation) => creation.kind === 'section' && creation.draft.name === 'Second',
      }).writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    const retry = createRecordingCreationWriter();
    const result = await converge({
      mode: 'apply',
      store,
      writer: retry.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    expect(retry.creations).toHaveLength(1);
    expect(retry.creations[0]?.key).toBe(firstKey);
    expect(result.created).toBe(1);
  });

  /**
   * The tool recognises a key it already applied and hands back what it made
   * the first time. That is the case the stored key exists for: the writer
   * succeeded and the process died before the ledger heard about it.
   */
  it('a retry of a write that in fact succeeded binds the original object', async () => {
    const store = fakeStore([PROJECT_WITH_THREE_SECTIONS[0] as Intent]);
    const tool = createRecordingCreationWriter({ replayById: true, createdIds: ['made-once'] });

    // First pass: the write lands, and the recording of it is lost.
    const step = (await store.loadOutstanding())[0] as Intent;
    await tool.writer.createProject({ name: 'A large effort' }, step.idempotencyKey);

    // Second pass: the ledger still says pending, so it sends again.
    const result = await converge({
      mode: 'apply',
      store,
      writer: tool.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    expect(result.created).toBe(1);
    expect(store.rows.get('p-01')?.externalId).toBe('made-once');
    // Two commands sent, one object made.
    expect(tool.creations).toHaveLength(2);
  });

  /**
   * A writer that refuses while writes are *enabled* is a real failure — a
   * revoked token, a refused command — and it is recorded with the
   * connector's own redacted message: tool, operation and an error code,
   * never the tool's prose, which quotes the object's own content back.
   */
  it('records a connector refusal without repeating the tool’s prose', async () => {
    const store = fakeStore([PROJECT_WITH_THREE_SECTIONS[0] as Intent]);
    const refusing = createFrozenCreationWriter('the integration token was revoked');

    const result = await converge({
      mode: 'apply',
      store,
      writer: refusing,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    expect(result.failed).toBe(1);
    expect(result.outcomes[0]?.reason).toContain('create project');
    expect(result.outcomes[0]?.reason).not.toContain('Renovate');
    expect(store.rows.get('p-01')?.state).toBe('failed');
  });
});

describe('the per-pass cap', () => {
  /**
   * A ledger with hundreds of intents means something upstream is wrong, and
   * draining it silently turns that bug into hundreds of objects in a real
   * workspace. The same instinct as `SYNC_CREATE_THRESHOLD`, applied to a
   * queue rather than to a diff.
   */
  it('stops at the cap and says to run again', async () => {
    const store = fakeStore(PROJECT_WITH_THREE_SECTIONS);
    const recording = createRecordingCreationWriter();

    const result = await converge({
      mode: 'apply',
      store,
      writer: recording.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 2,
      now: NOW,
    });

    expect(result.created).toBe(2);
    expect(result.stopped).toContain('run again');
    expect(recording.creations).toHaveLength(2);
  });
});

describe('a capture’s task', () => {
  it('is created as a loose task with no priority and no anchor label', async () => {
    const store = fakeStore([
      intent({
        id: 't-01',
        objectKind: 'task',
        entityKind: 'capture',
        entityId: 'capture-1',
        draft: {
          projectId: 'ext-project',
          sectionId: 'ext-section',
          content: 'Something small',
          description: 'prisme: https://prisme.example/capture/capture-1',
          labels: ['prisme-capture'],
        },
      }),
    ]);
    const recording = createRecordingCreationWriter();

    await converge({
      mode: 'apply',
      store,
      writer: recording.writer,
      documents: pages().writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    const creation = recording.creations[0];
    expect(creation?.kind).toBe('task');
    expect(creation?.kind === 'task' && creation.draft.labels).toEqual(['prisme-capture']);
    expect(creation?.draft).not.toHaveProperty('priority');
  });
});

describe('a page', () => {
  const pageIntent = () =>
    intent({
      id: 'pg-01',
      entityKind: 'project',
      objectKind: 'page',
      tool: 'document',
      draft: { title: 'A narrative' },
    });

  it('is not attempted on an instance that has bound nothing, and the report says why', async () => {
    const store = fakeStore([pageIntent()]);
    const recording = createRecordingCreationWriter();
    const docPages = pages();

    const result = await converge({
      mode: 'apply',
      store,
      writer: recording.writer,
      documents: docPages.writer,
      addressablePageKinds: NOTHING_ADDRESSABLE,
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    expect(recording.creations).toHaveLength(0);
    expect(docPages.pages).toHaveLength(0);
    expect(result.created).toBe(0);
    // Blocked, not failed: nothing was attempted, so nothing can be retried
    // into working, and the ledger row stays pending rather than claiming an
    // attempt that never happened.
    expect(store.rows.get('pg-01')?.state).toBe('pending');
    // The reason names the command that fixes it, not the ADR that explains it.
    expect(result.report).toContain('bindings --from');
  });

  it('is created once the store and the template are bound', async () => {
    const store = fakeStore([pageIntent()]);
    const recording = createRecordingCreationWriter();
    const docPages = pages();

    const result = await converge({
      mode: 'apply',
      store,
      writer: recording.writer,
      documents: docPages.writer,
      addressablePageKinds: new Set(['project']),
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    });

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    expect(docPages.pages).toHaveLength(1);
    // The draft carries a kind and a title and nothing else: the store and the
    // template are prisme's decision, made in `PAGE_ROLE_FOR`.
    expect(docPages.pages[0]?.draft).toEqual({ kind: 'project', title: 'A narrative' });
    // The task-tool writer was not asked to make anything.
    expect(recording.creations).toHaveLength(0);
    // And the ledger records what was made, which is what stops a second page.
    expect(store.rows.get('pg-01')?.state).toBe('satisfied');
    expect(store.rows.get('pg-01')?.externalId).toBe('made-page-1');
  });

  it('does not make a second page when the pass resumes over a satisfied row', async () => {
    // The document tool has no idempotency key, so this is the property the
    // whole creation is safe on: the ledger says a page was made, and the next
    // pass does not ask again.
    const store = fakeStore([pageIntent()]);
    const docPages = pages();
    const options = {
      mode: 'apply' as const,
      store,
      writer: createRecordingCreationWriter().writer,
      documents: docPages.writer,
      addressablePageKinds: new Set(['project'] as const),
      writeEnabled: true,
      maxPerPass: 20,
      now: NOW,
    };

    await converge(options);
    await converge(options);

    expect(docPages.pages).toHaveLength(1);
  });

  it('is frozen with everything else, so a misconfigured pass cannot add one', async () => {
    const store = fakeStore([pageIntent()]);
    const recording = createRecordingDocumentCreationWriter();

    const result = await converge({
      mode: 'apply',
      store,
      writer: createRecordingCreationWriter().writer,
      documents: createFrozenDocumentCreationWriter(),
      addressablePageKinds: new Set(['project']),
      writeEnabled: false,
      maxPerPass: 20,
      now: NOW,
    });

    expect(recording.pages).toHaveLength(0);
    // Frozen is a refusal, not a failure: the ledger row is untouched.
    expect(result.refused).toContain('write freeze');
    expect(store.rows.get('pg-01')?.state).toBe('pending');
  });
});
