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
 * 3. **The document tool is not addressable.** No role key names where a page
 *    would go and none carries the capability to create one, so every page
 *    intent is blocked — see the note below and ADR-0025.
 * 4. **A draft must parse.** The draft is `unknown` in the ledger, and a shape
 *    that does not match its object kind is a blocked step rather than a
 *    crash mid-pass with half the sections made.
 *
 * ## Why pages are blocked rather than attempted
 *
 * `packages/connectors/src/role-key.ts` binds six stores, and not one of them
 * is where an initiative's or a project's narrative page would live; none is a
 * template either, and the least-privilege table in docs/14-threat-model.md §5
 * grants the document-tool token no capability that would cover it. ADR-0011
 * asks for the button, and the role vocabulary cannot express where it would
 * write — so the intent is recorded, the plan says why it cannot run, and
 * ADR-0025 proposes the vocabulary. Guessing a parent would be the one write
 * in this repository aimed at a store nobody chose.
 */

/** Projects first, then sections in order, then everything else. Stable. */
const KIND_ORDER: Readonly<Record<string, number>> = {
  project: 0,
  section: 1,
  task: 2,
  page: 3,
};

export const PAGE_UNREACHABLE =
  'the document tool has no addressable store for a page: no role key names where one would go, and none carries the capability to create it (ADR-0025)';

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

  return { error: PAGE_UNREACHABLE };
}

export interface OrderInput {
  readonly intents: readonly Intent[];
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
    if (intent.tool === 'document') {
      steps.push({ kind: 'blocked', intent, reason: PAGE_UNREACHABLE });
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
