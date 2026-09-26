import type { DocTemplate, PageKind } from '@prisme/connectors';
import type { Creation, ConvergePlan, EntityRefs, Intent, PageStore, Step } from './types.js';

/**
 * Which intents can run now, in what order, and why the rest cannot.
 *
 * Pure. No clock, no connection, no writer — which is what lets the whole of
 * `prisme-sync create --plan` be this function plus a renderer.
 *
 * ## The rules, in the order they are applied
 *
 * 1. **Satisfied intents are done.** They produce no step at all, which is
 *    what makes a re-run after a partial failure resume rather than repeat.
 * 2. **A prerequisite must be satisfied.** A section waits for its project.
 *    The edge is stored (`requires`), not inferred from ordering, so a section
 *    whose project failed is *blocked with a reason* rather than sent with an
 *    empty parent.
 * 3. **A page needs an addressable store, and a template from it.** A kind's
 *    store is the database ADR-0025's role key names, and it is addressable
 *    when it is bound and holds at least one template (ADR-0030 rule 5). Which
 *    template is the pass's decision too, made from the database's list as this
 *    pass read it — see {@link resolveTemplate}.
 * 4. **A draft must parse.** The draft is `unknown` in the ledger, and a shape
 *    that does not match its object kind is a blocked step rather than a
 *    crash mid-pass with half the sections made.
 *
 * ## Why a page can still be blocked, and why that is not the old behaviour
 *
 * Before ADR-0025 was accepted, **every** page intent was blocked: no role key
 * named where a page would go and none carried the capability to create one, so
 * the only honest thing the plan could say was that prisme had nowhere to
 * write. That is no longer true, and what remains is a property of the
 * *instance* rather than of the vocabulary — and every block has a fix a person
 * can make, each named in its sentence: bind the database, share it, give it a
 * template, mark a default or choose one. A reason nobody can act on is worse
 * than no reason, because it teaches a reader to skip the column (ADR-0028).
 *
 * **The template is re-resolved on every pass, never trusted from the row.** A
 * request records a choice, or none; what is sent is decided here, against the
 * list as it stands, so a template deleted since the choice blocks the page
 * rather than being replaced by another nobody chose (ADR-0030 rule 3). And
 * the identifier resolved is what is sent — never "the default" — so a default
 * re-marked between the plan and the write cannot apply something the plan did
 * not show (rule 4).
 */

/** Projects first, then sections in order, then everything else. Stable. */
const KIND_ORDER: Readonly<Record<string, number>> = {
  project: 0,
  section: 1,
  task: 2,
  page: 3,
};

/**
 * Why a page cannot be created, when it cannot — one sentence per fix.
 *
 * An unbound store and a store with no template differ in what a person does
 * about them, so they are two sentences (ADR-0030 rule 5), and both point at
 * Settings → Notion, which shows the binding and what its database holds.
 */
export const PAGE_UNBOUND =
  'no database is bound for this kind of page: bind one in Settings → Notion (ADR-0030)';

export const PAGE_NO_TEMPLATE =
  'this kind’s database holds no template, and a page made from nothing is the empty page ADR-0011 refuses: add a template to the database in the document tool — Settings → Notion shows what it holds (ADR-0030)';

export const PAGE_CHOOSE_TEMPLATE =
  'this kind’s database holds several templates, marks none as the default, and none was chosen: ask for the page again choosing one, or mark a default in the document tool (ADR-0030)';

export const PAGE_TEMPLATE_GONE =
  'the template chosen for this page is no longer in its database, and another is not substituted for it: ask for the page again choosing one that is (ADR-0030)';

export function pageStoreUnreadable(failure: string): string {
  return `this kind’s database could not be read (${failure}): Settings → Notion says why (ADR-0030)`;
}

/**
 * Which template a page is made from, or why it cannot be made (ADR-0030 rule 3).
 *
 * | The database holds | No choice was made | A choice was made |
 * |---|---|---|
 * | nothing | blocked — no template | blocked — no template |
 * | one template | it | it, if it is the one chosen; blocked otherwise |
 * | several | the one marked default; blocked if none is | it, if it is still there; blocked otherwise |
 *
 * A choice that has vanished is never quietly replaced by the default: the
 * person chose a template, and a page built from another is a page they did not
 * ask for. Pure — the list is read by the caller, once per pass.
 */
