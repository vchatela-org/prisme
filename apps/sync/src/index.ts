/**
 * `@prisme/sync` — the reconciler, as a library.
 *
 * **Two entrypoints, one library** (docs/16-sync.md §7): `main.ts` is the
 * CronJob binary, and the API's `POST /sync` imports {@link reconcile} from
 * here. Both run behind the same PostgreSQL advisory lock, so the scheduled
 * pass and the force-sync button are provably one code path rather than two
 * implementations that drift.
 *
 * The planner is exported too, because it is pure and it is the interesting
 * part: anything that wants to know *what would happen* can call it without a
 * database, a network or a clock.
 */

export { reconcile, isFullPassDue } from './run.js';
export type { ReconcileOptions, ReconcileResult } from './run.js';

export { apply } from './apply/apply.js';
export type { ApplyFailure, ApplyOptions, ApplyResult } from './apply/apply.js';
export type {
  BindRefInput,
  CaptureInput,
  PassOutcome,
  ReconcilerStore,
  SyncCursor,
  SyncEvent,
} from './apply/ports.js';

export { createPostgresStore } from './state/postgres.js';

/**
 * The pass's outcome, as a row.
 *
 * The API imports the *reader* so that `/metrics` can republish what the
 * CronJob measured — a pod Prometheus never scrapes. Writer and reader are one
 * file (`state/run-state.ts`) because the table is a contract between two
 * processes.
 */
export { readSyncRunState, recordPassOutcome } from './state/run-state.js';
export type { SyncRunState } from './state/run-state.js';

export { plan } from './reconcile/plan.js';
export { formatPlan } from './reconcile/format.js';
export type { PlanReport } from './reconcile/format.js';
export { anchorPriorities } from './reconcile/priority.js';
export { managedLine, MANAGED_FIELDS } from './reconcile/description.js';
export { DEFAULT_ANCHOR_LABEL, DEFAULT_STATUS_REQUEST_PREFIX } from './reconcile/labels.js';
export { changesOf, ACTION_TAGS } from './reconcile/types.js';
export type {
  Action,
  ActionTag,
  DesiredAnchor,
  DesiredState,
  LastAppliedIndex,
  ObservedState,
  Operation,
  Plan,
  PlannerConfig,
  Rollup,
} from './reconcile/types.js';

export { shouldRunNow } from './window.js';
export type { WindowDecision, WindowOptions } from './window.js';

/**
 * Adoption (W12). `plan`-only by construction: {@link adopt} takes two *read*
 * clients and a store whose only write is the candidate mirror, so there is no
 * outward door for a caller to find.
 */
export { adopt } from './adoption/run.js';
export type { AdoptOptions, AdoptResult } from './adoption/run.js';
export { createAdoptionStore } from './adoption/store.js';
export type { AdoptionStore } from './adoption/ports.js';
export { scan, unresolved } from './adoption/queue.js';
export type { ScanInput, ScanOptions, ScanResult } from './adoption/queue.js';
export { classify, DEFAULT_CLASSIFIER_CONFIG } from './adoption/classify.js';
export type { ClassifierConfig } from './adoption/classify.js';
export { resolve, indexTargets } from './adoption/resolve.js';
export { coverage, wouldProduceCreate } from './adoption/coverage.js';
export type { AuditableEntity, CoverageReport, CreateRisk } from './adoption/coverage.js';
export { formatAdoptionPlan } from './adoption/report.js';
export { normalise, exactForm } from './adoption/normalise.js';

/**
 * The creation ledger's converge pass (W15).
 *
 * The API decides what should exist and writes intents; this is the only
 * thing that turns one into an object. `plan` writes nothing at all, so it
 * runs under the write freeze — which is exactly when somebody wants to know
 * what is queued behind it.
 */
export { converge } from './create/run.js';
export type { ConvergeOptions, ConvergeResult } from './create/run.js';
export { createCreationStore } from './create/store.js';
export type { CreationStore } from './create/ports.js';
export {
  orderConvergence,
  resolveCreation,
  applyOutcome,
  PAGE_KIND_UNSUPPORTED,
  PAGE_UNBOUND,
} from './create/order.js';
export { formatConvergePlan } from './create/report.js';
export { createMode, DEFAULT_MAX_PER_PASS } from './create/cli.js';
export type {
  ConvergePlan,
  Creation,
  EntityRefs,
  Intent,
  Step,
  StepOutcome,
} from './create/types.js';
export { fuzzyMatch, similarity, titlesAgree, FUZZY_THRESHOLD } from './adoption/similarity.js';
export { externalKey, isAdoptable, ADOPTABLE_KINDS, CANDIDATE_KINDS } from './adoption/types.js';
export type {
  Candidate,
  CandidateKind,
  Classification,
  Confidence,
  DecidedSet,
  ExternalKind,
  ExternalObject,
  MatchRule,
  MatchTarget,
  Proposal,
} from './adoption/types.js';
