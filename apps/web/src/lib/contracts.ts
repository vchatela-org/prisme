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
  /**
   * Where this area's work lives in the task tool (W15).
   *
   * Read by the capture flow and by nothing else: a capture becomes a task,
   * and an area mapped nowhere has no honest place to put one. Offering it
   * anyway would produce a `422` on submit, after the person had typed.
   *
   * Defaulted rather than required, because the API has sent it since W05 and
   * every other screen ignores it — a required field here would make this
   * schema the reason Focus stops rendering if the shape ever narrows. Rule 1
   * at the head of this file, applied deliberately.
   */
  mappings: z.array(z.object({ externalProjectId: z.string() })).default([]),
});

export type Area = z.infer<typeof areaSchema>;

/**
 * `GET /areas` returns `{ items }` and nothing else.
 *
 * It is not a paged endpoint: `AreaListDto` in `apps/api/src/dto/area.ts` is
 * `z.object({ items })`, because there are a dozen areas and paging them would
 * be a page size nobody ever reaches. This schema carried `total`, `limit` and
 * `offset` from W08 until W11, so it **never parsed a real response** — every
 * screen reading it fell back to its failure state or to the area *key* where
 * it meant to show the name, quietly, on Focus, Backlog, Inbox, Adoption and
 * initiative detail alike.
 *
 * It stayed invisible because the fallback is a plausible string: a badge
 * reading `health` instead of `Health` looks like a styling choice rather than
 * a parse failure.
 *
 * **W11 also recorded that the callers sending `limit` was harmless, and it
 * was not.** `noQuery` is `z.strictObject({})`, which *refuses* an
 * unrecognised key rather than ignoring it — so `GET /areas?limit=200`
 * answered `400`, and Focus, Backlog, Inbox, Adoption and initiative detail
 * each took their area list's failure path on every single load. The same
 * plausible-looking fallback hid it a second time. W15 removed the parameter
 * from all five; nothing sends a query to this route now.
 */
export const areaListSchema = z.object({ items: z.array(areaSchema) });

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
 * The creation flows (W15).
 *
 * ## A capture carries no estimate, and that is the contract
 *
 * There is no `value`, no `size`, no `status` here, because there is none on
 * the wire: a capture stays a task, and the scored unit is the initiative
 * (ADR-0004). A schema that quietly allowed them would be the first step
 * towards a screen that collects them.
 *
 * ## The ledger row carries no draft
 *
 * The API does not send one, and this does not ask for one. The draft holds a
 * real title and a real external location; the entity the row belongs to has
 * the title already, and a field nobody renders cannot reach a screenshot
 * (docs/17-privacy.md).
 */
export const captureSchema = z.object({
  id,
  title: z.string(),
  areaKey,
  externalProjectId: z.string().nullable(),
  externalSectionId: z.string().nullable(),
  /** Null until the converge pass has confirmed the task exists. */
  externalTaskId: z.string().nullable(),
  promotedTo: id.nullable(),
  promotedAt: instant.nullable(),
  createdAt: instant,
});

