import type { z } from 'zod';
import {
  assertAcyclic,
  computeSchedule,
  daysUntil,
  InvariantError,
  parseCalendarDate,
  replan,
  SCHEDULE_DEFAULTS,
  statusIndex,
  toScoreRows,
  type CalendarDate,
  type Initiative,
  type Registry,
  type Schedule,
  type SelectionLimits,
} from '@prisme/domain';
import type {
  backlogEntryDto,
  focusDto,
  focusEntryDto,
  inboxDto,
  replanDto,
  timelineDto,
} from '../dto/views.js';
import { ApiError, notFound } from '../http/errors.js';
import type { Identity } from '../http/authorize.js';
import type { ApiStore, InitiativeFilter, PageRequest, ScoreRecord } from '../store/types.js';
import { toInitiativeDto, toTakeawayDto, toTaskDto, type InitiativeDtoShape } from './convert.js';
import { buildRanking, type Ranking } from './ranking.js';

/**
 * The work surfaces: initiatives, the ranking, Focus, Backlog, Inbox and the
 * Timeline.
 *
 * Everything here is composition. The decisions live in `@prisme/domain` —
 * `computeScores` ranks, `selectNowSet` chooses, `computeSchedule` plans — and
 * this file joins their answers to the rows they were computed from. That split
 * is the whole point of apps/api/CLAUDE.md §6: a rule implemented here is a rule
 * the MCP tools will implement slightly differently, and then there are two.
 */

export type FocusShape = z.infer<typeof focusDto>;
export type FocusEntryShape = z.infer<typeof focusEntryDto>;
export type BacklogEntryShape = z.infer<typeof backlogEntryDto>;
export type InboxShape = z.infer<typeof inboxDto>;
export type TimelineShape = z.infer<typeof timelineDto>;
export type ReplanShape = z.infer<typeof replanDto>;

/**
 * One move, as the Timeline asks about it.
 *
 * `newStart` is a *request*: a dependency or a full area can refuse it, and the
 * answer says so rather than quietly granting a date the plan cannot support.
 * There is no deadline in here, and there is nowhere to put one — a drag never
 * moves a deadline (ADR-0003, W02 brief §4).
 */
export interface ReplanRequest {
  readonly initiativeId: string;
  /** `YYYY-MM-DD`, parsed to the domain's branded date here, as `/kpi` does. */
  readonly newStart: string;
}

export interface WorkConfig {
  readonly capacityWindowWeeks: number;
  readonly defaultTaskMinutes: number;
  readonly limits: SelectionLimits;
  readonly concurrentInitiatives: number;
  readonly workingWeekdays: readonly number[];
}

export type BacklogSort = 'score' | 'deadline' | 'age' | 'title' | 'size';

export interface BacklogQuery {
  readonly areaKeys?: readonly string[] | undefined;
  readonly statuses?: readonly string[] | undefined;
  readonly projectId?: string | undefined;
  readonly hasDeadline?: boolean | undefined;
  readonly search?: string | undefined;
  readonly sort: BacklogSort;
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

export interface CreateInitiativeRequest {
  readonly title: string;
  readonly areaKey: string;
  readonly projectId?: string | undefined;
  readonly status: string;
  readonly value: number;
  readonly timeCriticality: number;
  readonly risk: number;
  readonly size: number;
  readonly deadline?: string | undefined;
  readonly earliestStart?: string | undefined;
  readonly externalPageId?: string | undefined;
  readonly dependsOn: readonly string[];
}

export interface UpdateInitiativeRequest {
  readonly title?: string | undefined;
  readonly areaKey?: string | undefined;
  readonly projectId?: string | null | undefined;
  readonly value?: number | undefined;
  readonly timeCriticality?: number | undefined;
  readonly risk?: number | undefined;
  readonly size?: number | undefined;
  readonly deadline?: string | null | undefined;
  readonly earliestStart?: string | null | undefined;
  readonly externalPageId?: string | null | undefined;
  readonly droppedReason?: string | null | undefined;
}

export interface WorkService {
  focus(now: Date): Promise<FocusShape>;
  inbox(now: Date): Promise<InboxShape>;
  backlog(
    query: BacklogQuery,
    now: Date,
  ): Promise<{
    items: BacklogEntryShape[];
    total: number;
    limit: number;
    offset: number;
    methodId: string;
    methodVersion: number;
    sort: string;
  }>;
  timeline(now: Date): Promise<TimelineShape>;
  replanTimeline(move: ReplanRequest, now: Date): Promise<ReplanShape>;

