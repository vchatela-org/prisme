import type { Area, AreaKey } from '../entities/area.js';
import { dayNumberOfDate, dayNumberOfInstant } from '../entities/calendar.js';
import { assertAcyclic } from '../entities/dependencies.js';
import { InvariantError } from '../entities/errors.js';
import { type Initiative, type InitiativeId, isClosed } from '../entities/initiative.js';
import { durationDays, resolveScheduleConfig, type ScheduleConfig } from './config.js';
import type { BoundBy, Schedule, ScheduledInitiative, ScheduleInput } from './types.js';
import {
  addWorkingDays,
  dateOfDayNumber,
  isWorkingDay,
  nextWorkingDay,
  subtractWorkingDays,
  workingDayOnOrAfter,
  workingDayOnOrBefore,
  workingDaysBetween,
  type WorkingCalendar,
} from './working-days.js';

/**
 * The schedule engine: a forward pass, a backward pass, and a capacity
 * constraint between them (W02 brief §2–§3).
 *
 * ### What it schedules
 *
 * **Initiatives, never tasks.** prisme schedules the unit it scores; the task
 * tool schedules tasks and due dates stay with the person doing them
 * (ADR-0003, ADR-0004).
 *
 * It schedules **everything it is given that is not closed**. Which initiatives
 * to hand it is a selection question, and selection has its own module with its
 * own rules — an engine that quietly dropped `inbox` work would be making that
 * decision in the wrong place, out of sight. `done` and `dropped` work is
 * excluded because it has no future dates and because a finished predecessor
 * must not hold its successor back.
 *
 * ### Conventions, stated once
 *
 * - Spans are **inclusive working days**: duration `d` starting on working day
 *   `s` finishes at the end of the `d`-th working day, and a dependent may
 *   start the next working day after that.
 * - Slack is in **working days**, and it is signed. Negative slack is a
 *   deadline that cannot be met, propagated backwards through everything that
 *   has to happen first.
 * - Nothing starts before `now`. `now` is a parameter, as everywhere in this
 *   package.
 * - Every collection is sorted explicitly. Identical inputs give an identical
 *   schedule, to the ordering.
 *
 * ### The one thing slack does not know
 *
 * The forward pass is capacity-constrained; **the backward pass is not**. Slack
 * is measured against the dependency network and the deadlines, so an
 * initiative can report slack it cannot actually use, because the days it would
 * slip into belong to the queue behind it in its own area.
 *
 * Fixing that properly means a resource-constrained backward pass, which is an
 * optimiser — exactly what the brief says not to build here. So it is stated
 * instead: slack is an upper bound wherever capacity binds, and `boundBy` is
 * what tells you whether it does.
 */

interface Placement {
  readonly id: InitiativeId;
  readonly start: number;
  readonly end: number;
}

interface Placed extends Placement {
  readonly boundBy: BoundBy;
  readonly boundByIds: readonly InitiativeId[];
}

function byId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Where a constraint puts an initiative's start, and what that constraint was.
 * Ties prefer the dependency: it is the constraint whose movement propagates,
 * so it is the one worth naming on a Timeline edge.
 */
