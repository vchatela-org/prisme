import type { Area, AreaKey } from '../entities/area.js';
import type { CalendarDate } from '../entities/calendar.js';
import type { Initiative, InitiativeId } from '../entities/initiative.js';
import type { ResolvedScheduleConfig, ScheduleConfig } from './config.js';

/**
 * What the schedule engine returns, and the vocabulary the Timeline surface
 * (W10) speaks.
 *
 * Two things in here are not decoration. **`boundBy`** says which constraint
 * decided a date, because a Gantt chart nobody can interrogate is a Gantt chart
 * nobody trusts — and an unexplainable plan gets overridden once and ignored
 * afterwards. **`deadlineFeasible`** is a flag and only a flag: prisme never
 * moves a deadline to make a plan work (ADR-0003, W02 brief §4).
 */

/** Which constraint decided an initiative's earliest start. */
export type BoundBy = 'dependency' | 'earliest_start' | 'capacity' | 'none';

export interface ScheduledInitiative {
  readonly id: InitiativeId;
  readonly areaKey: AreaKey;
  /** Working days for this slice, from the configured size table. */
  readonly durationDays: number;

  readonly earliestStart: CalendarDate;
  readonly earliestFinish: CalendarDate;
  readonly latestStart: CalendarDate;
  readonly latestFinish: CalendarDate;

  /**
   * Working days the finish could slip before something breaks. Negative means
   * it is already too late — a deadline that cannot be met, propagated back
   * through everything that has to happen first.
   */
  readonly slackDays: number;
  readonly onCriticalPath: boolean;

  /** True when there is no deadline: nothing to miss. */
  readonly deadlineFeasible: boolean;
  readonly deadline?: CalendarDate | undefined;
  /** Working days between the earliest finish and the deadline. Signed. */
  readonly deadlineSlackDays?: number | undefined;

  readonly boundBy: BoundBy;
  /**
   * For `boundBy: 'dependency'`, the predecessors whose finish set the date —
   * sorted, and usually one. The Timeline draws these edges thicker.
   */
  readonly boundByIds: readonly InitiativeId[];

  /**
   * What the reconciler writes back to `planned_start` / `planned_end`
   * (docs/10-model.md §5). The same days as the earliest start and finish: a
   * plan is what you intend to do first, not the last moment you could.
   */
  readonly plannedStart: CalendarDate;
  readonly plannedEnd: CalendarDate;
}

export interface Schedule {
  /** The first day anything may start: the first working day on or after `now`. */
  readonly projectStart: CalendarDate;
  /** The last earliest-finish in the plan. Absent when nothing was scheduled. */
  readonly projectEnd: CalendarDate | undefined;

  /** Sorted by earliest start, then by id. Deterministic for equal inputs. */
  readonly initiatives: readonly ScheduledInitiative[];
  readonly byId: ReadonlyMap<InitiativeId, ScheduledInitiative>;

  /** In dependency order, earliest first. Empty when nothing was scheduled. */
  readonly criticalPath: readonly InitiativeId[];
  /** The slack the critical path runs at. `0` unless a deadline cannot be met. */
  readonly minSlackDays: number;

  /** Initiatives whose earliest finish falls after their deadline. Sorted. */
  readonly infeasibleDeadlines: readonly InitiativeId[];

  /** `done` and `dropped` work, which is not scheduled and blocks nothing. */
  readonly excluded: readonly InitiativeId[];
  /**
   * Ids depended on that are not in the input at all. They constrain nothing —
   * there is no date to constrain with — so the plan is optimistic exactly
   * here, and says so rather than hiding it.
   */
  readonly danglingRefs: readonly InitiativeId[];

  readonly config: ResolvedScheduleConfig;
  /**
   * The inputs, kept so `replan` can recompute from them. A schedule is derived
   * data; holding what derived it is what lets a replan be a full recomputation
   * rather than a patch, which is the same level-triggered discipline the
   * reconciler works by (ADR-0011).
   */
  readonly input: ScheduleInput;
}

export interface ScheduleInput {
  readonly initiatives: readonly Initiative[];
  readonly areas: readonly Area[];
  readonly config: ScheduleConfig;
  readonly now: Date;
}

export interface Move {
  readonly id: InitiativeId;
  /** Where the human wants it to start. Snapped forward to a working day. */
  readonly newStart: CalendarDate;
}

export interface ShiftedInitiative {
  readonly id: InitiativeId;
  readonly fromStart: CalendarDate;
  readonly toStart: CalendarDate;
  readonly fromEnd: CalendarDate;
  readonly toEnd: CalendarDate;
  /** Working days the start moved. Negative means earlier. */
  readonly startDeltaDays: number;
  readonly endDeltaDays: number;
  /** True for everything except the initiative that was moved. */
  readonly isDownstream: boolean;
}

export interface ReplanDiff {
  readonly move: {
    readonly id: InitiativeId;
    readonly requestedStart: CalendarDate;
    readonly actualStart: CalendarDate;
    /**
     * False when a dependency or the area's capacity refused the requested day.
     * The engine never quietly grants a move it cannot honour.
     */
    readonly honoured: boolean;
    readonly boundBy: BoundBy;
  };
  /** Every initiative whose dates changed, the moved one first, then by id. */
  readonly shifted: readonly ShiftedInitiative[];
  /** Deadlines that were feasible before the move and are not after it. Sorted. */
  readonly brokenDeadlines: readonly InitiativeId[];
  /** Deadlines the move repaired. Sorted. */
  readonly repairedDeadlines: readonly InitiativeId[];
  readonly before: Schedule;
  readonly after: Schedule;
}
