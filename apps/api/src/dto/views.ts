import { z } from 'zod';
import { named } from '../http/schema.js';
import {
  areaKey,
  areaKind,
  calendarDate,
  entityId,
  instant,
  page,
  percentage,
  taskPriority,
} from './common.js';
import { initiativeDto } from './initiative.js';
import { takeawayDto } from './lanes.js';

/**
 * The query surface — **designed around the screens**, not as generic CRUD.
 *
 * This is the part of the brief that is easiest to get wrong by doing the
 * obvious thing. Generic CRUD forces the UI into N+1 request patterns, and a UI
 * making six requests to draw one list grows its own aggregation logic to hide
 * the latency. That logic is business logic, it is now in two places, and the
 * second source of truth has arrived without anyone deciding to create one
 * (apps/api/CLAUDE.md §6).
 *
 * So Focus returns what Focus draws: the now set, already ranked, already
 * joined to its blockers and its progress, with the reason each item is there.
 */

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

export const focusEntryDto = z.object({
  initiative: initiativeDto,
  score: z.number(),
  /** The rank within the active method's ordering, 1-based. */
  rank: z.int(),
  proposedStatus: z.enum(['now', 'next', 'later', 'unchanged']),
  reason: selectionReason,
  /** What the reconciler will write to the anchor (docs/12-scoring.md §5.4). */
  priority: taskPriority,
  blockedBy: z.array(entityId),
  /** Whole days until the deadline. Negative once it is behind. Null with no deadline. */
  daysUntilDeadline: z.int().nullable(),
  deadlineAtRisk: z.boolean(),
});

export const focusDto = z.object({
  asOf: instant,
  methodId: z.string(),
  methodVersion: z.int(),
  limits: z.object({ maxNow: z.int(), maxNowPerArea: z.int() }),
  /**
   * More is in flight than the limit allows. Nothing is demoted for it —
   * demotion is a decision made at a review, not by arithmetic — but the
   * surface says so.
   */
  overCapacity: z.boolean(),
  /** True when the weights behind every balance factor were carried forward. */
  weightsStale: z.boolean(),
  now: z.array(focusEntryDto),
  /** The queue the next free slot would draw from, in ranked order. */
  upNext: z.array(focusEntryDto),
  slotsByArea: z.array(z.object({ areaKey, kind: areaKind, used: z.int(), limit: z.int() })),
});

export const inboxDto = z.object({
  /** Initiatives waiting to be triaged into the backlog. */
  initiatives: z.array(initiativeDto),
  /**
   * Action takeaways not yet promoted. A principle never appears here: it is
   * never a backlog candidate, and surfaces during the review of its area
   * instead (docs/10-model.md §8).
   */
  takeaways: z.array(takeawayDto),
});

export const InboxDto = named('Inbox', inboxDto);
export const FocusDto = named('Focus', focusDto);

export const backlogEntryDto = z.object({
  initiative: initiativeDto,
  score: z.number().nullable(),
  rank: z.int().nullable(),
});

export const backlogDto = page(backlogEntryDto).extend({
  methodId: z.string(),
  methodVersion: z.int(),
  /**
   * The ordering these rows were cut from, so a surface cannot re-sort into a
   * second ordering of the same data. Scoring ranks; selection decides; the
   * list a person reads must be the list that chose their week.
   */
  sort: z.string(),
});

export const BacklogDto = named('Backlog', backlogDto);

export const timelineEntryDto = z.object({
  initiativeId: entityId,
  title: z.string(),
  areaKey,
  /** So a Gantt can group by project without a second request and a join. */
  projectId: entityId.nullable(),
  status: z.string(),
  durationDays: z.int(),
  plannedStart: calendarDate,
  plannedEnd: calendarDate,
  earliestStart: calendarDate,
  earliestFinish: calendarDate,
  latestStart: calendarDate,
  latestFinish: calendarDate,
  slackDays: z.int(),
  onCriticalPath: z.boolean(),
  deadline: calendarDate.nullable(),
  deadlineFeasible: z.boolean(),
  deadlineSlackDays: z.int().nullable(),
  /** Which constraint decided the date. A Gantt nobody can interrogate is ignored. */
  boundBy: z.enum(['dependency', 'earliest_start', 'capacity', 'none']),
  boundByIds: z.array(entityId),
});

