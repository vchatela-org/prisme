import type { Area, AreaKey, AreaWeight } from '../entities/area.js';
import { resolveWeights } from '../entities/area.js';
import { type CalendarDate, type Year, yearOfInstant } from '../entities/calendar.js';
import { InvariantError } from '../entities/errors.js';
import { FIBONACCI_SCALE, type Fibonacci } from '../entities/fibonacci.js';
import { buildWorkingCalendar, type WorkingCalendar } from './working-days.js';

/**
 * Everything the schedule engine needs that is not an initiative: how long a
 * size takes, which days are worked, and how much of the week each area gets.
 *
 * All of it is an argument. The engine has no constants of its own and no
 * clock — `now` is passed in like everywhere else in this package.
 */

/**
 * `size` → working days.
 *
 * The default is the **identity map**, and that is deliberate. The brief says
 * this table is "calibrated later against observed cycle times"; until those
 * exist, any other curve would be a fabricated calibration that looks like
 * evidence. Points are already a rough day count on a Fibonacci scale, so
 * identity is the assumption that adds nothing — and W13's completion history
 * is what should replace it.
 *
 * Replace it through configuration, not by editing this constant.
 */
export const DEFAULT_DURATION_DAYS_BY_SIZE: Readonly<Record<Fibonacci, number>> = {
  1: 1,
  2: 2,
  3: 3,
  5: 5,
  8: 8,
  13: 13,
};

/** Monday to Friday. `0` is Sunday, matching `Date.prototype.getUTCDay`. */
export const DEFAULT_WORKING_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

export interface ScheduleConfig {
  /** Working days per `size`. Must be positive and non-decreasing up the scale. */
  readonly durationDaysBySize: Readonly<Record<Fibonacci, number>>;
  readonly workingWeekdays: readonly number[];
  readonly holidays: readonly CalendarDate[];
  /**
   * How many initiatives one person can have genuinely in flight at once. The
   * year's weights divide this between the areas — that is the whole of the
   * capacity constraint, and deliberately so: the goal is a plausible plan, not
   * an optimiser (W02 brief, *Notes*).
   */
  readonly concurrentInitiatives: number;
  /** Year-scoped, always (ADR-0007). */
  readonly weights: readonly AreaWeight[];
  /** Defaults to the year `now` falls in. */
  readonly weightYear?: Year | undefined;
}

/**
 * The candidate parallelism, matching the `maxNow` in
 * `CANDIDATE_SELECTION_LIMITS`. Both are the same human question — how much can
 * actually be in flight — and **OQ-2 is open**, so this decides nothing either.
 */
export const CANDIDATE_CONCURRENT_INITIATIVES = 5;

export const SCHEDULE_DEFAULTS: Omit<ScheduleConfig, 'weights'> = {
  durationDaysBySize: DEFAULT_DURATION_DAYS_BY_SIZE,
  workingWeekdays: DEFAULT_WORKING_WEEKDAYS,
  holidays: [],
  concurrentInitiatives: CANDIDATE_CONCURRENT_INITIATIVES,
};

export interface ResolvedScheduleConfig {
  readonly durationDaysBySize: Readonly<Record<Fibonacci, number>>;
  readonly calendar: WorkingCalendar;
  readonly concurrentInitiatives: number;
  /** The year asked for. */
  readonly weightYear: Year;
  /** The year the weights came from, `undefined` when none were ever set. */
  readonly weightSourceYear: Year | undefined;
  /** The weights behind the slot counts were carried forward, or are absent. */
  readonly weightsStale: boolean;
  /** Concurrent initiatives each area may run. At least one, always. */
  readonly slotsByArea: ReadonlyMap<AreaKey, number>;
}

function assertDurationTable(table: Readonly<Record<Fibonacci, number>>): void {
  let previous = 0;
  for (const size of FIBONACCI_SCALE) {
    const days = table[size];
    if (!Number.isInteger(days) || days < 1) {
      throw new InvariantError(
        'invalid_params',
        `the duration for size ${String(size)} must be a whole number of working days of at least 1, not ${String(days)}`,
      );
    }
    if (days < previous) {
      // A table where a bigger slice takes fewer days would let raising an
      // estimate pull a deadline earlier. Nobody would trust the second plan.
      throw new InvariantError(
        'invalid_params',
        `the duration table must not decrease up the scale — size ${String(size)} takes ${String(days)} working days, less than the size below it`,
      );
    }
    previous = days;
  }
}

/**
 * The slots one area may run at once.
 *
 * `weight% × concurrentInitiatives`, rounded, **floored at one**. The floor is
 * a value judgement stated out loud: zero slots would mean an area can never
 * make progress at all, and starving an area to nothing is a decision for a
 * yearly review, not an arithmetic consequence of a small percentage. An area
 * with a small share still runs one thing at a time — it simply cannot run
 * four.
 */
function slotsForWeight(weightPct: number | undefined, concurrentInitiatives: number): number {
  if (weightPct === undefined) return 1;
  return Math.max(1, Math.round((weightPct / 100) * concurrentInitiatives));
}

export function resolveScheduleConfig(
  config: ScheduleConfig,
  areas: readonly Area[],
  now: Date,
): ResolvedScheduleConfig {
  assertDurationTable(config.durationDaysBySize);

  if (!Number.isInteger(config.concurrentInitiatives) || config.concurrentInitiatives < 1) {
    throw new InvariantError(
      'invalid_limits',
      `concurrentInitiatives must be a whole number of at least 1, not ${String(config.concurrentInitiatives)}`,
    );
  }

  const weightYear = config.weightYear ?? yearOfInstant(now);
  const resolved = resolveWeights(config.weights, weightYear);

  const slotsByArea = new Map<AreaKey, number>();
  for (const area of areas) {
    slotsByArea.set(
      area.key,
      slotsForWeight(resolved.weightPctByArea.get(area.key), config.concurrentInitiatives),
    );
  }

  return {
    durationDaysBySize: config.durationDaysBySize,
    calendar: buildWorkingCalendar(config.workingWeekdays, config.holidays),
    concurrentInitiatives: config.concurrentInitiatives,
    weightYear,
    weightSourceYear: resolved.sourceYear,
    weightsStale: resolved.stale,
    slotsByArea,
  };
}

/** Working days for one initiative's next slice. */
export function durationDays(
  size: Fibonacci,
  config: Pick<ResolvedScheduleConfig, 'durationDaysBySize'>,
): number {
  return config.durationDaysBySize[size];
}
