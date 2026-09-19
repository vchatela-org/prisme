import { z } from 'zod';

/**
 * What the web tier expects back from the API, as schemas it parses with.
 *
 * ## Why this file exists at all
 *
 * `apps/api` already parses its responses on the way out, so these schemas are
 * not there to catch a malformed handler. They are here because
 * `docs/14-threat-model.md` §5 says every boundary is parsed before any other
 * code sees the value, and boundary ② — web → API — is a network hop like any
 * other. A page that renders whatever came back over HTTP is a page that
 * renders whatever anything answering on that address chose to send.
 *
 * ## Why they are not imported from `@prisme/api/client`
 *
 * That package exports *types*, which erase, and importing it at all — even
 * with `import type` — makes `apps/web` unbuildable without `apps/api`
 * compiled beside it. The web image deliberately does not contain the API
 * (`apps/web/Dockerfile`: the web tier holds no database credential and no API
 * source), so a dependency in that direction would mean either copying the API
 * into the web build or dropping the type check from the image build. Both are
 * worse than a schema that describes what these four screens read.
 *
 * ## The rules that keep the two from drifting
 *
 * 1. **Objects are non-strict.** Zod strips unknown keys, so a field the API
 *    adds tomorrow passes silently. A field these screens read that the API
 *    *stops* sending fails loudly, on the screen that reads it, which is the
 *    asymmetry worth having.
 * 2. **Only what a screen renders is described.** This is not a second copy of
 *    the DTO layer and must not grow into one.
 * 3. **Ids are opaque strings.** The API says `uuid`; the web has no business
 *    re-deciding an id format it only ever echoes back. Insisting on a format
 *    here would be a second contract with nothing to gain from it.
 */

/** An id the web receives and hands back. Never parsed for meaning. */
const id = z.string().min(1).max(200);

const areaKey = z.string().min(1).max(64);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.string().min(20);

export const INITIATIVE_STATUSES = [
  'inbox',
  'later',
  'next',
  'now',
  'waiting',
  'review',
  'done',
  'dropped',
] as const;

export const initiativeStatus = z.enum(INITIATIVE_STATUSES);
export type InitiativeStatus = z.infer<typeof initiativeStatus>;

export const FIBONACCI = [1, 2, 3, 5, 8, 13] as const;
const fibonacci = z.literal(FIBONACCI);
export type Fibonacci = z.infer<typeof fibonacci>;

const areaKind = z.enum(['area', 'run', 'signals']);

/**
 * A score, with the method's own sentence beside it.
 *
 * `explain` and `factors` are displayed verbatim by `<ScorePill>`. Nothing in
 * this application recomputes a score, and nothing paraphrases this sentence —
 * the UI and `packages/domain` would drift, and the first person to notice
 * would be someone told two different things about the same number.
 */
export const scoreSchema = z.object({
  value: z.number(),
  methodId: z.string(),
  methodVersion: z.number().int(),
  factors: z.record(z.string(), z.number()),
  explain: z.string(),
  computedAt: instant,
});

export type Score = z.infer<typeof scoreSchema>;

export const initiativeSchema = z.object({
  id,
  title: z.string(),
  areaKey,
  projectId: id.nullable(),
  status: initiativeStatus,
  value: fibonacci,
  timeCriticality: fibonacci,
  risk: fibonacci,
  size: fibonacci,
  deadline: calendarDate.nullable(),
  earliestStart: calendarDate.nullable(),
  plannedStart: calendarDate.nullable(),
  plannedEnd: calendarDate.nullable(),
  dependsOn: z.array(id),
  externalPageId: z.string().nullable(),
  externalAnchorId: z.string().nullable(),
  origin: z.enum(['created_in_prisme', 'adopted']),
  doneAt: calendarDate.nullable(),
  droppedReason: z.string().nullable(),
  createdAt: instant,
  updatedAt: instant,
  score: scoreSchema.nullable(),
  rollup: z.object({
    openTaskCount: z.number().int(),
    totalTaskCount: z.number().int(),
    progressPct: z.number().nullable(),
    lastActivity: instant.nullable(),
  }),
  blockedBy: z.array(id),
  sizedForNow: z.boolean(),
});

export type Initiative = z.infer<typeof initiativeSchema>;

/** Why an initiative sits where it does. Straight from `selectNowSet`. */
export const selectionReason = z.enum([
  'in_flight',
  'selected',
  'area_at_cap',
  'wip_full',
  'blocked',
  'too_large',
  'not_a_candidate',
]);

export type SelectionReason = z.infer<typeof selectionReason>;

export const focusEntrySchema = z.object({
  initiative: initiativeSchema,
  score: z.number(),
  rank: z.number().int(),
  proposedStatus: z.enum(['now', 'next', 'later', 'unchanged']),
  reason: selectionReason,
  priority: z.enum(['highest', 'high', 'medium', 'lowest']),
  blockedBy: z.array(id),
  daysUntilDeadline: z.number().int().nullable(),
  deadlineAtRisk: z.boolean(),
});

export type FocusEntry = z.infer<typeof focusEntrySchema>;

export const areaSlotSchema = z.object({
  areaKey,
  kind: areaKind,
  used: z.number().int(),
  limit: z.number().int(),
});

export type AreaSlot = z.infer<typeof areaSlotSchema>;

export const focusSchema = z.object({
  asOf: instant,
  methodId: z.string(),
  methodVersion: z.number().int(),
  limits: z.object({ maxNow: z.number().int(), maxNowPerArea: z.number().int() }),
  overCapacity: z.boolean(),
  weightsStale: z.boolean(),
  now: z.array(focusEntrySchema),
  upNext: z.array(focusEntrySchema),
  slotsByArea: z.array(areaSlotSchema),
});

