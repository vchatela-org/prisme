import { dayNumberOfDate } from '../entities/calendar.js';
import { InvariantError } from '../entities/errors.js';
import { type Initiative, isClosed } from '../entities/initiative.js';
import { computeSchedule } from './schedule.js';
import type { Move, ReplanDiff, Schedule, ShiftedInitiative } from './types.js';
import { workingDayOnOrAfter, workingDaysBetween } from './working-days.js';

/**
 * Replanning: one initiative moves, and everything that depends on it moves
 * with it (W02 brief §5).
 *
 * The move is applied by **recomputing the whole schedule** from the inputs
 * that produced the first one, with the moved initiative's `earliest_start`
 * rewritten — not by patching dates forward from the move. That is the same
 * level-triggered discipline the reconciler works by (ADR-0009): a diff against
 * a full recomputation is exact by construction, where a patch is exact only
 * for the propagation paths whoever wrote it remembered.
 *
 * It is also why a replan can report a *third* initiative moving. Freeing or
 * taking an area's capacity slot changes what its neighbours can do, and a
 * planner that only ever showed the dependency chain would be hiding the half
 * of the consequence that is about capacity.
 *
 * **A move is a request, not an instruction.** A dependency or a full area can
 * refuse it, and the diff says so rather than silently granting a date the plan
 * cannot support. Nothing here writes a deadline, ever.
 *
 * The moved initiative gets first refusal on its area's slots, but only among
 * the work that is schedulable at the same moment: something already placed
 * while the moved initiative was still waiting on a dependency keeps the slot
 * it took. Pre-empting a placement would mean backtracking, and a planner that
 * backtracks is a planner whose output nobody can follow.
 */
export function replan(before: Schedule, move: Move): ReplanDiff {
  const target = before.input.initiatives.find((initiative) => initiative.id === move.id);
  if (!target) {
    throw new InvariantError(
      'unknown_initiative',
      `cannot replan ${move.id}: it is not in the initiative set this schedule was built from`,
    );
  }
  if (isClosed(target)) {
    throw new InvariantError(
      'unknown_initiative',
      `cannot replan ${move.id}: it is ${target.status}, and closed work is not scheduled`,
    );
  }

  const moved: Initiative = { ...target, earliestStart: move.newStart };
  const after = computeSchedule(
    {
      ...before.input,
      initiatives: before.input.initiatives.map((initiative) =>
        initiative.id === move.id ? moved : initiative,
      ),
    },
    new Set([move.id]),
  );

  const calendar = after.config.calendar;
  const requestedDay = workingDayOnOrAfter(dayNumberOfDate(move.newStart), calendar);

  const shifted: ShiftedInitiative[] = [];
  for (const entry of after.initiatives) {
    const was = before.byId.get(entry.id);
    /* c8 ignore next -- unreachable: a replan changes dates, never the open set */
    if (!was) continue;
    if (was.earliestStart === entry.earliestStart && was.earliestFinish === entry.earliestFinish) {
      continue;
    }

    shifted.push({
      id: entry.id,
      fromStart: was.earliestStart,
      toStart: entry.earliestStart,
      fromEnd: was.earliestFinish,
      toEnd: entry.earliestFinish,
      startDeltaDays: workingDaysBetween(
        dayNumberOfDate(was.earliestStart),
        dayNumberOfDate(entry.earliestStart),
        calendar,
      ),
      endDeltaDays: workingDaysBetween(
        dayNumberOfDate(was.earliestFinish),
        dayNumberOfDate(entry.earliestFinish),
        calendar,
      ),
      isDownstream: entry.id !== move.id,
    });
  }

  // The moved initiative first — it is the thing the human asked about — then
  // the consequences, by id.
  shifted.sort((left, right) => {
    if (left.id === move.id) return -1;
    if (right.id === move.id) return 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const wasInfeasible = new Set(before.infeasibleDeadlines);
  const isInfeasible = new Set(after.infeasibleDeadlines);

  const placed = after.byId.get(move.id);
  /* c8 ignore next 6 -- unreachable: the target is open, so it is always placed */
  if (!placed) {
    throw new InvariantError(
      'unknown_initiative',
      `cannot replan ${move.id}: it was not placed in the recomputed schedule`,
    );
  }

  return {
    move: {
      id: move.id,
      requestedStart: move.newStart,
      actualStart: placed.earliestStart,
      honoured: dayNumberOfDate(placed.earliestStart) === requestedDay,
      boundBy: placed.boundBy,
    },
    shifted,
    brokenDeadlines: after.infeasibleDeadlines.filter((id) => !wasInfeasible.has(id)),
    repairedDeadlines: before.infeasibleDeadlines.filter((id) => !isInfeasible.has(id)),
    before,
    after,
  };
}