export const timelineDto = z.object({
  projectStart: calendarDate,
  projectEnd: calendarDate.nullable(),
  weightYear: z.int(),
  weightsStale: z.boolean(),
  initiatives: z.array(timelineEntryDto),
  edges: z.array(z.object({ from: entityId, to: entityId, critical: z.boolean() })),
  criticalPath: z.array(entityId),
  minSlackDays: z.int(),
  /** prisme flags an impossible deadline and never moves one (ADR-0003). */
  infeasibleDeadlines: z.array(entityId),
  /** Depended-on ids that are not in the plan: it is optimistic exactly here. */
  danglingRefs: z.array(entityId),
  /**
   * Concurrent initiatives each area may run, from the year's weights — the
   * capacity constraint the plan was built under, floored at one.
   *
   * Served because the constraint is otherwise invisible: a Timeline can show
   * that something is `boundBy: 'capacity'` but not *how full* the area was,
   * and a reader who cannot see the limit reads a delay as an error. Deriving
   * it in a browser would be a second copy of `slotsForWeight`.
   */
  areaSlots: z.array(z.object({ areaKey, slots: z.int() })),
});

export const TimelineDto = named('Timeline', timelineDto);

/**
 * What one move would do — the drag's preview, and a **read**.
 *
 * `GET`, on a read scope, with the move in the query: this computes a
 * hypothetical plan and writes nothing at all. That is not a technicality about
 * HTTP verbs. An instance with writes frozen must still be able to ask what a
 * move would cost, and a preview behind `write:initiative` would go dark
 * exactly when the kill switch is pulled (W14) — which is the moment somebody
 * most wants to know what they are about to be unable to do.
 *
 * Committing the move is a separate, ordinary write: `PATCH /initiatives/{id}`
 * with `earliestStart`. Nothing here writes `deadline`, ever — prisme flags an
 * impossible deadline and never moves one (ADR-0003).
 */
export const replanDto = z.object({
  move: z.object({
    initiativeId: entityId,
    requestedStart: calendarDate,
    /** Where it actually lands. Differs when a dependency or the area refused. */
    actualStart: calendarDate,
    honoured: z.boolean(),
    boundBy: z.enum(['dependency', 'earliest_start', 'capacity', 'none']),
  }),
  /** Everything whose dates change, the moved one first, then by id. */
  shifted: z.array(
    z.object({
      initiativeId: entityId,
      fromStart: calendarDate,
      toStart: calendarDate,
      fromEnd: calendarDate,
      toEnd: calendarDate,
      startDeltaDays: z.int(),
      endDeltaDays: z.int(),
      isDownstream: z.boolean(),
    }),
  ),
  /** Feasible before the move, impossible after it. */
  brokenDeadlines: z.array(entityId),
  repairedDeadlines: z.array(entityId),
  /** The plan as it would be, in the parts a preview redraws. */
  after: z.object({
    projectEnd: calendarDate.nullable(),
    criticalPath: z.array(entityId),
    infeasibleDeadlines: z.array(entityId),
    minSlackDays: z.int(),
  }),
});

export const ReplanDto = named('Replan', replanDto);

const bucketPointDto = z.object({
  periodStart: calendarDate,
  value: z.number(),
});

export const kpiDto = z.object({
  from: calendarDate,
  to: calendarDate,
  bucket: z.enum(['week', 'month']),
  /**
   * Which record `throughput`, `minutes`, `runHours` and `signalsVolume` were
   * measured from — the materialised history the backfill wrote, or the anchor
   * subtree that is all prisme has until a backfill has run (W13). The
   * adherence and attainment series are unaffected and read elsewhere.
   */
  observedSource: z.enum(['capacity_week', 'task_mirror']),
  /** Completions per bucket, per area. The throughput chart. */
  throughput: z.array(z.object({ areaKey, kind: areaKind, points: z.array(bucketPointDto) })),
  /** Attributed minutes per bucket, per area. What the balance chart is drawn from. */
  minutes: z.array(z.object({ areaKey, kind: areaKind, points: z.array(bucketPointDto) })),
  /** Upkeep, in hours per week, against its declared budget. */
  runHours: z.object({
    budgetHoursPerWeek: z.number().nullable(),
    points: z.array(bucketPointDto),
  }),
  /** Counted as noise volume and nothing else; excluded from capacity (ADR-0014). */
  signalsVolume: z.array(bucketPointDto),
  ritualAdherence: z.array(
    z.object({
      ritualId: entityId,
      name: z.string(),
      targetAdherencePct: percentage,
      points: z.array(bucketPointDto),
    }),
  ),
  objectiveAttainment: z.array(
    z.object({
      objectiveId: entityId,
      title: z.string(),
      period: z.string(),
      /** Mean `progressSelf` across the objective's key results. */
      progressSelfPct: z.number().nullable(),
      /** Mean `progressComputed`. Null when there is no breakdown to compute from. */
      progressComputedPct: z.number().nullable(),
    }),
  ),
});

export const KpiDto = named('Kpi', kpiDto);
