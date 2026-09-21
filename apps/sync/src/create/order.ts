import type { PageKind } from '@prisme/connectors';
import type { Creation, ConvergePlan, EntityRefs, Intent, Step } from './types.js';

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
 * 3. **A page needs an addressable store.** ADR-0025's role keys name where an
 *    initiative's or a project's page goes and what it copies, and if the
 *    instance has not bound them the page intent is blocked with a reason —
 *    see the note below.
 * 4. **A draft must parse.** The draft is `unknown` in the ledger, and a shape
 *    that does not match its object kind is a blocked step rather than a
 *    crash mid-pass with half the sections made.
 *
 * ## Why a page can still be blocked, and why that is not the old behaviour
 *
 * Before ADR-0025 was accepted, **every** page intent was blocked: no role key
 * named where a page would go and none carried the capability to create one, so
 * the only honest thing the plan could say was that prisme had nowhere to
 * write. That is no longer true — `initiative_pages_db` and
 * `project_pages_db` exist — and what remains is a property of the *instance*:
 * an installation that has not bound those roles has no addressable store, and
 * the plan says so per intent rather than sending a creation at a parent nobody
 * chose.
 *
 * A capture's page stays blocked for a different reason, and it is a gap rather
 * than a decision: ADR-0025's vocabulary names two kinds of page, and a capture
 * is neither. Guessing which of the two it meant is the class of guess this
 * repository refuses everywhere else.
 */

/** Projects first, then sections in order, then everything else. Stable. */
const KIND_ORDER: Readonly<Record<string, number>> = {
  project: 0,
  section: 1,
  task: 2,
  page: 3,
};

/**
 * Why a page cannot be created, when it cannot.
 *
 * Two sentences rather than one, because the two situations need different
 * actions from a human: an unbound role is a deployment step they can run, and
 * a capture's page is a vocabulary gap they can only report.
 */
export const PAGE_UNBOUND =
  'the document tool has no bound store for this kind of page: bind the page and template roles (ADR-0025) with `prisme-sync bindings --from <path>`';

export const PAGE_KIND_UNSUPPORTED =
  "a capture's page has no role key in ADR-0025's vocabulary, which names an initiative's page and a project's page and nothing between them";

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
    // would let a caller say otherwise.
    if (intent.entityKind === 'capture') return { error: PAGE_KIND_UNSUPPORTED };
    // Narrowed by the exclusion above, so no cast: the two surviving kinds are
    // exactly ADR-0025's two.
    return { kind: 'page', draft: { kind: intent.entityKind, title } };
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
   * The page kinds this instance can actually create.
   *
   * Empty on every instance that has not bound ADR-0025's roles, which is the
   * state the plan must describe rather than fail on. Passed in rather than
   * derived, because it is a property of the *bindings* — instance data this
   * pure function must not read.
   */
  readonly addressablePageKinds: ReadonlySet<PageKind>;
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
    // A capture is excluded here rather than counted as unbound: binding the
    // roles would not help it, and the plan must say the true reason.
    if (
      isPage &&
      intent.entityKind !== 'capture' &&
      !input.addressablePageKinds.has(intent.entityKind)
    ) {
      steps.push({ kind: 'blocked', intent, reason: PAGE_UNBOUND });
      continue;
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
