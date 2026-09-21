import type {
  LooseTaskDraft,
  PageDraft,
  ProjectDraft,
  SectionDraft,
} from '@prisme/connectors/write';

/**
 * The vocabulary of a converge pass (W15).
 *
 * The creation ledger holds *intentions*: rows written by the API before
 * anything outward was attempted, saying which external objects prisme has
 * decided should exist. This pass drains them, one at a time, recording each
 * outcome before starting the next.
 *
 * Nothing in this file has a clock, a connection or a random number — the same
 * split `reconcile/` makes and for the same reason. The interesting question
 * is *which of these can run now and in what order*, and that is a pure
 * function of the ledger's contents.
 */

export type IntentEntityKind = 'capture' | 'initiative' | 'project';
export type IntentObjectKind = 'task' | 'project' | 'section' | 'page';
export type IntentState = 'pending' | 'satisfied' | 'failed';

/** One row of the ledger, as this pass sees it. */
export interface Intent {
  readonly id: string;
  readonly entityKind: IntentEntityKind;
  readonly entityId: string;
  readonly tool: 'task' | 'document';
  readonly objectKind: IntentObjectKind;
  readonly ordinal: number;
  /**
   * What to create. Deliberately `unknown` rather than a union: the shape is
   * decided by the API, and this pass validates it at the moment it uses it
   * (`resolve`) rather than trusting a cast. A draft that does not match its
   * object kind is a `blocked` step with a reason, not a crash.
   */
  readonly draft: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly state: IntentState;
  readonly externalId?: string | undefined;
  readonly requires?: string | undefined;
  readonly attempts: number;
}

/**
 * What prisme already knows about the entity an intent belongs to.
 *
 * Only the external references, and only because a section needs its
 * project's. A pass that could read an entity's title from here would be a
 * pass that could write a title outward that the ledger never recorded.
 */
export interface EntityRefs {
  readonly externalProjectId?: string | undefined;
}

/** A resolved creation, ready to hand to the writer. */
export type Creation =
  | { readonly kind: 'project'; readonly draft: ProjectDraft }
  | { readonly kind: 'section'; readonly draft: SectionDraft }
  | { readonly kind: 'task'; readonly draft: LooseTaskDraft }
  /**
   * A narrative page in the document tool. Resolvable only since ADR-0025 was
   * accepted and its role keys existed — before that every page intent was
   * blocked with a reason, because no role key named where one would go.
   */
  | { readonly kind: 'page'; readonly draft: PageDraft };

/**
 * One line of the pass's plan.
 *
 * `blocked` is a first-class outcome rather than an exception, for the reason
 * `apps/sync/CLAUDE.md` gives about plans generally: a dry run that cannot
 * show the refusal is not a preview of the write. A page with no addressable
 * store, a section whose project failed, a draft that does not parse — each is
 * a line with a sentence beside it.
 */
export type Step =
  | { readonly kind: 'run'; readonly intent: Intent; readonly creation: Creation }
  | { readonly kind: 'blocked'; readonly intent: Intent; readonly reason: string };

export interface ConvergePlan {
  readonly steps: readonly Step[];
  readonly runnable: number;
  readonly blocked: number;
}

/** What one executed step did. */
export interface StepOutcome {
  readonly intentId: string;
  readonly ok: boolean;
  readonly externalId?: string | undefined;
  readonly reason?: string | undefined;
}