export function resolveTemplate(
  store: PageStore | undefined,
  chosen: string | undefined,
): { readonly template: DocTemplate } | { readonly reason: string } {
  if (store === undefined || store.state === 'unbound') return { reason: PAGE_UNBOUND };
  if (store.state === 'unreadable') return { reason: pageStoreUnreadable(store.failure) };

  const { templates } = store;
  if (templates.length === 0) return { reason: PAGE_NO_TEMPLATE };

  if (chosen !== undefined) {
    const found = templates.find((template) => template.id === chosen);
    return found === undefined ? { reason: PAGE_TEMPLATE_GONE } : { template: found };
  }

  const [only, ...others] = templates;
  if (only !== undefined && others.length === 0) return { template: only };

  const marked = templates.filter((template) => template.isDefault);
  const [byDefault, ...alsoMarked] = marked;
  // Two marked defaults is not a state the tool describes, and picking one of
  // them would be the guess this function exists to refuse.
  if (byDefault !== undefined && alsoMarked.length === 0) return { template: byDefault };
  return { reason: PAGE_CHOOSE_TEMPLATE };
}

function text(draft: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const value = draft[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function strings(draft: Readonly<Record<string, unknown>>, field: string): readonly string[] {
  const value = draft[field];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Turn a ledger draft into a creation the writer will accept, or say why not.
 *
 * `projectId` for a section comes from the prerequisite's result when there
 * was one and from the entity's own reference otherwise — a linked project has
 * no prerequisite and its id is on the project row.
 */
export function resolveCreation(
  intent: Intent,
  parentExternalId: string | undefined,
  refs: EntityRefs,
  template?: DocTemplate,
): Creation | { readonly error: string } {
  if (intent.objectKind === 'project') {
    const name = text(intent.draft, 'name');
    if (name === undefined) return { error: 'the draft names no project' };
    const parentId = text(intent.draft, 'parentId');
    return {
      kind: 'project',
      draft: { name, ...(parentId === undefined ? {} : { parentId }) },
    };
  }

  if (intent.objectKind === 'section') {
    const name = text(intent.draft, 'name');
    if (name === undefined) return { error: 'the draft names no section' };
    const projectId = parentExternalId ?? refs.externalProjectId;
    if (projectId === undefined) {
      return {
        error:
          'the project this section belongs to has no external id yet — create or link it first',
      };
    }
    const order = intent.draft['order'];
    return {
      kind: 'section',
      draft: { projectId, name, order: typeof order === 'number' ? order : intent.ordinal },
    };
  }

  if (intent.objectKind === 'task') {
    const projectId = text(intent.draft, 'projectId');
    const content = text(intent.draft, 'content');
    if (projectId === undefined) return { error: 'the draft names no location for the task' };
    if (content === undefined) return { error: 'the draft has no content' };
    const sectionId = text(intent.draft, 'sectionId');
    return {
      kind: 'task',
      draft: {
        projectId,
        ...(sectionId === undefined ? {} : { sectionId }),
        content,
        description: text(intent.draft, 'description') ?? '',
        labels: strings(intent.draft, 'labels'),
      },
    };
  }

  if (intent.objectKind === 'page') {
    // A page is a document-tool object; an intent naming the task tool for one
    // is malformed rather than a second kind of page.
    if (intent.tool !== 'document') {
      return { error: 'a page is a document-tool object and this intent names the task tool' };
    }
    const title = text(intent.draft, 'title');
    if (title === undefined) return { error: 'the draft names no page' };

    // The kind is the entity's, not the draft's: an initiative's page is an
    // initiative's page because of what it is a page *of*, and a draft field
    // would let a caller say otherwise. Every member of `IntentEntityKind` is
    // now a `PageKind` (ADR-0028), so this is a widening and not a cast — if a
    // fourth entity kind is ever added without a page kind to go with it, this
    // line stops compiling rather than silently mapping to the wrong store.
    if (template === undefined) return { error: 'no template was resolved for this page' };
    return {
      kind: 'page',
      draft: { kind: intent.entityKind, title, templateId: template.id },
      templateName: template.name,
    };
  }

  /*
   * Unreachable: `IntentObjectKind` is a closed union and every member is
   * handled above. Bound to a `never` so that adding a kind is a compile error
   * here rather than a draft that silently fails to resolve at run time.
   */
  const unhandled: never = intent.objectKind;
  return { error: `a ${String(unhandled)} is not something this pass can create` };
}

export interface OrderInput {
  readonly intents: readonly Intent[];
  /**
   * What each kind's page store holds, as this pass read it (ADR-0030).
   *
   * A kind absent from the map is unbound, which is the state of every
   * instance that has not bound ADR-0025's roles and the one the plan must
   * describe rather than fail on. Passed in rather than read, because it is a
   * read of the document tool — I/O this pure function must not do.
   */
  readonly pageStores: ReadonlyMap<PageKind, PageStore>;
  /** Each entity's external references, keyed by entity id. */
  readonly refsByEntity: ReadonlyMap<string, EntityRefs>;
  /**
   * Intents this pass has already attempted, successfully or not.
   *
   * Needed because `failed` is not a terminal state: a rate limit or a 5xx
   * should be retried, and the *next* pass is where that happens. Without
   * this set the pass re-plans after recording a failure, sees the same row
   * still unsatisfied, and attempts it again immediately — a tight retry loop
   * with no backoff that spends the whole per-pass cap on one object. Found
   * by a test that expected one failure and got twenty.
   */
  readonly attempted?: ReadonlySet<string> | undefined;
}

export function orderConvergence(input: OrderInput): ConvergePlan {
  const byId = new Map(input.intents.map((intent) => [intent.id, intent]));
  const attempted = input.attempted ?? new Set<string>();

  const outstanding = input.intents
    .filter((intent) => intent.state !== 'satisfied' && !attempted.has(intent.id))
    .sort((left, right) => {
      const kinds = (KIND_ORDER[left.objectKind] ?? 9) - (KIND_ORDER[right.objectKind] ?? 9);
      if (kinds !== 0) return kinds;
      if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
      // Stable below everything else, so two runs plan the same order.
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

  const steps: Step[] = [];

  for (const intent of outstanding) {
    /*
     * A page waits on nothing: it is a narrative *about* the entity, and the
     * entity exists in prisme before any outward write happens. So the
     * prerequisite check below is skipped for it rather than being satisfied
     * vacuously — a page that named a prerequisite would be a modelling
     * mistake, not a plan this function should accommodate.
     */
    const isPage = intent.tool === 'document';
    let template: DocTemplate | undefined;
    if (isPage) {
      const resolved = resolveTemplate(input.pageStores.get(intent.entityKind), intent.templateId);
      if ('reason' in resolved) {
        steps.push({ kind: 'blocked', intent, reason: resolved.reason });
        continue;
      }
      template = resolved.template;
    }

    let parentExternalId: string | undefined;
    if (intent.requires !== undefined) {
      const prerequisite = byId.get(intent.requires);
      if (prerequisite === undefined) {
        steps.push({
          kind: 'blocked',
          intent,
          reason: 'the creation it waits on is no longer in the ledger',
        });
        continue;
      }
      if (prerequisite.state !== 'satisfied') {
        steps.push({
          kind: 'blocked',
          intent,
          reason: `it waits on the ${prerequisite.objectKind}, which is ${prerequisite.state}`,
        });
        continue;
      }
      parentExternalId = prerequisite.externalId;
    }

    const resolved = resolveCreation(
      intent,
      parentExternalId,
      input.refsByEntity.get(intent.entityId) ?? {},
      template,
    );
    if ('error' in resolved) {
      steps.push({ kind: 'blocked', intent, reason: resolved.error });
      continue;
    }

    steps.push({ kind: 'run', intent, creation: resolved });
  }

  return {
    steps,
    runnable: steps.filter((step) => step.kind === 'run').length,
    blocked: steps.filter((step) => step.kind === 'blocked').length,
  };
}

/**
 * Re-plan after a step has run.
 *
 * A pass executes one step, records its outcome, and asks again — rather than
 * computing a whole ordered list up front and walking it. That is the same
 * shape `apply` has ("`apply` re-plans immediately before executing"), and it
 * is what lets a section become runnable the moment its project is satisfied
 * within the same pass, without the ordering logic having to model the
 * cascade itself.
 */
export function applyOutcome(
  intents: readonly Intent[],
  intentId: string,
  outcome: { readonly ok: boolean; readonly externalId?: string | undefined },
): readonly Intent[] {
  return intents.map((intent) =>
    intent.id !== intentId
      ? intent
      : outcome.ok
        ? { ...intent, state: 'satisfied' as const, externalId: outcome.externalId }
        : { ...intent, state: 'failed' as const, attempts: intent.attempts + 1 },
  );
}