function readyDay(
  initiative: Initiative,
  projectStart: number,
  finishes: ReadonlyMap<InitiativeId, number>,
  predecessors: readonly InitiativeId[],
  calendar: WorkingCalendar,
): { day: number; boundBy: BoundBy; boundByIds: readonly InitiativeId[] } {
  let day = projectStart;
  let boundBy: BoundBy = 'none';
  let boundByIds: readonly InitiativeId[] = [];

  if (initiative.earliestStart !== undefined) {
    const floor = workingDayOnOrAfter(dayNumberOfDate(initiative.earliestStart), calendar);
    if (floor > day) {
      day = floor;
      boundBy = 'earliest_start';
      boundByIds = [];
    } else if (floor === day && boundBy === 'none') {
      boundBy = 'earliest_start';
    }
  }

  const blockers: InitiativeId[] = [];
  let latestPredecessorFinish: number | undefined;
  for (const predecessor of predecessors) {
    const finish = finishes.get(predecessor);
    if (finish === undefined) continue;
    const resume = nextWorkingDay(finish, calendar);
    if (latestPredecessorFinish === undefined || resume > latestPredecessorFinish) {
      latestPredecessorFinish = resume;
      blockers.length = 0;
      blockers.push(predecessor);
    } else if (resume === latestPredecessorFinish) {
      blockers.push(predecessor);
    }
  }

  if (latestPredecessorFinish !== undefined && latestPredecessorFinish >= day) {
    day = latestPredecessorFinish;
    boundBy = 'dependency';
    boundByIds = blockers.sort(byId);
  }

  return { day, boundBy, boundByIds };
}

/**
 * The earliest start at or after `from` where the area still has a free slot
 * for every working day of the span.
 *
 * A slot frees on the working day after something finishes, so the only starts
 * worth trying are `from` itself and the day after each placement that is still
 * running then. The last of those is always feasible, which is what makes the
 * search terminate.
 */
function firstFreeStart(
  from: number,
  duration: number,
  slots: number,
  peers: readonly Placement[],
  calendar: WorkingCalendar,
): { start: number; blockedBy: readonly InitiativeId[] } {
  const candidates = new Set<number>([from]);
  for (const peer of peers) {
    if (peer.end >= from) candidates.add(nextWorkingDay(peer.end, calendar));
  }

  for (const start of [...candidates].sort((left, right) => left - right)) {
    const end = addWorkingDays(start, duration - 1, calendar);
    let free = true;
    for (let day = start; day <= end && free; day++) {
      if (!isWorkingDay(day, calendar)) continue;
      let occupied = 0;
      for (const peer of peers) {
        if (peer.start <= day && day <= peer.end) occupied++;
      }
      if (occupied >= slots) free = false;
    }
    if (!free) continue;

    if (start === from) return { start, blockedBy: [] };
    const blockedBy = peers
      .filter((peer) => peer.end < start && nextWorkingDay(peer.end, calendar) === start)
      .map((peer) => peer.id)
      .sort(byId);
    return { start, blockedBy };
  }

  /* c8 ignore next 5 -- unreachable: the last candidate starts after every peer has finished */
  throw new InvariantError(
    'invalid_limits',
    'no free capacity slot could be found, which should be impossible once every placement has finished',
  );
}

/**
 * `priorityIds` get first refusal on their area's slots. `replan` uses it so
 * that the initiative a human just moved is placed before the work that has to
 * yield to it, rather than after it and behind it.
 */
