import { describe, expect, it } from 'vitest';
import { idempotencyKey } from '@prisme/connectors/write';
import {
  applyOutcome,
  orderConvergence,
  PAGE_CHOOSE_TEMPLATE,
  PAGE_NO_TEMPLATE,
  PAGE_TEMPLATE_GONE,
  PAGE_UNBOUND,
  resolveCreation,
  resolveTemplate,
} from './order.js';
import type { DocTemplate, PageKind } from '@prisme/connectors';
import type { EntityRefs, Intent, PageStore } from './types.js';

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
 * An instance that has bound none of ADR-0025's or ADR-0028's page stores — the
 * default for every test that is not about pages, and the state of every fresh
 * installation.
 */
const NOTHING_BOUND: ReadonlyMap<PageKind, PageStore> = new Map();

const BRIEF: DocTemplate = { id: 'tpl-brief', name: 'Brief', isDefault: false };
const NOTES: DocTemplate = { id: 'tpl-notes', name: 'Notes', isDefault: false };

/** Stores bound and read, holding these templates. */
function stores(
  entries: Partial<Record<PageKind, readonly DocTemplate[]>>,
): ReadonlyMap<PageKind, PageStore> {
  return new Map(
    Object.entries(entries).map(([kind, templates]) => [
      kind as PageKind,
      { state: 'bound', templates } satisfies PageStore,
    ]),
  );
}

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

  it('resolves a page to its kind and the template this pass resolved', () => {
    // The draft carries a title and nothing else: the body is the template's,
    // applied by the document tool, and which store and which template are
    // prisme's decisions rather than a caller's (`PAGE_ROLE_FOR`, ADR-0030).
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
        BRIEF,
      ),
    ).toEqual({
      kind: 'page',
      draft: { kind: 'initiative', title: 'A page', templateId: 'tpl-brief' },
      templateName: 'Brief',
    });
  });

  it('takes the page kind from the entity, never from the draft', () => {
    // A draft field would let a caller say an initiative's page is a project's,
    // and the two live in different databases.
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
        BRIEF,
      ),
    ).toMatchObject({ kind: 'page', draft: { kind: 'project', title: 'A page' } });
  });

  it('resolves a capture\u2019s page as its own kind, since ADR-0028', () => {
    // This used to return PAGE_KIND_UNSUPPORTED, because ADR-0025 named two
    // kinds and refused to guess which one a capture meant. The third kind is
    // its own store — that is what closes the gap, rather than routing a
    // capture through an initiative's page because it will *probably* become one.
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
        NOTES,
      ),
    ).toMatchObject({ kind: 'page', draft: { kind: 'capture', templateId: 'tpl-notes' } });
  });

  it('refuses a page with no resolved template rather than sending one without', () => {
    expect(
      resolveCreation(
        intent({ id: 'i-12', objectKind: 'page', tool: 'document', draft: { title: 'x' } }),
        undefined,
        {},
      ),
    ).toHaveProperty('error');
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
      resolveCreation(
        intent({ id: 'i-11', objectKind: 'page', tool: 'document' }),
        undefined,
        {},
        BRIEF,
      ),
    ).toEqual({ error: 'the draft names no page' });
  });
});

