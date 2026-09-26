import { z } from 'zod';
import { defineWrite, named } from '../http/schema.js';
import { entityId, instant, page, reviewCadence } from './common.js';
import { REVIEW_READ_ONLY } from './ownership.js';

/**
 * The operational surfaces: review sessions, the event log, the adoption
 * ledger, the settings prisme is running under, and reconciliation state.
 *
 * Two of these carry a rule worth restating where it is served.
 *
 * **The event log is append-only** (docs/10-model.md §10). There is no endpoint
 * that edits one, because it is simultaneously the KPI source, the replanning
 * input and the security audit trail — and an audit trail with an edit path is
 * a log, not a trail.
 *
 * **Settings are read-only here.** Everything that changes prisme's behaviour
 * — the write freeze, the active scoring method, the capacity window — is
 * deployment configuration, validated at boot by `@prisme/config`. The write
 * freeze in particular is lifted by a human working through
 * docs/13-migration.md §5 step 8, and an API call that could lift it would make
 * that gate decorative. `SETTINGS_READ_ONLY` in `./ownership.ts` carries the
 * sentences, for the day a settings write path exists.
 */

export const reviewSessionDto = z.object({
  id: entityId,
  cadence: reviewCadence,
  startedAt: instant,
  completedAt: instant.nullable(),
  /** Checklist step id → done. The steps themselves are instance data. */
  checklist: z.record(z.string(), z.boolean()),
  decisions: z.array(z.string()),
  /** Per-area share at the moment the review closed. */
  capacitySnapshot: z.record(z.string(), z.number()),
  externalPageId: z.string().nullable(),
});