export function computeSchedule(
  input: ScheduleInput,
  priorityIds: ReadonlySet<InitiativeId> = new Set(),
): Schedule {
  const { initiatives, areas, config, now } = input;
  const resolved = resolveScheduleConfig(config, areas, now);
  const calendar = resolved.calendar;

  // The write-time gate, run here too: a cyclic graph has no forward pass, and
  // "a cycle was detected" without the path sends someone hunting by hand.
  const graph = assertAcyclic(initiatives);

  const open = initiatives
    .filter((initiative) => !isClosed(initiative))
    .sort((l, r) => byId(l.id, r.id));
  const excluded = initiatives
    .filter(isClosed)
    .map((initiative) => initiative.id)
    .sort(byId);

  const openById = new Map<InitiativeId, Initiative>();
  for (const initiative of open) openById.set(initiative.id, initiative);

  const areaKeys = new Set<AreaKey>(areas.map((area: Area) => area.key));
  for (const initiative of open) {
    if (!areaKeys.has(initiative.areaKey)) {
      throw new InvariantError(
        'unknown_area',
        `initiative ${initiative.id} names area "${initiative.areaKey}", which is not in the area set`,
      );
    }
  }

  // Predecessors and successors, restricted to the open set. A dependency on
  // finished work is satisfied; a dependency on work prisme has not ingested is
  // recorded as dangling and constrains nothing, because there is no date to
  // constrain with.
  const predecessors = new Map<InitiativeId, readonly InitiativeId[]>();
  const successors = new Map<InitiativeId, InitiativeId[]>();
  for (const initiative of open) successors.set(initiative.id, []);
  for (const initiative of open) {
    const preds = [...initiative.dependsOn].filter((id) => openById.has(id)).sort(byId);
    predecessors.set(initiative.id, preds);
    for (const predecessor of preds) successors.get(predecessor)?.push(initiative.id);
  }

  const projectStart = workingDayOnOrAfter(dayNumberOfInstant(now), calendar);
  const duration = new Map<InitiativeId, number>();
  for (const initiative of open) {
    duration.set(initiative.id, durationDays(initiative.size, resolved));
  }

  // --- Forward pass ---------------------------------------------------------
  // Kahn's algorithm, with the ready set kept sorted, so the order is a fact
  // about the graph rather than about map iteration. Iterative on purpose: the
  // one recursion in this package is already noted as a limit (W01 journal).
  const remaining = new Map<InitiativeId, number>();
  for (const initiative of open) {
    remaining.set(initiative.id, (predecessors.get(initiative.id) ?? []).length);
  }

  // Unconstrained earliest starts drive the greedy order: work that could start
  // sooner gets the slot first, which is both intuitive and stable.
  const unconstrained = new Map<InitiativeId, number>();
  const placements = new Map<InitiativeId, Placed>();
  const finishes = new Map<InitiativeId, number>();
  const byArea = new Map<AreaKey, Placement[]>();

  let ready = open.filter((initiative) => remaining.get(initiative.id) === 0).map((i) => i.id);
  const topological: InitiativeId[] = [];

  while (ready.length > 0) {
    // An initiative becomes ready only once every predecessor is placed, so its
    // constraint-driven start is settled the moment it enters the list and does
    // not move afterwards. Computing it here keeps the comparison below honest.
    for (const id of ready) {
      if (unconstrained.has(id)) continue;
      const initiative = openById.get(id);
      /* c8 ignore next -- unreachable: `ready` only ever holds open ids */
      if (!initiative) continue;
      unconstrained.set(
        id,
        readyDay(initiative, projectStart, finishes, predecessors.get(id) ?? [], calendar).day,
      );
    }

    // Moved work first, then whatever could start soonest, then the id.
    const ordered = [...ready].sort((left, right) => {
      const pinned = Number(priorityIds.has(right)) - Number(priorityIds.has(left));
      if (pinned !== 0) return pinned;
      const earliest = (unconstrained.get(left) ?? 0) - (unconstrained.get(right) ?? 0);
      if (earliest !== 0) return earliest;
      return byId(left, right);
    });

    const id = ordered[0];
    /* c8 ignore next -- unreachable: the loop condition guarantees one entry */
    if (id === undefined) break;
    ready = ready.filter((candidate) => candidate !== id);
    topological.push(id);

    const initiative = openById.get(id);
    /* c8 ignore next -- unreachable: `ready` only ever holds open ids */
    if (!initiative) continue;

    const days = duration.get(id) ?? 1;
    const constraint = readyDay(
      initiative,
      projectStart,
      finishes,
      predecessors.get(id) ?? [],
      calendar,
    );

    const peers = byArea.get(initiative.areaKey) ?? [];
    const slots = resolved.slotsByArea.get(initiative.areaKey) ?? 1;
    const free = firstFreeStart(constraint.day, days, slots, peers, calendar);

    const start = free.start;
    const end = addWorkingDays(start, days - 1, calendar);
    const pushedByCapacity = start > constraint.day;

    placements.set(id, {
      id,
      start,
      end,
      boundBy: pushedByCapacity ? 'capacity' : constraint.boundBy,
      boundByIds: pushedByCapacity ? free.blockedBy : constraint.boundByIds,
    });
    finishes.set(id, end);
    peers.push({ id, start, end });
    byArea.set(initiative.areaKey, peers);

    for (const successor of successors.get(id) ?? []) {
      const left = (remaining.get(successor) ?? 1) - 1;
      remaining.set(successor, left);
      if (left === 0) ready.push(successor);
    }
  }

  /* c8 ignore next 6 -- unreachable: assertAcyclic already refused a cycle */
  if (topological.length !== open.length) {
    throw new InvariantError(
      'dependency_cycle',
      'the dependency graph did not fully order, which should be impossible after assertAcyclic',
    );
  }

  // --- Backward pass --------------------------------------------------------
  let projectEndDay: number | undefined;
  for (const placement of placements.values()) {
    if (projectEndDay === undefined || placement.end > projectEndDay) projectEndDay = placement.end;
  }

  const latestFinish = new Map<InitiativeId, number>();
  const latestStart = new Map<InitiativeId, number>();

  for (const id of [...topological].reverse()) {
    const initiative = openById.get(id);
    /* c8 ignore next -- unreachable: topological holds only open ids */
    if (!initiative) continue;
    const days = duration.get(id) ?? 1;

    let finish = projectEndDay ?? projectStart;
    let bounded = false;
    for (const successor of successors.get(id) ?? []) {
      const successorStart = latestStart.get(successor);
      /* c8 ignore next -- unreachable: successors are visited first in reverse order */
      if (successorStart === undefined) continue;
      const candidate = workingDayOnOrBefore(successorStart - 1, calendar);
      if (!bounded || candidate < finish) {
        finish = candidate;
        bounded = true;
      }
    }

    // A deadline is an imposed finish: it bounds the latest finish, and where it
    // is impossible that shows up as negative slack here and in everything
    // upstream. The deadline itself is never moved (ADR-0003).
    if (initiative.deadline !== undefined) {
      const imposed = workingDayOnOrBefore(dayNumberOfDate(initiative.deadline), calendar);
      if (!bounded || imposed < finish) finish = imposed;
    }

    latestFinish.set(id, finish);
    latestStart.set(id, subtractWorkingDays(finish, days - 1, calendar));
  }

  // --- Slack, the critical path, and feasibility ----------------------------
  const slack = new Map<InitiativeId, number>();
  let minSlackDays = 0;
  let first = true;
  for (const id of topological) {
    const placement = placements.get(id);
    const finish = latestFinish.get(id);
    /* c8 ignore next -- unreachable: both maps are filled for every ordered id */
    if (!placement || finish === undefined) continue;
    const value = workingDaysBetween(placement.end, finish, calendar);
    slack.set(id, value);
    if (first || value < minSlackDays) {
      minSlackDays = value;
      first = false;
    }
  }

  const criticalPath = longestChain(
    topological.filter((id) => slack.get(id) === minSlackDays),
    predecessors,
    duration,
  );

  const scheduled: ScheduledInitiative[] = [];
  const infeasibleDeadlines: InitiativeId[] = [];

  for (const id of topological) {
    const initiative = openById.get(id);
    const placement = placements.get(id);
    const finish = latestFinish.get(id);
    const start = latestStart.get(id);
    /* c8 ignore next -- unreachable: every ordered id was placed above */
    if (!initiative || !placement || finish === undefined || start === undefined) continue;

    const earliestStart = dateOfDayNumber(placement.start);
    const earliestFinish = dateOfDayNumber(placement.end);

    let deadlineFeasible = true;
    let deadlineSlackDays: number | undefined;
    if (initiative.deadline !== undefined) {
      const due = workingDayOnOrBefore(dayNumberOfDate(initiative.deadline), calendar);
      deadlineSlackDays = workingDaysBetween(placement.end, due, calendar);
      deadlineFeasible = placement.end <= dayNumberOfDate(initiative.deadline);
      if (!deadlineFeasible) infeasibleDeadlines.push(id);
    }

    scheduled.push({
      id,
      areaKey: initiative.areaKey,
      durationDays: duration.get(id) ?? 1,
      earliestStart,
      earliestFinish,
      latestStart: dateOfDayNumber(start),
      latestFinish: dateOfDayNumber(finish),
      slackDays: slack.get(id) ?? 0,
      onCriticalPath: slack.get(id) === minSlackDays,
      deadlineFeasible,
      ...(initiative.deadline === undefined ? {} : { deadline: initiative.deadline }),
      ...(deadlineSlackDays === undefined ? {} : { deadlineSlackDays }),
      boundBy: placement.boundBy,
      boundByIds: placement.boundByIds,
      plannedStart: earliestStart,
      plannedEnd: earliestFinish,
    });
  }

  scheduled.sort((left, right) =>
    left.earliestStart === right.earliestStart
      ? byId(left.id, right.id)
      : byId(left.earliestStart, right.earliestStart),
  );

  const index = new Map<InitiativeId, ScheduledInitiative>();
  for (const entry of scheduled) index.set(entry.id, entry);

  return {
    projectStart: dateOfDayNumber(projectStart),
    projectEnd: projectEndDay === undefined ? undefined : dateOfDayNumber(projectEndDay),
    initiatives: scheduled,
    byId: index,
    criticalPath,
    minSlackDays: scheduled.length === 0 ? 0 : minSlackDays,
    infeasibleDeadlines: infeasibleDeadlines.sort(byId),
    excluded,
    danglingRefs: graph.danglingRefs,
    config: resolved,
    input,
  };
}

