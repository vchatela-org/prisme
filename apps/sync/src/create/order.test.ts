import { describe, expect, it } from 'vitest';
import { idempotencyKey } from '@prisme/connectors/write';
import {
  applyOutcome,
  orderConvergence,
  PAGE_KIND_UNSUPPORTED,
  PAGE_UNBOUND,
  resolveCreation,
} from './order.js';
import type { EntityRefs, Intent } from './types.js';

/**
 * Keys are derived, never written out.
 *
 * A UUID literal in this repository is refused by the privacy deny-list, and
 * rightly — the pattern cannot tell a made-up one from a real workspace
 * identifier, and W06 had the same finding about a generated manifest. Using
 * the real function is better anyway: these are the keys the ledger holds.
 */
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

const NO_REFS: ReadonlyMap<string, EntityRefs> = new Map();

/**
 * An instance that has bound none of ADR-0025's roles — the default for every
 * test that is not about pages, and the state of every fresh installation.
 */
const NOTHING_ADDRESSABLE: ReadonlySet<'initiative' | 'project'> = new Set();

describe('resolving a draft', () => {
  it('turns a project draft into a project creation', () => {
    const result = resolveCreation(
      intent({ id: 'i-1', objectKind: 'project', draft: { name: 'A large effort' } }),
      undefined,
      {},
    );
    expect(result).toEqual({ kind: 'project', draft: { name: 'A large effort' } });
  });

  it('reads a section’s parent from the prerequisite that made it', () => {
    const result = resolveCreation(
      intent({ id: 'i-2', objectKind: 'section', ordinal: 1, draft: { name: 'Second', order: 1 } }),
      'made-project',
      {},
    );
    expect(result).toEqual({
      kind: 'section',
      draft: { projectId: 'made-project', name: 'Second', order: 1 },
    });
  });

  /**
   * A linked project has no prerequisite — nothing created it — so its id is
   * on the project row rather than in the ledger.
   */
  it('reads a section’s parent from the entity when the project was linked', () => {
    const result = resolveCreation(
      intent({ id: 'i-3', objectKind: 'section', draft: { name: 'First', order: 0 } }),
      undefined,
      { externalProjectId: 'linked-project' },
    );
    expect(result).toMatchObject({ draft: { projectId: 'linked-project' } });
  });

  it('refuses a section with no project anywhere, rather than sending an empty parent', () => {
    const result = resolveCreation(
      intent({ id: 'i-4', objectKind: 'section', draft: { name: 'First' } }),
      undefined,
      {},
    );
    expect(result).toHaveProperty('error');
  });

  /**
   * The draft is `unknown` in the ledger. A shape that does not match its
   * object kind has to be an answer, not a crash halfway through a pass with
   * three sections already made.
   */
  it('refuses a draft that does not carry what its kind needs', () => {
    expect(resolveCreation(intent({ id: 'i-5', objectKind: 'project' }), undefined, {})).toEqual({
      error: 'the draft names no project',
    });
    expect(
      resolveCreation(
        intent({ id: 'i-6', objectKind: 'task', draft: { content: 'x' } }),
        undefined,
        {},
      ),
    ).toHaveProperty('error');
  });

  it('resolves a page now that ADR-0025 gives it somewhere to go', () => {
    // The draft carries a title and nothing else: the body is a copy of the
    // template's blocks, and which store and which template are prisme's
    // decisions rather than a caller's (`PAGE_ROLE_FOR`).
    expect(
      resolveCreation(
        intent({
          id: 'i-7',
          entityKind: 'initiative',
          objectKind: 'page',
          tool: 'document',
          draft: { title: 'A page' },
        }),
        undefined,
        {},
      ),
    ).toEqual({ kind: 'page', draft: { kind: 'initiative', title: 'A page' } });
  });

  it('takes the page kind from the entity, never from the draft', () => {
    // A draft field would let a caller say an initiative's page is a project's,
    // and the two have different parents and different templates.
    expect(
      resolveCreation(
        intent({
          id: 'i-8',
          entityKind: 'project',
          objectKind: 'page',
          tool: 'document',
          draft: { title: 'A page', kind: 'initiative' },
        }),
        undefined,
        {},
      ),
    ).toEqual({ kind: 'page', draft: { kind: 'project', title: 'A page' } });
  });

  it('does not resolve a capture\u2019s page, and says the vocabulary is the reason', () => {
    // A gap rather than a decision: ADR-0025 names an initiative's page and a
    // project's page and nothing between them, and guessing which of the two a
    // capture meant is the class of guess this repository refuses everywhere.
    expect(
      resolveCreation(
        intent({
          id: 'i-9',
          entityKind: 'capture',
          objectKind: 'page',
          tool: 'document',
          draft: { title: 'x' },
        }),
        undefined,
        {},
      ),
    ).toEqual({ error: PAGE_KIND_UNSUPPORTED });
  });

  it('refuses a page intent that names the task tool', () => {
    expect(
      resolveCreation(
        intent({ id: 'i-10', objectKind: 'page', tool: 'task', draft: { title: 'x' } }),
        undefined,
        {},
      ),
    ).toEqual({ error: expect.stringContaining('document-tool object') });
  });

  it('refuses a page with no title rather than creating an untitled one', () => {
    expect(
      resolveCreation(intent({ id: 'i-11', objectKind: 'page', tool: 'document' }), undefined, {}),
    ).toEqual({ error: 'the draft names no page' });
  });
});