export const captureListSchema = z.object({
  items: z.array(captureSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type Capture = z.infer<typeof captureSchema>;

export const CREATION_STATES = ['pending', 'satisfied', 'failed'] as const;
export type CreationState = (typeof CREATION_STATES)[number];

export const creationIntentSchema = z.object({
  id,
  entityKind: z.enum(['capture', 'initiative', 'project']),
  entityId: id,
  tool: z.enum(['task', 'document']),
  objectKind: z.enum(['task', 'project', 'section', 'page']),
  ordinal: z.number().int(),
  state: z.enum(CREATION_STATES),
  externalId: z.string().nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  requires: id.nullable(),
  createdAt: instant,
  updatedAt: instant,
});

export const creationListSchema = z.object({
  items: z.array(creationIntentSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type CreationIntent = z.infer<typeof creationIntentSchema>;

/**
 * Search before create.
 *
 * `similarity` arrives computed. Nothing on this tier ranks anything: a second
 * implementation of the matcher would disagree with the adoption queue's about
 * the same pair of titles, and the two surfaces would then propose different
 * things (`apps/web/CLAUDE.md` non-negotiable 1).
 */
export const searchMatchSchema = z.object({
  source: z.enum(['existing', 'adoptable']),
  kind: z.enum(['initiative', 'project', 'capture', 'task', 'page']),
  prismeId: id.nullable(),
  externalId: z.string().nullable(),
  title: z.string(),
  areaKey: areaKey.nullable(),
  similarity: z.number(),
  suggests: z.enum(['open', 'adopt']),
});

export const searchSchema = z.object({
  query: z.string(),
  worthReading: z.boolean(),
  matches: z.array(searchMatchSchema),
});

export type SearchMatch = z.infer<typeof searchMatchSchema>;
export type SearchResult = z.infer<typeof searchSchema>;

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

/* -------------------------------------------------------------------------
 * Areas, weights and measurement (W09)
 * ---------------------------------------------------------------------- */

/**
 * An area with the fields the Areas screen reads, on top of the three the
 * daily surfaces need.
 *
 * Extended rather than added to `areaSchema` on purpose: a field is described
 * where it is rendered, and widening the schema every screen shares would mean
 * Focus fails to load because the KPI dashboard wanted a budget (rule 2 at the
 * top of this file).
 */
export const areaDetailSchema = areaSchema.extend({
  active: z.boolean(),
  /** Only the Change lane is ranked. Run and Signals are lanes, not competitors. */
  rankable: z.boolean(),
  /** Upkeep is budgeted in hours per week, not as a share of capacity. */
  runBudgetHoursPerWeek: z.number().nullable(),
});

export type AreaDetail = z.infer<typeof areaDetailSchema>;

export const areaDetailListSchema = z.object({ items: z.array(areaDetailSchema) });

/**
 * The weights in force for a year, and whether they were decided *for* it.
 *
 * `stale` is the year gate (ADR-0007). It is read on every surface that draws
 * a target share, and a screen that renders this without showing it has
 * restored exactly the silence the gate removes — so there is no path through
 * these screens where `stale` is parsed and then dropped.
 */
export const areaWeightsSchema = z.object({
  year: z.number().int(),
  sourceYear: z.number().int().nullable(),
  stale: z.boolean(),
  /** Whether the rankable areas' weights add up to a whole person's capacity. */
  sumPct: z.number(),
  weights: z.array(z.object({ areaKey, year: z.number().int(), weightPct: z.number() })),
});

export type AreaWeights = z.infer<typeof areaWeightsSchema>;

/**
 * Declared versus observed capacity, per area — the view that exists nowhere
 * else, and the reason prisme allocates before it ranks.
 *
 * `balanceFactor` arrives computed. Nothing in this tier derives it: the
 * clamp, the window and the exclusions all live in `packages/domain`, and a
 * second implementation here is how the two end up disagreeing in front of
 * the reader (`apps/web/CLAUDE.md` non-negotiable 1).
 */
export const areaBalanceSchema = z.object({
  areaKey,
  name: z.string(),
  kind: areaKind,
  countsTowardCapacity: z.boolean(),
  minutes: z.number(),
  completions: z.number().int(),
  actualSharePct: z.number(),
  targetSharePct: z.number().nullable(),
  balanceFactor: z.number(),
  stale: z.boolean(),
  /** What the measurement rests on: a recorded duration, or an estimate. */
  minutesBySource: z.object({
    recorded: z.number(),
    declared: z.number(),
    default: z.number(),
  }),
  runHoursPerWeek: z.number().nullable(),
  runBudgetHoursPerWeek: z.number().nullable(),
});

export type AreaBalance = z.infer<typeof areaBalanceSchema>;

export const balanceSchema = z.object({
  /** The window the observation covers, half-open: `(from, to]`. */
  from: calendarDate,
  to: calendarDate,
  windowWeeks: z.number().int(),
  weightYear: z.number().int(),
  weightSourceYear: z.number().int().nullable(),
  stale: z.boolean(),
  /**
   * Which record the observed side came from (W13): the materialised history
   * the backfill wrote, or the anchor subtree that is all prisme has until a
   * backfill has run. The two give different numbers for the same week.
   */
  observedSource: z.enum(['capacity_week', 'task_mirror']),
  /** How far the backfill's coverage reaches, when it is the source. */
  observedThrough: calendarDate.nullable(),
  areas: z.array(areaBalanceSchema),
});

export type Balance = z.infer<typeof balanceSchema>;

const bucketPointSchema = z.object({ periodStart: calendarDate, value: z.number() });

const areaSeriesSchema = z.object({
  areaKey,
  kind: areaKind,
  points: z.array(bucketPointSchema),
});

/**
 * The KPI series.
 *
 * Note what is *not* here: no share, and no balance factor over time. The API
 * serves attributed minutes per bucket and this tier normalises them, which is
 * arithmetic over a series the API has already applied its rules to — the
 * Signals exclusion in particular is baked in upstream, arriving as zeroes
 * (`./kpi-view.ts`).
 */
export const kpiSchema = z.object({
  from: calendarDate,
  to: calendarDate,
  bucket: z.enum(['week', 'month']),
  /** Which record the measured series came from (W13). See `balanceSchema`. */
  observedSource: z.enum(['capacity_week', 'task_mirror']),
  throughput: z.array(areaSeriesSchema),
  minutes: z.array(areaSeriesSchema),
  runHours: z.object({
    budgetHoursPerWeek: z.number().nullable(),
    points: z.array(bucketPointSchema),
  }),
  signalsVolume: z.array(bucketPointSchema),
  ritualAdherence: z.array(
    z.object({
      ritualId: id,
      name: z.string(),
      targetAdherencePct: z.number(),
      points: z.array(bucketPointSchema),
    }),
  ),
  objectiveAttainment: z.array(
    z.object({
      objectiveId: id,
      title: z.string(),
      period: z.string(),
      progressSelfPct: z.number().nullable(),
      progressComputedPct: z.number().nullable(),
    }),
  ),
});

export type Kpi = z.infer<typeof kpiSchema>;

/**
 * Only the deadline-health part of the timeline.
 *
 * The Gantt itself is W10's surface; what the KPI dashboard needs from it is
 * how many deadlines the schedule says cannot be met. prisme flags an
 * infeasible deadline and never moves one (ADR-0003), so this is a count of
 * flags, not a judgement made here.
 */
export const deadlineHealthSchema = z.object({
  initiatives: z.array(
    z.object({
      initiativeId: id,
      areaKey,
      deadline: calendarDate.nullable(),
      deadlineFeasible: z.boolean(),
      deadlineSlackDays: z.number().int().nullable(),
    }),
  ),
  infeasibleDeadlines: z.array(id),
});

export type DeadlineHealth = z.infer<typeof deadlineHealthSchema>;

/* -------------------------------------------------------------------------
 * The Timeline (W10)
 * ---------------------------------------------------------------------- */

/**
 * One bar.
 *
 * Every date here was computed by `packages/domain`'s schedule engine and is
 * rendered exactly as it arrived. `boundBy` is the field the surface is really
 * about: it says which constraint decided the start, and a Gantt that cannot
 * answer that gets overridden once and then ignored (W02 brief §6).
 *
 * `deadlineFeasible` is a **flag and only a flag**. prisme never moves a
 * deadline to make a plan work (ADR-0003), and nothing on this screen offers
 * to — the one thing a drag writes is `earliest_start`.
 */
export const timelineEntrySchema = z.object({
  initiativeId: id,
  title: z.string(),
  areaKey,
  projectId: id.nullable(),
  status: z.string(),
  durationDays: z.number().int(),
  plannedStart: calendarDate,
  plannedEnd: calendarDate,
  earliestStart: calendarDate,
  earliestFinish: calendarDate,
  latestStart: calendarDate,
  latestFinish: calendarDate,
  slackDays: z.number().int(),
  onCriticalPath: z.boolean(),
  deadline: calendarDate.nullable(),
  deadlineFeasible: z.boolean(),
  deadlineSlackDays: z.number().int().nullable(),
  boundBy: z.enum(['dependency', 'earliest_start', 'capacity', 'none']),
  boundByIds: z.array(id),
});

export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const timelineSchema = z.object({
  projectStart: calendarDate,
  projectEnd: calendarDate.nullable(),
  weightYear: z.number().int(),
  weightsStale: z.boolean(),
  initiatives: z.array(timelineEntrySchema),
  edges: z.array(z.object({ from: id, to: id, critical: z.boolean() })),
  criticalPath: z.array(id),
  minSlackDays: z.number().int(),
  infeasibleDeadlines: z.array(id),
  /** Depended-on ids not in the plan: it is optimistic exactly there, and says so. */
  danglingRefs: z.array(id),
  /** Concurrent initiatives each area may run, from that year's weights. */
  areaSlots: z.array(z.object({ areaKey, slots: z.number().int() })),
});

export type Timeline = z.infer<typeof timelineSchema>;

/**
 * What one move would do, before anything is written.
 *
 * The drag asks for this and renders the answer. It does not work out where a
 * bar lands — a preview the browser computed is a preview that can disagree
 * with what gets saved, and the disagreement would appear only after somebody
 * committed it.
 */
export const replanSchema = z.object({
  move: z.object({
    initiativeId: id,
    requestedStart: calendarDate,
    /** Where the plan actually puts it. A move is a request, not an instruction. */
    actualStart: calendarDate,
    honoured: z.boolean(),
    boundBy: z.enum(['dependency', 'earliest_start', 'capacity', 'none']),
  }),
  shifted: z.array(
    z.object({
      initiativeId: id,
      fromStart: calendarDate,
      toStart: calendarDate,
      fromEnd: calendarDate,
      toEnd: calendarDate,
      startDeltaDays: z.number().int(),
      endDeltaDays: z.number().int(),
      isDownstream: z.boolean(),
    }),
  ),
  brokenDeadlines: z.array(id),
  repairedDeadlines: z.array(id),
  after: z.object({
    projectEnd: calendarDate.nullable(),
    criticalPath: z.array(id),
    infeasibleDeadlines: z.array(id),
    minSlackDays: z.number().int(),
  }),
});

export type Replan = z.infer<typeof replanSchema>;

/**
 * A page of takeaways, read for its `total` alone.
 *
 * Reading-to-action conversion is two of these — every action takeaway, and
 * the promoted ones — so the ratio is a division of two counts the API
 * reports, with no list ever walked in the browser.
 */
export const takeawayPageSchema = z.object({
  items: z.array(takeawaySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/**
 * A measurement on a key result: append-only, so a trend exists.
 *
 * There is no endpoint that edits or removes one, and this application offers
 * no affordance that would imply otherwise. A series somebody can tidy up is a
 * series that only ever agrees with the story being told about it.
 */
export const measurementSchema = z.object({
  observedAt: instant,
  value: z.number(),
  note: z.string().nullable(),
});

export type Measurement = z.infer<typeof measurementSchema>;

export const measurementListSchema = z.object({
  keyResultId: id,
  items: z.array(measurementSchema),
});

/**
 * A key result, with both progress numbers side by side.
 *
 * `progressSelf` is writable and `progressComputed` is not, and that asymmetry
 * is the feature rather than an omission (ADR-0013). `progressComputed` is
 * **nullable, not zero**: no breakdown to compute from is a different fact
 * from no progress, and rendering the first as `0%` would invent a divergence
 * that does not exist.
 */
export const keyResultSchema = z.object({
  id,
  objectiveId: id,
  statement: z.string(),
  target: z.number(),
  unit: z.string(),
  progressSelf: z.number(),
  progressComputed: z.number().nullable(),
  externalAnchorId: z.string().nullable(),
  /** Initiative ids. The only link between an objective and the work. */
  servedBy: z.array(id),
  measurementCount: z.number().int(),
  createdAt: instant,
});

export type KeyResult = z.infer<typeof keyResultSchema>;

export const OBJECTIVE_STATUSES = ['draft', 'active', 'met', 'missed', 'dropped'] as const;
export const objectiveStatus = z.enum(OBJECTIVE_STATUSES);
export type ObjectiveStatus = z.infer<typeof objectiveStatus>;

export const OBJECTIVE_TYPES = ['annual', 'monthly'] as const;
export const objectiveType = z.enum(OBJECTIVE_TYPES);
export type ObjectiveType = z.infer<typeof objectiveType>;

/**
 * An objective.
 *
 * `period` is `YYYY` for an annual objective and `YYYY-MM` for a monthly one,
 * and it is fixed at authoring: an objective that moves between months is a
 * different objective, and letting one move would make attainment history
 * meaningless. The API refuses the change; this application never offers it.
 */
export const objectiveSchema = z.object({
  id,
  title: z.string(),
  type: objectiveType,
  period: z.string().regex(/^\d{4}(-\d{2})?$/),
  areaKey,
  status: objectiveStatus,
  externalPageId: z.string().nullable(),
  keyResults: z.array(keyResultSchema),
  createdAt: instant,
});

export type Objective = z.infer<typeof objectiveSchema>;

export const objectivePageSchema = z.object({
  items: z.array(objectiveSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export type ObjectivePage = z.infer<typeof objectivePageSchema>;

export const REVIEW_CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export const reviewCadence = z.enum(REVIEW_CADENCES);
export type ReviewCadence = z.infer<typeof reviewCadence>;

/**
 * A review session — the record that makes a review a record.
 *
 * `checklist` maps a step id to whether it is done. The step *ids* come from
 * the cadence map in `docs/10-model.md`, which freezes the shape of each step;
 * the concrete checklist an instance works through is its own data and lives
 * in the document tool. A session carrying a step id this build does not know
 * is therefore expected, not corrupt — `review-wizard.ts` keeps it rather than
 * dropping it.
 *
 * `capacitySnapshot` is taken when the session closes and never retaken: what
 * the review saw is part of what the review decided.
 */
export const reviewSessionSchema = z.object({
  id,
  cadence: reviewCadence,
  startedAt: instant,
  completedAt: instant.nullable(),
  checklist: z.record(z.string(), z.boolean()),
  decisions: z.array(z.string()),
  capacitySnapshot: z.record(z.string(), z.number()),
  externalPageId: z.string().nullable(),
});

export type ReviewSession = z.infer<typeof reviewSessionSchema>;

export const reviewSessionPageSchema = z.object({
  items: z.array(reviewSessionSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/**
 * One row of the conflict ledger.
 *
 * Clearing it is a weekly review step (docs/10-model.md §10), which is the
 * only reason this application reads it: resolving one is W04's surface and
 * the wizard links out rather than re-implementing the decision.
 */
export const conflictSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  field: z.string(),
  prismeValue: z.string().nullable(),
  externalValue: z.string().nullable(),
  detectedAt: instant,
  resolution: z.enum(['prisme_wins', 'external_wins', 'unresolved']),
  actor: z.enum(['sync', 'human']),
});

export type Conflict = z.infer<typeof conflictSchema>;

export const conflictPageSchema = z.object({
  items: z.array(conflictSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

/**
 * A ritual, for the monthly review's lane check.
 *
 * `latestAdherencePct` is nullable and that nullability is load-bearing: no
 * opportunity in the period is a different fact from having missed every one,
 * and a ritual that has not come round yet must not read as 0% adherence.
 */
export const ritualSchema = z.object({
  id,
  name: z.string(),
  areaKey,
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  targetAdherencePct: z.number(),
  externalPageId: z.string().nullable(),
  latestAdherencePct: z.number().nullable(),
});

export type Ritual = z.infer<typeof ritualSchema>;

export const ritualListSchema = z.object({ items: z.array(ritualSchema) });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * An area as the Settings screens edit it: every field, every mapping.
 *
 * Its own schema rather than a widening of `areaSchema`, for the reason given
 * at `areaDetailSchema` — Focus must not fail to load because Settings wanted
 * a colour.
 */
export const settingsAreaSchema = z.object({
  key: areaKey,
  name: z.string(),
  kind: areaKind,
  active: z.boolean(),
  rankable: z.boolean(),
  runBudgetHoursPerWeek: z.number().nullable(),
  colorSlot: z.number().int().min(1).max(8).nullable().default(null),
  mappings: z.array(
    z.object({
      externalProjectId: z.string(),
      externalSectionId: z.string().nullable(),
      isHome: z.boolean().default(false),
    }),
  ),
});

export type SettingsArea = z.infer<typeof settingsAreaSchema>;

export const settingsAreaListSchema = z.object({ items: z.array(settingsAreaSchema) });

export const ROLE_ACCESSES = ['read', 'write', 'read_write', 'create'] as const;

export const bindingSchema = z.object({
  role: z.string(),
  shape: z.enum(['data_source', 'page']),
  access: z.enum(ROLE_ACCESSES),
  bound: z.boolean(),
  externalId: z.string().nullable(),
  title: z.string().nullable(),
  linkId: z.string().nullable(),
  checkedAt: instant.nullable(),
  checkError: z.string().nullable(),
});

export type Binding = z.infer<typeof bindingSchema>;

export const bindingListSchema = z.object({ items: z.array(bindingSchema) });

export const taskLocationsSchema = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      parentId: z.string().nullable(),
      archived: z.boolean(),
      sections: z.array(z.object({ id: z.string(), name: z.string(), archived: z.boolean() })),
    }),
  ),
  failure: z.string().nullable(),
});

export type TaskLocations = z.infer<typeof taskLocationsSchema>;

/** `GET /settings` — the deployment configuration prisme is running under. */
export const instanceSettingsSchema = z.object({
  timezone: z.string(),
  scoring: z.object({
    activeMethodId: z.string(),
    activeMethodVersion: z.number().int(),
    shadowMethodIds: z.array(z.string()),
  }),
  capacity: z.object({
    windowWeeks: z.number().int(),
    defaultTaskMinutes: z.number().int(),
    balanceClamp: z.tuple([z.number(), z.number()]),
  }),
  selection: z.object({
    maxNow: z.number().int(),
    maxNowPerArea: z.number().int(),
    openQuestion: z.string(),
  }),
  sync: z.object({
    enabled: z.boolean(),
    writeEnabled: z.boolean(),
    createThreshold: z.number().int(),
    windowStart: z.number().int(),
    windowEnd: z.number().int(),
  }),
});

export type InstanceSettings = z.infer<typeof instanceSettingsSchema>;

/** `GET /write-switch` — the runtime kill switch. */
export const writeSwitchSchema = z.object({
  engaged: z.boolean(),
  mode: z.enum(['outward', 'all']),
  changedAt: instant.nullable(),
  changedBy: z.string().nullable(),
  reason: z.string().nullable(),
});
