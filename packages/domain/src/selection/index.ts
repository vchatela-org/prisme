import { type Area, type AreaKey, isRankable } from '../entities/area.js';
import type { CalendarDate } from '../entities/calendar.js';
import { blockedBy, statusIndex } from '../entities/dependencies.js';
import { InvariantError } from '../entities/errors.js';
import {
  type Initiative,
  type InitiativeId,
  isClosed,
  isSizedForNow,
} from '../entities/initiative.js';
import type { ProjectId, ProjectStatus } from '../entities/project.js';
import type { TaskPriority } from '../entities/task.js';
import type { ScoredInitiative } from '../scoring/types.js';

/**
 * Selecting the `now` set (docs/12-scoring.md §5).
 *
 * **Scoring ranks; selection decides.** They are separate steps on purpose, and
 * the worked example in that spec exists to show them disagreeing: an
 * initiative can outrank another on raw WSJF and still not be picked, because
 * its area already holds a slot and the work in flight keeps its place.
 * Thrashing the top of the list every time a score shifts is how a system loses
 * trust.
 *
 * The ranking is consumed **in the order it arrives**. Re-sorting here with a
 * different tie-break would mean two orderings of the same data, and the one a
 * person read on the Backlog screen would not be the one that chose their week.
 */

export interface SelectionLimits {
  /** Overall work-in-progress cap. */
  readonly maxNow: number;
  /** Per-area cap — what keeps one busy area from occupying every slot. */
  readonly maxNowPerArea: number;
}

/**
 * The starting point named in **OQ-2**, which is open: one `now` per area, five
 * overall. It is a personal calibration rather than a derivable number, so it
 * is configuration — `selectNowSet` takes limits as an argument and has no
 * default, and OQ-2 asks for the real value to be picked at the first review.
 * Nothing here decides that question.
 */
export const CANDIDATE_SELECTION_LIMITS: SelectionLimits = {
  maxNow: 5,
  maxNowPerArea: 1,
};

export type ProposedStatus = 'now' | 'next' | 'later' | 'unchanged';

/**
 * Why an initiative is not under way yet (ADR-0035): it may not start before a
 * later day, or the project it belongs to is not active.
 */
export type NotUnderWay = 'not_started' | 'project_inactive';

/** What deciding whether work is under way needs to know. */
export interface UnderWayContext {
  /** Today in the instance's timezone. */
  readonly today: CalendarDate;
  /**
   * Each project's status. A project missing here counts as active, so a
   * dangling reference never hides the work that names it.
   */
  readonly projectStatusById: ReadonlyMap<ProjectId, ProjectStatus>;
}

/**
 * Whether an initiative is under way on `today`, and if not, why (ADR-0035).
 *
 * **Only what is under way is prioritized.** An initiative whose
 * `earliest_start` is after today is a plan for later, and one whose project
 * is paused, done or dropped belongs to an effort that has stopped. Neither is
 * offered a `now` slot, queued behind one, or given a rank. It is still scored,
 * because the score describes the initiative, and it comes back without anyone
 * touching it once its day comes or its project resumes.
 *
 * `undefined` means under way. The status is not read here: an initiative
 * already `now` was put there by a person, and selection keeps it in flight.
 */
export function notUnderWay(
  initiative: Initiative,
  context: UnderWayContext,
): NotUnderWay | undefined {
  if (initiative.earliestStart !== undefined && initiative.earliestStart > context.today) {
    return 'not_started';
  }
  if (initiative.projectId !== undefined) {
    const status = context.projectStatusById.get(initiative.projectId);
    if (status !== undefined && status !== 'active') return 'project_inactive';
  }
  return undefined;
}

export type SelectionReason =
  | 'in_flight'
  | 'selected'
  | 'area_at_cap'
  | 'wip_full'
  | 'blocked'
  | 'too_large'
  | 'not_a_candidate'
  | NotUnderWay;

export interface RankedInitiative {
  readonly initiative: Initiative;
  readonly score: number;
  /**
   * Dependencies that are neither `done` nor `dropped`, resolved against the
   * **whole** initiative set rather than the ranked subset. Closed work is not
   * scored, so resolving blockers inside the ranking would report a finished
   * predecessor as a blocker and hold its successor back forever.
   */
  readonly blockedBy: readonly InitiativeId[];
}

export interface SelectedInitiative {
  readonly initiativeId: InitiativeId;
  readonly areaKey: AreaKey;
  readonly score: number;
  readonly proposedStatus: ProposedStatus;
  readonly reason: SelectionReason;
  readonly priority: TaskPriority;
  readonly blockedBy: readonly InitiativeId[];
}

export interface Selection {
  readonly now: readonly SelectedInitiative[];
  readonly next: readonly SelectedInitiative[];
  readonly later: readonly SelectedInitiative[];
  /**
   * Inbox, waiting, review and closed work, and work not under way yet: not
   * part of this question.
   */
  readonly untouched: readonly SelectedInitiative[];
  readonly priorities: ReadonlyMap<InitiativeId, TaskPriority>;
  /**
   * More work is already in flight than `maxNow` allows. Nothing is demoted for
   * it — demotion is a decision made at a review, not by arithmetic — but the
   * surface should say so.
   */
  readonly overCapacity: boolean;
}