export type Focus = z.infer<typeof focusSchema>;

/**
 * A takeaway carries **no text**.
 *
 * The words live in the document tool and stay there (docs/11-ownership.md);
 * what prisme holds is that one exists, what kind it is, and whether it has
 * been promoted. The inbox therefore triages a reference, not a quotation —
 * which is also why nothing here can leak a sentence somebody wrote.
 */
export const takeawaySchema = z.object({
  id,
  kind: z.enum(['principle', 'action']),
  externalPageId: z.string(),
  areaKey: areaKey.nullable(),
  promotedTo: id.nullable(),
  mayEnterBacklog: z.boolean(),
  observedAt: instant,
});

export type Takeaway = z.infer<typeof takeawaySchema>;

export const inboxSchema = z.object({
  initiatives: z.array(initiativeSchema),
  takeaways: z.array(takeawaySchema),
});

export type Inbox = z.infer<typeof inboxSchema>;

export const backlogEntrySchema = z.object({
  initiative: initiativeSchema,
  score: z.number().nullable(),
  rank: z.number().int().nullable(),
});

export type BacklogEntry = z.infer<typeof backlogEntrySchema>;

export const backlogSchema = z.object({
  items: z.array(backlogEntrySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  methodId: z.string(),
  methodVersion: z.number().int(),
  sort: z.string(),
});

export type Backlog = z.infer<typeof backlogSchema>;

export const areaSchema = z.object({
  key: areaKey,
  name: z.string(),
  kind: areaKind,
});

export type Area = z.infer<typeof areaSchema>;

export const areaListSchema = z.object({
  items: z.array(areaSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const projectSchema = z.object({
  id,
  name: z.string(),
  areaKey,
  status: z.enum(['active', 'paused', 'done', 'dropped']),
});

export const projectListSchema = z.object({
  items: z.array(projectSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type Project = z.infer<typeof projectSchema>;

/**
 * A mirrored task, read-only everywhere.
 *
 * Every field here belongs to the task tool (docs/11-ownership.md §5). `due` in
 * particular is displayed and never written: prisme writes `deadline`, the task
 * tool owns `due`, and a UI that offers to edit one of them here is a UI that
 * has quietly changed who owns it (ADR-0003).
 */
export const taskSchema = z.object({
  externalId: z.string(),
  externalParentId: z.string().nullable(),
  isAnchor: z.boolean(),
  completed: z.boolean(),
  completedAt: instant.nullable(),
  recordedMinutes: z.number().int().nullable(),
  due: calendarDate.nullable(),
  priority: z.enum(['highest', 'high', 'medium', 'lowest']).nullable(),
  observedAt: instant,
});

export type Task = z.infer<typeof taskSchema>;

export const taskListSchema = z.object({
  initiativeId: id,
  items: z.array(taskSchema),
});

export const scoreHistorySchema = z.object({
  initiativeId: id,
  items: z.array(scoreSchema),
});

export const syncStatusSchema = z.object({
  enabled: z.boolean(),
  writeEnabled: z.boolean(),
  createThreshold: z.number().int(),
  hasTaskToolCursor: z.boolean(),
  documentWatermark: instant.nullable(),
  lastFullPassAt: instant.nullable(),
  unresolvedConflicts: z.number().int(),
  lastRunAt: instant.nullable(),
});

export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const eventSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'score_changed',
    'status_changed',
    'weight_changed',
    'completed',
    'sync_action',
    'adoption_decision',
  ]),
  entityKind: z.string(),
  entityId: z.string(),
  field: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  actor: z.enum(['human', 'agent', 'sync']),
  occurredAt: instant,
});

export type EventLogEntry = z.infer<typeof eventSchema>;

export const eventPageSchema = z.object({
  items: z.array(eventSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/**
 * One row of the adoption queue (W12).
 *
 * A candidate is a **question**, not a decision: an external object with no
 * prisme link, classified by docs/13-migration.md §4 and carrying at most one
 * proposal. `title` is the only instance data on this screen, and it is here
 * because a human cannot work a queue of identifiers.
 *
 * `similarity` is nullable *and* only ever set for a fuzzy proposal. The screen
 * shows it whenever it is there — a similarity score nobody can see is a number
 * nobody can disagree with, and disagreeing is the whole job of this queue.
 */
export const adoptionCandidateSchema = z.object({
  externalKind: z.enum(['page', 'project', 'section', 'task']),
  externalId: z.string().min(1).max(200),
  title: z.string(),
  areaKey: areaKey.nullable(),
  proposedKind: z.enum([
    'initiative',
    'project',
    'key_result',
    'ritual',
    'run',
    'signal',
    'takeaway',
    'task',
  ]),
  reason: z.string(),
  matchRule: z
    .enum(['existing_mapping', 'exact_title', 'normalised_title', 'fuzzy_title', 'manual'])
    .nullable(),
  confidence: z.enum(['certain', 'high', 'medium', 'low', 'manual']).nullable(),
  proposedId: z.string().nullable(),
  similarity: z.number().nullable(),
  scannedAt: z.string(),
});

export type AdoptionCandidate = z.infer<typeof adoptionCandidateSchema>;

export const adoptionQueueSchema = z.object({
  items: z.array(adoptionCandidateSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type AdoptionQueue = z.infer<typeof adoptionQueueSchema>;