export const eventDto = z.object({
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

/**
 * One row of the adoption ledger.
 *
 * W12 owns the queue that produces candidates and the matching that ranks them.
 * What W05 serves is the ledger those decisions land in, and `bound` — whether
 * the external object is actually tied to the prisme entity yet, which is the
 * difference between a decision and a fact.
 */
export const adoptionEntryDto = z.object({
  prismeId: z.string(),
  externalKind: z.enum(['page', 'project', 'section', 'task']),
  externalId: z.string(),
  matchRule: z.enum([
    'existing_mapping',
    'exact_title',
    'normalised_title',
    'fuzzy_title',
    'manual',
  ]),
  confidence: z.enum(['certain', 'high', 'medium', 'low', 'manual']),
  decidedBy: z.enum(['auto', 'human']),
  decidedAt: instant,
  bound: z.boolean(),
});

/**
 * One row of the **adoption queue** — a candidate, from the last scan's mirror.
 *
 * Distinct from {@link adoptionEntryDto}, which is a *decision*. A candidate is
 * a question: an external object with no prisme link, classified by
 * docs/13-migration.md §4 and carrying at most one proposal. The scan writes
 * these; nothing here has been decided by anybody.
 *
 * `title` is **instance data**. It exists in this response because a human
 * cannot work a queue of identifiers — and for no other reason.
 */
export const adoptionCandidateDto = z.object({
  externalKind: z.enum(['page', 'project', 'section', 'task']),
  externalId: z.string(),
  title: z.string(),
  areaKey: z.string().nullable(),
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
  /** Why the classifier said so, in prisme's vocabulary. Displayed, never parsed. */
  reason: z.string(),
  matchRule: z
    .enum(['existing_mapping', 'exact_title', 'normalised_title', 'fuzzy_title', 'manual'])
    .nullable(),
  confidence: z.enum(['certain', 'high', 'medium', 'low', 'manual']).nullable(),
  proposedId: z.string().nullable(),
  /** 0–1, only for a fuzzy proposal — shown so the human can disagree with it. */
  similarity: z.number().nullable(),
  scannedAt: instant,
});

export const settingsDto = z.object({
  timezone: z.string(),
  scoring: z.object({
    activeMethodId: z.string(),
    activeMethodVersion: z.int(),
    shadowMethodIds: z.array(z.string()),
  }),
  capacity: z.object({
    windowWeeks: z.int(),
    defaultTaskMinutes: z.int(),
    balanceClamp: z.tuple([z.number(), z.number()]),
  }),
  selection: z.object({
    maxNow: z.int(),
    maxNowPerArea: z.int(),
    /** Both numbers are the candidates named in OQ-2, which is still open. */
    openQuestion: z.string(),
  }),
  schedule: z.object({
    concurrentInitiatives: z.int(),
    workingWeekdays: z.array(z.int()),
  }),
  sync: z.object({
    enabled: z.boolean(),
    /** The write freeze. False until a human lifts it — docs/13-migration.md §5. */
    writeEnabled: z.boolean(),
    createThreshold: z.int(),
    windowStart: z.int(),
    windowEnd: z.int(),
  }),
});

export const syncStatusDto = z.object({
  enabled: z.boolean(),
  writeEnabled: z.boolean(),
  createThreshold: z.int(),
  /** Present rather than disclosed: the cursor is state, not something to page through. */
  hasTaskToolCursor: z.boolean(),
  documentWatermark: instant.nullable(),
  lastFullPassAt: instant.nullable(),
  unresolvedConflicts: z.int(),
  lastRunAt: instant.nullable(),
});

export const conflictDto = z.object({
  id: z.string(),
  entityId: z.string(),
  field: z.string(),
  prismeValue: z.string().nullable(),
  externalValue: z.string().nullable(),
  detectedAt: instant,
  resolution: z.enum(['prisme_wins', 'external_wins', 'unresolved']),
  actor: z.enum(['sync', 'human']),
});

/**
 * What a `POST /sync` returns.
 *
 * `report` is the rendered plan — the same text `prisme-sync plan` prints, and
 * a user interface in its own right (apps/sync/CLAUDE.md). It carries real
 * titles, so it goes to the authenticated caller who owns them and **never into
 * a log line or this repository**.
 */
export const syncRunDto = z.object({
  mode: z.enum(['plan', 'apply']),
  /** False when another pass held the advisory lock. Nothing was queued. */
  ran: z.boolean(),
  full: z.boolean(),
  startedAt: instant,
  finishedAt: instant,
  counts: z.record(z.string(), z.int()),
  applied: z.int().nullable(),
  conflicts: z.int().nullable(),
  /** Set when the plan was refused — the write freeze, or the create threshold. */
  refused: z.string().nullable(),
  failures: z.int(),
  drift: z.int(),
  report: z.string().nullable(),
});

export const ReviewSessionDto = named('ReviewSession', reviewSessionDto);
export const ReviewSessionPageDto = named('ReviewSessionPage', page(reviewSessionDto));
export const EventPageDto = named('EventPage', page(eventDto));
export const AdoptionPageDto = named('AdoptionPage', page(adoptionEntryDto));
export const AdoptionQueuePageDto = named('AdoptionQueuePage', page(adoptionCandidateDto));
export const AdoptionCandidateDto = named('AdoptionCandidate', adoptionCandidateDto);
export const AdoptionEntryDto = named('AdoptionEntry', adoptionEntryDto);
export const ConflictDto = named('Conflict', conflictDto);
export const SettingsDto = named('Settings', settingsDto);
export const SyncStatusDto = named('SyncStatus', syncStatusDto);
export const ConflictPageDto = named('ConflictPage', page(conflictDto));
export const SyncRunDto = named('SyncRun', syncRunDto);
export const OpenApiDocumentDto = named('OpenApiDocument', z.looseObject({ openapi: z.string() }));

export const openReviewBody = defineWrite(
  'OpenReview',
  z.strictObject({ cadence: reviewCadence }),
  REVIEW_READ_ONLY,
);

export const updateReviewBody = defineWrite(
  'UpdateReview',
  z.strictObject({
    checklist: z.record(z.string().min(1).max(100), z.boolean()).optional(),
    decisions: z.array(z.string().min(1).max(1000)).optional(),
    externalPageId: z.string().min(1).max(200).nullable().optional(),
    /** Closing the session is what takes the capacity snapshot. */
    complete: z.boolean().optional(),
  }),
  REVIEW_READ_ONLY,
);

/** A rescan of the adoption queue: counts only, never a title. */
export const AdoptionScanDto = named(
  'AdoptionScan',
  z.object({
    /** False when a reconciler pass held the lock; nothing was queued. */
    ran: z.boolean(),
    queued: z.int(),
    certain: z.int(),
    scannedAt: instant,
  }),
);

export const scanAdoptionBody = defineWrite('ScanAdoption', z.strictObject({}));

export const decideAdoptionBody = defineWrite(
  'DecideAdoption',
  z.strictObject({
    prismeId: z.string().min(1).max(100),
    externalKind: z.enum(['page', 'project', 'section', 'task']),
    externalId: z.string().min(1).max(200),
    matchRule: z.enum([
      'existing_mapping',
      'exact_title',
      'normalised_title',
      'fuzzy_title',
      'manual',
    ]),
    confidence: z.enum(['certain', 'high', 'medium', 'low', 'manual']),
  }),
  {
    decidedBy:
      'a decision made through this endpoint is a human one by definition; nothing above "certain" is ever applied automatically (docs/13-migration.md §3)',
    decidedAt: 'stamped when the decision is recorded',
  },
);

export const triggerSyncBody = defineWrite(
  'TriggerSync',
  z.strictObject({
    /** `plan` has no side effects and is free to run at any time. */
    mode: z.enum(['plan', 'apply']).default('plan'),
    full: z.boolean().default(false),
  }),
  {
    writeEnabled:
      'the write freeze is deployment configuration, lifted by a human at docs/13-migration.md §5 step 8 — not by a request',
    createThreshold:
      'the create threshold is deployment configuration; a request that could raise it is guard 3 turned off (ADR-0010)',
  },
);

export const resolveConflictBody = defineWrite(
  'ResolveConflict',
  z.strictObject({ resolution: z.enum(['prisme_wins', 'external_wins']) }),
);

/**
 * Adopt: create a prisme entity with `origin = adopted`, bound to the object
 * that already exists.
 *
 * The body carries **only the identity of the candidate**. Title, area and kind
 * come from the mirror the scan wrote, so a caller cannot adopt an object under
 * a title it does not have — which is the shape of every accidental duplicate
 * this workstream exists to prevent.
 */
export const adoptCandidateBody = defineWrite(
  'AdoptCandidate',
  z.strictObject({
    externalKind: z.enum(['page', 'project', 'section', 'task']),
    externalId: z.string().min(1).max(200),
  }),
  {
    title: 'taken from the candidate the scan recorded, never from the request',
    areaKey: 'taken from the candidate; an object outside every mapped area cannot be adopted',
    origin:
      "always 'adopted', and immutable after insert — an adopted entity cannot produce a create (ADR-0010, guard 2)",
  },
);

/**
 * Ignore: permanently, and recorded.
 *
 * There is no un-ignore endpoint, and that absence is the feature. An ignored
 * object stays adoptable by explicit external id; it is only kept out of the
 * queue (docs/13-migration.md §4).
 */
export const ignoreCandidateBody = defineWrite(
  'IgnoreCandidate',
  z.strictObject({
    externalKind: z.enum(['page', 'project', 'section', 'task']),
    externalId: z.string().min(1).max(200),
    reason: z.string().min(1).max(500).optional(),
  }),
  {
    decidedBy: "always 'human' — nothing ignores an item on a person's behalf",
    decidedAt: 'stamped when the decision is recorded',
  },
);