/**
 * Joins a ranking to the initiatives it ranked, preserving the ranked order and
 * resolving each one's blockers against the full set.
 */
export function rank(
  scored: readonly ScoredInitiative[],
  initiatives: readonly Initiative[],
): readonly RankedInitiative[] {
  const byId = new Map<InitiativeId, Initiative>();
  for (const initiative of initiatives) byId.set(initiative.id, initiative);
  const statuses = statusIndex(initiatives);

  return scored.map((result) => {
    const initiative = byId.get(result.initiativeId);
    if (!initiative) {
      throw new InvariantError(
        'unknown_initiative',
        `the ranking names ${result.initiativeId}, which is not in the initiative set`,
      );
    }
    return { initiative, score: result.score, blockedBy: blockedBy(initiative, statuses) };
  });
}

const TOP_PRIORITY_SLOTS = 3;

function assertWholeSlots(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvariantError(
      'invalid_limits',
      `${name} must be a whole number of slots, not ${String(value)}`,
    );
  }
}

/**
 * Chooses the `now` set from a ranking.
 *
 * 1. **In-flight work keeps its slot.** Status `now` stays, whatever it scores.
 * 2. **Free slots fill from the top**, skipping areas already at their cap and
 *    work not under way yet (ADR-0035), which is not queued either.
 * 3. **Work in progress is capped**, overall and per area.
 * 4. **Priority is written outward**: top 3 `now` → highest, remaining `now` →
 *    high, `next` anchors → medium, everything else → lowest.
 */
export function selectNowSet(
  scored: readonly RankedInitiative[],
  areas: readonly Area[],
  limits: SelectionLimits,
  underWay: UnderWayContext,
): Selection {
  assertWholeSlots('maxNow', limits.maxNow);
  assertWholeSlots('maxNowPerArea', limits.maxNowPerArea);

  const rankableAreas = new Set<AreaKey>(areas.filter(isRankable).map((area) => area.key));

  const perArea = new Map<AreaKey, number>();
  const now: SelectedInitiative[] = [];
  const next: SelectedInitiative[] = [];
  const later: SelectedInitiative[] = [];
  const untouched: SelectedInitiative[] = [];

  function take(entry: RankedInitiative, reason: SelectionReason): void {
    const areaKey = entry.initiative.areaKey;
    perArea.set(areaKey, (perArea.get(areaKey) ?? 0) + 1);
    now.push({
      initiativeId: entry.initiative.id,
      areaKey,
      score: entry.score,
      proposedStatus: 'now',
      reason,
      // Replaced once the set is closed: a slot's priority depends on how many
      // ended up above it.
      priority: 'high',
      blockedBy: entry.blockedBy,
    });
  }

  function place(
    entry: RankedInitiative,
    proposedStatus: ProposedStatus,
    reason: SelectionReason,
  ): void {
    const row: SelectedInitiative = {
      initiativeId: entry.initiative.id,
      areaKey: entry.initiative.areaKey,
      score: entry.score,
      proposedStatus,
      reason,
      priority: proposedStatus === 'next' ? 'medium' : 'lowest',
      blockedBy: entry.blockedBy,
    };
    if (proposedStatus === 'next') next.push(row);
    else if (proposedStatus === 'later') later.push(row);
    else untouched.push(row);
  }

  // Pass one: in-flight work, in ranked order, keeps its slot unconditionally.
  for (const entry of scored) {
    if (entry.initiative.status === 'now') take(entry, 'in_flight');
  }

  // Pass two: free slots, from the top of the ranking.
  for (const entry of scored) {
    const initiative = entry.initiative;
    if (initiative.status === 'now') continue;

    const isCandidate =
      (initiative.status === 'next' || initiative.status === 'later') &&
      !isClosed(initiative) &&
      rankableAreas.has(initiative.areaKey);

    if (!isCandidate) {
      place(entry, 'unchanged', 'not_a_candidate');
      continue;
    }

    const notYet = notUnderWay(initiative, underWay);
    if (notYet !== undefined) {
      place(entry, 'unchanged', notYet);
      continue;
    }

    // Where a candidate lands when it is not selected: back where it was.
    const fallback: ProposedStatus = initiative.status === 'later' ? 'later' : 'next';

    if (entry.blockedBy.length > 0) {
      place(entry, fallback, 'blocked');
    } else if (!isSizedForNow(initiative)) {
      place(entry, fallback, 'too_large');
    } else if (now.length >= limits.maxNow) {
      place(entry, fallback, 'wip_full');
    } else if ((perArea.get(initiative.areaKey) ?? 0) >= limits.maxNowPerArea) {
      place(entry, fallback, 'area_at_cap');
    } else {
      take(entry, 'selected');
    }
  }

  // Priority, once the set is closed (docs/12-scoring.md §5.4).
  const withPriority = now.map((slot, index): SelectedInitiative => ({
    ...slot,
    priority: index < TOP_PRIORITY_SLOTS ? 'highest' : 'high',
  }));

  const priorities = new Map<InitiativeId, TaskPriority>();
  for (const slot of [...withPriority, ...next, ...later, ...untouched]) {
    priorities.set(slot.initiativeId, slot.priority);
  }

  return {
    now: withPriority,
    next,
    later,
    untouched,
    priorities,
    overCapacity: withPriority.length > limits.maxNow,
  };
}