/**
 * The longest chain of dependency edges through the minimum-slack set.
 *
 * Textbook CPM calls the zero-slack chain critical. A deadline that cannot be
 * met drives the minimum below zero, and the chain that runs at that minimum is
 * the one to look at — so the definition here is *minimum* slack rather than
 * zero, which reduces to the textbook one whenever every deadline is feasible.
 *
 * Longest by total duration, ties broken by id, so the same graph always
 * returns the same path.
 */
function longestChain(
  ordered: readonly InitiativeId[],
  predecessors: ReadonlyMap<InitiativeId, readonly InitiativeId[]>,
  duration: ReadonlyMap<InitiativeId, number>,
): readonly InitiativeId[] {
  const members = new Set<InitiativeId>(ordered);
  const best = new Map<InitiativeId, number>();
  const parent = new Map<InitiativeId, InitiativeId>();

  for (const id of ordered) {
    const days = duration.get(id) ?? 1;
    let longest = days;
    let from: InitiativeId | undefined;

    for (const predecessor of [...(predecessors.get(id) ?? [])].sort(byId)) {
      if (!members.has(predecessor)) continue;
      const candidate = (best.get(predecessor) ?? 0) + days;
      if (candidate > longest) {
        longest = candidate;
        from = predecessor;
      }
    }

    best.set(id, longest);
    if (from !== undefined) parent.set(id, from);
  }

  let tail: InitiativeId | undefined;
  for (const id of [...ordered].sort(byId)) {
    if (tail === undefined || (best.get(id) ?? 0) > (best.get(tail) ?? 0)) tail = id;
  }

  const path: InitiativeId[] = [];
  for (let node = tail; node !== undefined; node = parent.get(node)) path.unshift(node);
  return path;
}

/**
 * The public entry point (W02 brief, *Contract*).
 *
 * Pure: `now` and the configuration are arguments, and the same inputs always
 * produce the same schedule, ordering included.
 */
export function schedule(
  initiatives: readonly Initiative[],
  areas: readonly Area[],
  config: ScheduleConfig,
  now: Date,
): Schedule {
  return computeSchedule({ initiatives, areas, config, now });
}

/** The critical path of a computed schedule, in dependency order. */
export function criticalPath(computed: Schedule): readonly InitiativeId[] {
  return computed.criticalPath;
}