describe('choosing a page’s template (ADR-0030 rule 3)', () => {
  const bound = (templates: readonly DocTemplate[]): PageStore => ({ state: 'bound', templates });
  const marked = { ...NOTES, isDefault: true };

  it('blocks when nothing is bound, and when a bound database holds no template — differently', () => {
    // Two sentences, because the fixes differ (rule 5): bind a database, or
    // give the bound one a template.
    expect(resolveTemplate(undefined, undefined)).toEqual({ reason: PAGE_UNBOUND });
    expect(resolveTemplate({ state: 'unbound' }, undefined)).toEqual({ reason: PAGE_UNBOUND });
    expect(resolveTemplate(bound([]), undefined)).toEqual({ reason: PAGE_NO_TEMPLATE });
    expect(PAGE_UNBOUND).not.toBe(PAGE_NO_TEMPLATE);
    expect(PAGE_UNBOUND).toContain('Settings → Notion');
    expect(PAGE_NO_TEMPLATE).toContain('Settings → Notion');
  });

  it('says a database it could not read was not read, with the failure kind only', () => {
    const outcome = resolveTemplate({ state: 'unreadable', failure: 'refused' }, undefined);
    expect(outcome).toHaveProperty('reason');
    expect('reason' in outcome && outcome.reason).toContain('(refused)');
  });

  it('applies the one template there is, with no choice shown', () => {
    expect(resolveTemplate(bound([BRIEF]), undefined)).toEqual({ template: BRIEF });
  });

  it('applies the marked default of several when no choice was made', () => {
    expect(resolveTemplate(bound([BRIEF, marked]), undefined)).toEqual({ template: marked });
  });

  it('blocks several unmarked templates rather than picking one for somebody', () => {
    expect(resolveTemplate(bound([BRIEF, NOTES]), undefined)).toEqual({
      reason: PAGE_CHOOSE_TEMPLATE,
    });
    // Two marked defaults is not a state the tool describes; it is not guessed.
    expect(resolveTemplate(bound([{ ...BRIEF, isDefault: true }, marked]), undefined)).toEqual({
      reason: PAGE_CHOOSE_TEMPLATE,
    });
  });

  it('applies a chosen template while it exists, even over a marked default', () => {
    expect(resolveTemplate(bound([BRIEF, marked]), 'tpl-brief')).toEqual({ template: BRIEF });
  });

  it('blocks a chosen template that has since been deleted, and substitutes nothing', () => {
    // The person chose a template; a page built from another is a page they
    // did not ask for — even when there is a default, even when one is left.
    expect(resolveTemplate(bound([marked]), 'tpl-brief')).toEqual({ reason: PAGE_TEMPLATE_GONE });
    expect(resolveTemplate(bound([NOTES]), 'tpl-brief')).toEqual({ reason: PAGE_TEMPLATE_GONE });
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
      pageStores: NOTHING_BOUND,
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
      pageStores: NOTHING_BOUND,
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
      pageStores: NOTHING_BOUND,
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
      pageStores: NOTHING_BOUND,
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
      pageStores: NOTHING_BOUND,
    });

    expect(plan.runnable).toBe(1);
    const section = plan.steps[0];
    expect(section?.kind === 'run' && section.creation).toMatchObject({
      draft: { projectId: 'made-project' },
    });
  });

  it('blocks a page when the instance has bound no store for it', () => {
    // The state of every installation whose Settings → Notion screen is empty,
    // and the sentence names the screen that fixes it.
    const plan = orderConvergence({
      intents: [
        intent({ id: 'pg-1', objectKind: 'page', tool: 'document', draft: { title: 'x' } }),
      ],
      refsByEntity: NO_REFS,
      pageStores: NOTHING_BOUND,
    });

    expect(plan.blocked).toBe(1);
    expect(plan.steps[0]?.kind === 'blocked' && plan.steps[0].reason).toBe(PAGE_UNBOUND);
  });

  it('blocks a page whose store is bound and holds no template', () => {
    // ADR-0030 rule 5: a store without a template is not yet one. A page made
    // from nothing is the empty page ADR-0011 refuses.
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
      pageStores: stores({ initiative: [] }),
    });

    expect(plan.steps[0]?.kind === 'blocked' && plan.steps[0].reason).toBe(PAGE_NO_TEMPLATE);
  });

  it('runs a page once its store is bound and holds a template, naming it', () => {
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
      pageStores: stores({ initiative: [BRIEF] }),
    });

    expect(plan.runnable).toBe(1);
    const step = plan.steps[0];
    expect(step?.kind === 'run' && step.creation).toEqual({
      kind: 'page',
      draft: { kind: 'initiative', title: 'x', templateId: 'tpl-brief' },
      templateName: 'Brief',
    });
  });

  it('re-resolves a recorded choice, and blocks one that has gone', () => {
    const asked = intent({
      id: 'pg-1',
      entityKind: 'project',
      objectKind: 'page',
      tool: 'document',
      draft: { title: 'x' },
      templateId: 'tpl-notes',
    });

    const present = orderConvergence({
      intents: [asked],
      refsByEntity: NO_REFS,
      pageStores: stores({ project: [BRIEF, NOTES] }),
    });
    expect(present.steps[0]?.kind === 'run' && present.steps[0].creation).toMatchObject({
      draft: { templateId: 'tpl-notes' },
    });

    const gone = orderConvergence({
      intents: [asked],
      refsByEntity: NO_REFS,
      pageStores: stores({ project: [{ ...BRIEF, isDefault: true }] }),
    });
    expect(gone.steps[0]?.kind === 'blocked' && gone.steps[0].reason).toBe(PAGE_TEMPLATE_GONE);
  });

  it('blocks a capture\u2019s page by its own store, like every other kind, since ADR-0028', () => {
    // Before ADR-0028 this was blocked by the *kind* — binding the roles would
    // not have helped. Now the only reasons left are fixable ones, and binding
    // the other two kinds does not make a capture's page addressable.
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
      pageStores: stores({ initiative: [BRIEF], project: [BRIEF] }),
    });

    expect(plan.blocked).toBe(1);
    expect(plan.steps[0]?.kind === 'blocked' && plan.steps[0].reason).toBe(PAGE_UNBOUND);
  });

  it('runs a capture\u2019s page once its own store holds a template', () => {
    // The bound kind is `capture` alone, so this cannot pass by borrowing an
    // initiative's store.
    const plan = orderConvergence({
      intents: [
        intent({
          id: 'pg-3',
          entityKind: 'capture',
          objectKind: 'page',
          tool: 'document',
          draft: { title: 'x' },
        }),
      ],
      refsByEntity: NO_REFS,
      pageStores: stores({ capture: [NOTES] }),
    });

    expect(plan.runnable).toBe(1);
    expect(plan.steps[0]?.kind).toBe('run');
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

    const first = orderConvergence({
      intents,
      refsByEntity: refs,
      pageStores: NOTHING_BOUND,
    });
    const second = orderConvergence({
      intents: [...intents].reverse(),
      refsByEntity: refs,
      pageStores: NOTHING_BOUND,
    });

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