  get(id: string, now: Date): Promise<InitiativeDtoShape>;
  create(input: CreateInitiativeRequest, now: Date): Promise<InitiativeDtoShape>;
  update(id: string, input: UpdateInitiativeRequest, now: Date): Promise<InitiativeDtoShape>;
  transition(
    id: string,
    to: string,
    reason: string | undefined,
    identity: Identity,
    now: Date,
  ): Promise<InitiativeDtoShape>;
  replaceDependencies(
    id: string,
    dependsOn: readonly string[],
    now: Date,
  ): Promise<InitiativeDtoShape>;
  tasks(id: string): Promise<{ initiativeId: string; items: ReturnType<typeof toTaskDto>[] }>;
  scoreHistory(id: string, limit: number): Promise<readonly ScoreRecord[]>;
  rescore(identity: Identity, now: Date): Promise<{ scored: number; changed: number }>;
}

/**
 * The id a not-yet-created initiative carries through the cycle check.
 *
 * Deliberately a sentence rather than a placeholder uuid. The check exists so
 * that a rejected cycle prints its path — "a → b → the initiative being
 * created → a" — and a row of zeroes in that path tells the reader nothing.
 */
const PROSPECTIVE_ID = 'the initiative being created';

/** Everything a schedule needs that is not an initiative (W02's `ScheduleConfig`). */
function scheduleOf(ranking: Ranking, config: WorkConfig): Schedule {
  return computeSchedule({
    initiatives: ranking.initiatives,
    areas: ranking.areas,
    config: {
      ...SCHEDULE_DEFAULTS,
      workingWeekdays: config.workingWeekdays,
      concurrentInitiatives: config.concurrentInitiatives,
      weights: ranking.weights,
    },
    now: ranking.now,
  });
}

/**
 * A schedule, as the Timeline reads it.
 *
 * Extracted so that `/timeline` and the replan preview cannot describe the same
 * plan differently. The preview returns a *diff* rather than a second copy of
 * this shape — the browser substitutes the moved dates onto the bars it already
 * has — but both are read off one mapping, and the one thing worse than no
 * preview is a preview that disagrees with the plan it previews.
 */
function toTimelineShape(schedule: Schedule, snapshot: Ranking): TimelineShape {
  const critical = new Set(schedule.criticalPath);

  const edges: { from: string; to: string; critical: boolean }[] = [];
  for (const scheduled of schedule.initiatives) {
    const initiative = snapshot.recordById.get(scheduled.id);
    for (const dependency of initiative?.dependsOn ?? []) {
      edges.push({
        from: dependency,
        to: scheduled.id,
        critical: critical.has(dependency) && critical.has(scheduled.id),
      });
    }
  }

  return {
    projectStart: schedule.projectStart,
    projectEnd: schedule.projectEnd ?? null,
    weightYear: schedule.config.weightYear,
    weightsStale: schedule.config.weightsStale,
    initiatives: schedule.initiatives.map((scheduled) => {
      const record = snapshot.recordById.get(scheduled.id);
      return {
        initiativeId: scheduled.id,
        title: record?.title ?? '',
        areaKey: scheduled.areaKey,
        projectId: record?.projectId ?? null,
        status: record?.status ?? 'unknown',
        durationDays: scheduled.durationDays,
        plannedStart: scheduled.plannedStart,
        plannedEnd: scheduled.plannedEnd,
        earliestStart: scheduled.earliestStart,
        earliestFinish: scheduled.earliestFinish,
        latestStart: scheduled.latestStart,
        latestFinish: scheduled.latestFinish,
        slackDays: scheduled.slackDays,
        onCriticalPath: scheduled.onCriticalPath,
        deadline: scheduled.deadline ?? null,
        deadlineFeasible: scheduled.deadlineFeasible,
        deadlineSlackDays: scheduled.deadlineSlackDays ?? null,
        boundBy: scheduled.boundBy,
        boundByIds: [...scheduled.boundByIds],
      };
    }),
    edges: edges.sort((left, right) => {
      if (left.from !== right.from) return left.from < right.from ? -1 : 1;
      if (left.to !== right.to) return left.to < right.to ? -1 : 1;
      return 0;
    }),
    criticalPath: [...schedule.criticalPath],
    minSlackDays: schedule.minSlackDays,
    infeasibleDeadlines: [...schedule.infeasibleDeadlines],
    danglingRefs: [...schedule.danglingRefs],
    areaSlots: [...schedule.config.slotsByArea]
      .map(([areaKey, slots]) => ({ areaKey, slots }))
      .sort((left, right) => (left.areaKey < right.areaKey ? -1 : 1)),
  };
}

/** Domain invariants are caller errors at this boundary, not server failures. */
function asApiError(error: unknown): never {
  if (error instanceof InvariantError) {
    throw new ApiError('unprocessable', error.message);
  }
  throw error;
}

export function createWorkService(
  store: ApiStore,
  registry: Registry,
  config: WorkConfig,
): WorkService {
  async function ranking(now: Date): Promise<Ranking> {
    return buildRanking(store, registry, {
      now,
      capacityWindowWeeks: config.capacityWindowWeeks,
      defaultTaskMinutes: config.defaultTaskMinutes,
      limits: config.limits,
    });
  }

  function blockersOf(initiatives: readonly Initiative[]): (id: string) => readonly string[] {
    const statuses = statusIndex(initiatives);
    const byId = new Map(initiatives.map((initiative) => [initiative.id, initiative]));
    return (id: string) => {
      const initiative = byId.get(id);
      if (initiative === undefined) return [];
      return initiative.dependsOn.filter((dependency) => {
        const status = statuses.get(dependency);
        return status === undefined || (status !== 'done' && status !== 'dropped');
      });
    };
  }

  function dtoOf(snapshot: Ranking, id: string): InitiativeDtoShape {
    const record = snapshot.recordById.get(id);
    if (record === undefined) throw notFound('initiative', id);
    const blockers = blockersOf(snapshot.initiatives);
    const scored = snapshot.scoreById.get(id);
    return toInitiativeDto(record, {
      score:
        scored === undefined
          ? undefined
          : {
              initiativeId: id,
              methodId: scored.methodId,
              methodVersion: scored.methodVersion,
              score: scored.score,
              factors: scored.factors,
              explain: scored.explain,
              computedAt: snapshot.now,
            },
      rollup: snapshot.rollupById.get(id),
      blockedBy: blockers(id),
    });
  }

  /**
   * A Focus row: the initiative, why it is where it is, and whether its
   * deadline still fits.
   *
   * `deadlineAtRisk` comes from the schedule engine rather than from a
   * threshold invented here. W02 already answers exactly this question —
   * "does the earliest possible finish fall after the deadline" — and inventing
   * a second answer out of a day count would put two definitions of *at risk*
   * on two screens. prisme flags an infeasible deadline and never moves one
   * (ADR-0003).
   */
  function focusEntry(
    snapshot: Ranking,
    schedule: Schedule,
    selected: {
      initiativeId: string;
      score: number;
      proposedStatus: string;
      reason: string;
      priority: string;
      blockedBy: readonly string[];
    },
  ): FocusEntryShape {
    const initiative = dtoOf(snapshot, selected.initiativeId);
    const planned = schedule.byId.get(selected.initiativeId);
    const deadline = initiative.deadline;

    return {
      initiative,
      score: selected.score,
      rank: snapshot.rankById.get(selected.initiativeId) ?? 0,
      proposedStatus: selected.proposedStatus as FocusEntryShape['proposedStatus'],
      reason: selected.reason as FocusEntryShape['reason'],
      priority: selected.priority as FocusEntryShape['priority'],
      blockedBy: [...selected.blockedBy],
      daysUntilDeadline:
        deadline === null ? null : daysUntil(deadline as CalendarDate, snapshot.now),
      deadlineAtRisk: deadline !== null && planned !== undefined && !planned.deadlineFeasible,
    };
  }

  /** The queue a freed slot would draw from. Capped: it is a preview, not the backlog. */
  const UP_NEXT_LIMIT = 10;

  async function getOne(id: string, now: Date): Promise<InitiativeDtoShape> {
    const record = await store.initiatives.get(id);
    if (record === undefined) throw notFound('initiative', id);
    return dtoOf(await ranking(now), id);
  }

  return {
    async focus(now: Date): Promise<FocusShape> {
      const snapshot = await ranking(now);
      const schedule = scheduleOf(snapshot, config);

      const used = new Map<string, number>();
      for (const slot of snapshot.selection.now) {
        used.set(slot.areaKey, (used.get(slot.areaKey) ?? 0) + 1);
      }

      return {
        asOf: now.toISOString(),
        methodId: snapshot.method.id,
        methodVersion: snapshot.method.version,
        limits: config.limits,
        overCapacity: snapshot.selection.overCapacity,
        weightsStale: snapshot.weightsStale,
        now: snapshot.selection.now.map((slot) => focusEntry(snapshot, schedule, slot)),
        upNext: snapshot.selection.next
          .slice(0, UP_NEXT_LIMIT)
          .map((slot) => focusEntry(snapshot, schedule, slot)),
        slotsByArea: snapshot.areaRecords
          .filter((area) => area.kind === 'area' && area.active)
          .map((area) => ({
            areaKey: area.key,
            kind: area.kind,
            used: used.get(area.key) ?? 0,
            limit: config.limits.maxNowPerArea,
          })),
      };
    },

    async inbox(now: Date): Promise<InboxShape> {
      const snapshot = await ranking(now);
      const blockers = blockersOf(snapshot.initiatives);

      // Action takeaways only. A principle is never a backlog candidate and
      // showing it here would make the Inbox a place to say no repeatedly.
      const takeaways = await store.lanes.takeaways(
        { kind: 'action', promoted: false },
        { limit: 100, offset: 0 },
      );

      return {
        initiatives: snapshot.initiativeRecords
          .filter((record) => record.status === 'inbox')
          .map((record) =>
            toInitiativeDto(record, {
              score: undefined,
              rollup: snapshot.rollupById.get(record.id),
              blockedBy: blockers(record.id),
            }),
          ),
        takeaways: takeaways.items.map(toTakeawayDto),
      };
    },

    async backlog(query: BacklogQuery, now: Date) {
      const snapshot = await ranking(now);

      const filter: InitiativeFilter = {
        areaKeys: query.areaKeys,
        statuses: query.statuses,
        projectId: query.projectId,
        hasDeadline: query.hasDeadline,
        search: query.search,
      };
      const filtered = await store.initiatives.list(filter);

      const rows: BacklogEntryShape[] = filtered.map((record) => {
        const scored = snapshot.scoreById.get(record.id);
        return {
          initiative: dtoOf(snapshot, record.id),
          score: scored?.score ?? null,
          rank: snapshot.rankById.get(record.id) ?? null,
        };
      });

      // `score` consumes the ranking **in the order it arrived**. Re-sorting by
      // score here with a different tie-break would produce a second ordering
      // of the same data, and the one a person reads on this screen would not
      // be the one that chose their week (packages/domain selection §1).
      const ordered = [...rows];
      const sign = query.direction === 'asc' ? 1 : -1;
      if (query.sort === 'score') {
        ordered.sort((left, right) => {
          const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
          const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
          return (leftRank - rightRank) * (query.direction === 'asc' ? 1 : -1);
        });
      } else {
        ordered.sort((left, right) => compare(left, right, query.sort) * sign);
      }

      const window = ordered.slice(query.page.offset, query.page.offset + query.page.limit);

      return {
        items: window,
        total: ordered.length,
        limit: query.page.limit,
        offset: query.page.offset,
        methodId: snapshot.method.id,
        methodVersion: snapshot.method.version,
        sort: `${query.sort}:${query.direction}`,
      };
    },

    async timeline(now: Date): Promise<TimelineShape> {
      const snapshot = await ranking(now);
      return toTimelineShape(scheduleOf(snapshot, config), snapshot);
    },

    async replanTimeline(move: ReplanRequest, now: Date): Promise<ReplanShape> {
      const snapshot = await ranking(now);
      const before = scheduleOf(snapshot, config);

      // `replan` refuses an id it was not built from, and closed work, with an
      // invariant error. Both are the caller naming something unschedulable,
      // which is a `422` rather than a server failure.
      const diff = (() => {
        try {
          return replan(before, {
            id: move.initiativeId,
            newStart: parseCalendarDate(move.newStart),
          });
        } catch (error) {
          return asApiError(error);
        }
      })();

      return {
        move: {
          initiativeId: diff.move.id,
          requestedStart: diff.move.requestedStart,
          actualStart: diff.move.actualStart,
          honoured: diff.move.honoured,
          boundBy: diff.move.boundBy,
        },
        shifted: diff.shifted.map((entry) => ({
          initiativeId: entry.id,
          fromStart: entry.fromStart,
          toStart: entry.toStart,
          fromEnd: entry.fromEnd,
          toEnd: entry.toEnd,
          startDeltaDays: entry.startDeltaDays,
          endDeltaDays: entry.endDeltaDays,
          isDownstream: entry.isDownstream,
        })),
        brokenDeadlines: [...diff.brokenDeadlines],
        repairedDeadlines: [...diff.repairedDeadlines],
        after: {
          projectEnd: diff.after.projectEnd ?? null,
          criticalPath: [...diff.after.criticalPath],
          infeasibleDeadlines: [...diff.after.infeasibleDeadlines],
          minSlackDays: diff.after.minSlackDays,
        },
      };
    },

    get: getOne,

    async create(input: CreateInitiativeRequest, now: Date): Promise<InitiativeDtoShape> {
      const area = await store.areas.get(input.areaKey);
      if (area === undefined) throw notFound('area', input.areaKey);
      if (input.projectId !== undefined) {
        const project = await store.projects.get(input.projectId);
        if (project === undefined) throw notFound('project', input.projectId);
      }

      // The write-time cycle gate, run before the insert rather than after —
      // the database trigger would refuse it too, but a domain error names the
      // path, and the path is the fix.
      if (input.dependsOn.length > 0) {
        const existing = await store.initiatives.list({});
        const prospective: Initiative[] = [
          ...existing.map(toDomain),
          {
            id: PROSPECTIVE_ID,
            title: input.title,
            areaKey: input.areaKey,
            status: 'inbox',
            value: 1,
            timeCriticality: 1,
            risk: 1,
            size: 1,
            dependsOn: input.dependsOn,
            origin: 'created_in_prisme',
          },
        ];
        try {
          assertAcyclic(prospective);
        } catch (error) {
          asApiError(error);
        }
      }

      const created = await store.initiatives.create({ ...input, origin: 'created_in_prisme' });
      return dtoOf(await ranking(now), created.id);
    },

    async update(id, input, now): Promise<InitiativeDtoShape> {
      if (input.areaKey !== undefined) {
        const area = await store.areas.get(input.areaKey);
        if (area === undefined) throw notFound('area', input.areaKey);
      }
      const updated = await store.initiatives.update(id, input);
      if (updated === undefined) throw notFound('initiative', id);
      const snapshot = await ranking(now);
      return dtoOf(snapshot, id);
    },

    async transition(id, to, reason, identity, now): Promise<InitiativeDtoShape> {
      const record = await store.initiatives.get(id);
      if (record === undefined) throw notFound('initiative', id);

      if (to === 'dropped' && reason === undefined && record.droppedReason === null) {
        // A drop with no reason is indistinguishable from a deletion six months
        // later, and the reason is the only part anyone re-reads.
        throw new ApiError('unprocessable', 'dropping an initiative needs a reason');
      }

      // A transition to the status it already holds is not an event. Recording
      // one would put a status change in the log that never happened.
      if (record.status === to) return getOne(id, now);

      await store.initiatives.setStatus(id, to, reason, now);
      await store.ops.appendEvent({
        kind: 'status_changed',
        entityKind: 'initiative',
        entityId: id,
        field: 'status',
        before: record.status,
        after: to,
        actor: identity.kind,
        occurredAt: now,
      });

      const snapshot = await ranking(now);
      return dtoOf(snapshot, id);
    },

    async replaceDependencies(id, dependsOn, now): Promise<InitiativeDtoShape> {
      const record = await store.initiatives.get(id);
      if (record === undefined) throw notFound('initiative', id);

      const existing = await store.initiatives.list({});
      const known = new Set(existing.map((initiative) => initiative.id));
      for (const dependency of dependsOn) {
        if (!known.has(dependency)) throw notFound('initiative', dependency);
      }

      const prospective = existing.map((initiative) =>
        initiative.id === id ? { ...toDomain(initiative), dependsOn } : toDomain(initiative),
      );
      try {
        assertAcyclic(prospective);
      } catch (error) {
        asApiError(error);
      }

      await store.initiatives.replaceDependencies(id, dependsOn);
      const snapshot = await ranking(now);
      return dtoOf(snapshot, id);
    },

    async tasks(id: string) {
      const record = await store.initiatives.get(id);
      if (record === undefined) throw notFound('initiative', id);
      const tasks = await store.initiatives.tasks(id);
      return { initiativeId: id, items: tasks.map(toTaskDto) };
    },

    async scoreHistory(id: string, limit: number): Promise<readonly ScoreRecord[]> {
      const record = await store.initiatives.get(id);
      if (record === undefined) throw notFound('initiative', id);
      return store.initiatives.scoreHistory(id, limit);
    },

    /**
     * Persist a ranking: the *Re-score what changed* step of the weekly review
     * (docs/10-model.md, cadences).
     *
     * Append-only, with the method and version that produced each row, so a
     * score stays attributable to the thing that computed it (ADR-0006). An
     * event is written only where the number actually moved — a log of
     * unchanged scores is a log nobody reads.
     */
    async rescore(identity: Identity, now: Date): Promise<{ scored: number; changed: number }> {
      const snapshot = await ranking(now);
      const previous = new Map(
        (await store.initiatives.latestScores()).map((record) => [record.initiativeId, record]),
      );

      const rows = toScoreRows(snapshot.scored, {
        computedAt: now,
        activeMethodId: snapshot.method.id,
      });

      await store.initiatives.saveScores(
        rows.map((row) => ({
          initiativeId: row.initiativeId,
          methodId: row.methodId,
          methodVersion: row.methodVersion,
          score: row.score,
          factors: row.factors,
          explain: row.explain,
          computedAt: row.computedAt,
        })),
        snapshot.method.id,
      );

      let changed = 0;
      for (const row of rows) {
        const before = previous.get(row.initiativeId);
        if (before !== undefined && before.score === row.score) continue;
        changed += 1;
        await store.ops.appendEvent({
          kind: 'score_changed',
          entityKind: 'initiative',
          entityId: row.initiativeId,
          field: row.methodId,
          before: before?.score ?? null,
          after: row.score,
          actor: identity.kind,
          occurredAt: now,
        });
      }

      return { scored: rows.length, changed };
    },
  };
}

function toDomain(record: {
  id: string;
  title: string;
  areaKey: string;
  status: string;
  value: number;
  timeCriticality: number;
  risk: number;
  size: number;
  dependsOn: readonly string[];
  origin: 'created_in_prisme' | 'adopted';
}): Initiative {
  return {
    id: record.id,
    title: record.title,
    areaKey: record.areaKey,
    status: record.status as Initiative['status'],
    value: record.value as Initiative['value'],
    timeCriticality: record.timeCriticality as Initiative['timeCriticality'],
    risk: record.risk as Initiative['risk'],
    size: record.size as Initiative['size'],
    dependsOn: record.dependsOn,
    origin: record.origin,
  };
}

function compare(left: BacklogEntryShape, right: BacklogEntryShape, sort: BacklogSort): number {
  switch (sort) {
    case 'deadline': {
      // No deadline sorts last whichever direction is asked for: "soonest
      // first" and "latest first" are both questions about deadlines.
      const leftDeadline = left.initiative.deadline;
      const rightDeadline = right.initiative.deadline;
      if (leftDeadline === null && rightDeadline === null) return 0;
      if (leftDeadline === null) return 1;
      if (rightDeadline === null) return -1;
      return leftDeadline < rightDeadline ? -1 : leftDeadline > rightDeadline ? 1 : 0;
    }
    case 'age': {
      if (left.initiative.createdAt === right.initiative.createdAt) return 0;
      return left.initiative.createdAt < right.initiative.createdAt ? -1 : 1;
    }
    case 'size':
      return left.initiative.size - right.initiative.size;
    case 'title':
      return left.initiative.title.localeCompare(right.initiative.title);
    default:
      return 0;
  }
}
