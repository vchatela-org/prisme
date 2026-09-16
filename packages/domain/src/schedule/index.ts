/**
 * The schedule and dependency engine (W02).
 *
 * `schedule` computes a plan; `replan` recomputes one around a move and returns
 * an exact diff; `criticalPath` reads the chain back off a computed schedule.
 * Pure, like the rest of `packages/domain` — `now` and the configuration are
 * arguments.
 *
 * Rendering belongs to W10, persistence to W04 and W05, and scheduling
 * individual tasks belongs to nobody: prisme schedules initiatives, and due
 * dates stay with the person doing the work (ADR-0003).
 */

export {
  CANDIDATE_CONCURRENT_INITIATIVES,
  DEFAULT_DURATION_DAYS_BY_SIZE,
  DEFAULT_WORKING_WEEKDAYS,
  durationDays,
  resolveScheduleConfig,
  SCHEDULE_DEFAULTS,
  type ResolvedScheduleConfig,
  type ScheduleConfig,
} from './config.js';
export { computeSchedule, criticalPath, schedule } from './schedule.js';
export { replan } from './replan.js';
export type {
  BoundBy,
  Move,
  ReplanDiff,
  Schedule,
  ScheduledInitiative,
  ScheduleInput,
  ShiftedInitiative,
} from './types.js';
export {
  addWorkingDays,
  buildWorkingCalendar,
  dateOfDayNumber,
  isWorkingDay,
  nextWorkingDay,
  subtractWorkingDays,
  weekdayOfDayNumber,
  WEEKDAY_NAMES,
  workingDayOnOrAfter,
  workingDayOnOrBefore,
  workingDaysBetween,
  type WorkingCalendar,
} from './working-days.js';