describe('ordering a convergence', () => {
  it('leaves satisfied intents out entirely, which is what makes a re-run resume', () => {
    const plan = orderConvergence({
      intents: [
        intent({
          id: 'i-1',
          objectKind: 'project',
          state: 'satisfied',
          externalId: 'made-1',
          draft: { name: 'Done already' },
        }),
      ],
      refsByEntity: NO_REFS,
      addressablePageKinds: NOTHING_ADDRESSABLE,
    });

    expect(plan.steps).toHaveLength(0);
  });

  it('puts the project before its sections, and the sections in order', () => {
    const plan = orderConvergence({
      intents: [
        intent({
          id: 's-2',
          objectKind: 'section',
          ordinal: 1,
          draft: { name: 'B' },
          requires: 'p-1',
        }),
        intent({
          id: 's-1',
          objectKind: 'section',
          ordinal: 0,
          draft: { name: 'A' },
          requires: 'p-1',
        }),
        intent({ id: 'p-1', objectKind: 'project', draft: { name: 'Effort' } }),
      ],
      refsByEntity: NO_REFS,
      addressablePageKinds: NOTHING_ADDRESSABLE,
    });

    expect(plan.steps.map((step) => step.intent.id)).toEqual(['p-1', 's-1', 's-2']);
  });

  it('blocks a section whose project has not been created yet, and says so', () => {
    const plan = orderConvergence({
      intents: [
        intent({ id: 'p-1', objectKind: 'project', draft: { name: 'Effort' } }),
        intent({ id: 's-1', objectKind: 'section', draft: { name: 'A' }, requires: 'p-1' }),
      ],
      refsByEntity: NO_REFS,
      addressablePageKinds: NOTHING_ADDRESSABLE,
    });

    const section = plan.steps.find((step) => step.intent.id === 's-1');
    expect(section?.kind).toBe('blocked');
    expect(section?.kind === 'blocked' && section.reason).toContain('pending');
  });

  /**
   * The failure that matters most. A project whose creation failed must not
   * let its sections through — sending them with an empty parent is how three
   * orphan sections appear in a workspace nobody can find them in.
   */
  it('blocks a section whose project failed, rather than sending it parentless', () => {
    const plan = orderConvergence({
      intents: [
        intent({ id: 'p-1', objectKind: 'project', state: 'failed', draft: { name: 'Effort' } }),
        intent({ id: 's-1', objectKind: 'section', draft: { name: 'A' }, requires: 'p-1' }),
      ],
      refsByEntity: NO_REFS,
      addressablePageKinds: NOTHING_ADDRESSABLE,
    });

    expect(plan.runnable).toBe(1); // the project itself, on its next attempt
    const section = plan.steps.find((step) => step.intent.id === 's-1');
    expect(section?.kind === 'blocked' && section.reason).toContain('failed');
  });

  it('lets a section through the moment its project is satisfied', () => {
    const plan = orderConvergence({
      intents: [
        intent({
          id: 'p-1',
          objectKind: 'project',
          state: 'satisfied',
          externalId: 'made-project',
          draft: { name: 'Effort' },
        }),
        intent({ id: 's-1', objectKind: 'section', draft: { name: 'A' }, requires: 'p-1' }),
      ],
      refsByEntity: NO_REFS,
      addressablePageKinds: NOTHING_ADDRESSABLE,
    });

    expect(plan.runnable).toBe(1);
    const section = plan.steps[0];
    expect(section?.kind === 'run' && section.creation).toMatchObject({
      draft: { projectId: 'made-project' },
    });
  });

  it('blocks a page when the instance has bound no store for it', () => {
    // The state of every installation that has not run `bindings`, and the
    // sentence names the command that fixes it rather than the ADR that
    // explains it.
    const plan = orderConvergence({
      intents: [
        intent({ id: 'pg-1', objectKind: 'page', tool: 'document', draft: { title: 'x' } }),
      ],
      refsByEntity: NO_REFS,
      addressablePageKinds: NOTHING_ADDRESSABLE,
    });

    expect(plan.blocked).toBe(1);
    expect(plan.steps[0]?.kind === 'blocked' && plan.steps[0].reason).toBe(PAGE_UNBOUND);
  });

  it('runs a page once the instance has bound its store and its template', () => {
    const plan = orderConvergence({
      intents: [
        intent({
          id: 'pg-1',
          entityKind: 'initiative',
          objectKind: 'page',
          tool: 'document',
          draft: { title: 'x' },
        }),
      ],
      refsByEntity: NO_REFS,
      addressablePageKinds: new Set(['initiative']),
    });

    expect(plan.runnable).toBe(1);
    expect(plan.steps[0]?.kind).toBe('run');
  });

  it('blocks a capture\u2019s page with the vocabulary, not with the bindings', () => {
    // Binding the roles would not help a capture: the plan must say the true
    // reason, or an operator runs `bindings` twice and reports the same bug.
    const plan = orderConvergence({
      intents: [
        intent({
          id: 'pg-2',
          entityKind: 'capture',
          objectKind: 'page',
          tool: 'document',
          draft: { title: 'x' },
        }),
      ],
      refsByEntity: NO_REFS,
      addressablePageKinds: new Set(['initiative', 'project']),
    });

    expect(plan.blocked).toBe(1);
    expect(plan.steps[0]?.kind === 'blocked' && plan.steps[0].reason).toBe(PAGE_KIND_UNSUPPORTED);
  });

  it('plans the same order twice, whatever order the rows arrived in', () => {
    const intents = [
      intent({ id: 's-1', objectKind: 'section', ordinal: 0, draft: { name: 'A' } }),
      intent({ id: 's-2', objectKind: 'section', ordinal: 1, draft: { name: 'B' } }),
      intent({
        id: 't-1',
        objectKind: 'task',
        entityKind: 'capture',
        draft: { projectId: 'p', content: 'c' },
      }),
    ];
    const refs = new Map([['entity-1', { externalProjectId: 'linked' }]]);

    const first = orderConvergence({ intents, refsByEntity: refs });
    const second = orderConvergence({ intents: [...intents].reverse(), refsByEntity: refs });

    expect(first.steps.map((step) => step.intent.id)).toEqual(
      second.steps.map((step) => step.intent.id),
    );
  });
});

describe('applying an outcome', () => {
  const intents = [
    intent({ id: 'p-1', objectKind: 'project', draft: { name: 'Effort' } }),
    intent({ id: 's-1', objectKind: 'section', draft: { name: 'A' }, requires: 'p-1' }),
  ];

  it('satisfies the one that worked and leaves the rest alone', () => {
    const after = applyOutcome(intents, 'p-1', { ok: true, externalId: 'made-project' });
    expect(after[0]).toMatchObject({ state: 'satisfied', externalId: 'made-project' });
    expect(after[1]).toMatchObject({ state: 'pending' });
  });

  it('counts an attempt on the one that failed', () => {
    const after = applyOutcome(intents, 'p-1', { ok: false });
    expect(after[0]).toMatchObject({ state: 'failed', attempts: 1 });
  });
});
