import { type Area, type AreaKey, type AreaKind, type AreaWeight } from '../entities/area.js';
import { countsTowardCapacity, isRankable, resolveWeights } from '../entities/area.js';
import { subtractDays, yearOfInstant } from '../entities/calendar.js';
import { InvariantError } from '../entities/errors.js';
import type { AreaScoringContext } from '../scoring/types.js';
import { clamp } from '../util/clamp.js';

/**
 * Measuring capacity (docs/12-scoring.md §4).
 *
 * `actual_share` is the share of the last four weeks of completed work
 * attributable to each area. Four weeks is long enough to survive one unusual
 * week and short enough that the balance factor still responds within a month.
 *
 * **Run counts toward capacity; Signals do not** (ADR-0014). Excluding upkeep
 * from the measurement would hide exactly the pattern the system exists to
 * reveal — upkeep quietly consuming the majority of discretionary time.
 * Responding to an alert, by contrast, is not a choice about how to spend a
 * week, so Signals are counted as noise volume and nothing else.
 *
 * ### The limitation, restated where it is implemented
 *
 * This measures *attention routed through tasks*, not hours lived. Recurring
 * work is under-represented, and much of what matters in the relationship and
 * health areas never becomes a task at all. Areas whose work is mostly
 * untracked will read as starved. The bias errs toward surfacing neglect, which
 * is the safer direction — but it is a lens, not a verdict.
 */

/** Where a completion's duration came from. Preference order, best first. */
export type DurationSource = 'recorded' | 'declared' | 'default';

export interface Completion {
  readonly id: string;
  readonly areaKey: AreaKey;
  readonly completedAt: Date;
  /** Recorded duration on the completed task — the only real measurement. */
  readonly recordedMinutes?: number | undefined;
  /** Declared duration of the matching process page, for recurring upkeep. */
  readonly declaredMinutes?: number | undefined;
}

export interface CapacityWindow {
  /** Rolling window length in weeks. Four, per docs/12-scoring.md §4. */
  readonly weeks: number;
  /**
   * The weights to measure against. The year in force is taken from `now`, so a
   * chart of a past period stays correct after a new year's weights land
   * (ADR-0007).
   */
  readonly weights: readonly AreaWeight[];
  /** Fallback when neither duration is known. Configurable, not a constant. */
  readonly defaultMinutes: number;
  readonly balanceClamp: readonly [number, number];
}

export const CAPACITY_WINDOW_DEFAULTS: Omit<CapacityWindow, 'weights'> = {
  weeks: 4,
  defaultMinutes: 30,
  balanceClamp: [0.5, 2],
};

export interface AreaCapacity {
  readonly areaKey: AreaKey;
  readonly kind: AreaKind;
  /** Attributed minutes inside the window. Zero for Signals, by design. */
  readonly minutes: number;
  readonly completions: number;
  readonly countsTowardCapacity: boolean;
  readonly actualSharePct: number;
  readonly targetSharePct: number | undefined;
  /** `clamp(target ÷ observed, min, max)`. `1` where there is nothing to balance. */
  readonly balanceFactor: number;
  /** The weights behind `targetSharePct` were carried forward, or are absent. */
  readonly stale: boolean;
  readonly minutesBySource: Readonly<Record<DurationSource, number>>;
  /** Only for the Run lane: upkeep is budgeted in hours per week, not a share. */
  readonly runHoursPerWeek?: number | undefined;
  readonly runBudgetHoursPerWeek?: number | undefined;
}

function attribute(
  completion: Completion,
  defaultMinutes: number,
): { readonly minutes: number; readonly source: DurationSource } {
  if (completion.recordedMinutes !== undefined && completion.recordedMinutes >= 0) {
    return { minutes: completion.recordedMinutes, source: 'recorded' };
  }
  if (completion.declaredMinutes !== undefined && completion.declaredMinutes >= 0) {
    return { minutes: completion.declaredMinutes, source: 'declared' };
  }
  return { minutes: defaultMinutes, source: 'default' };
}

/**
 * Per-area capacity actuals and balance factors over a rolling window.
 *
 * The window is half-open, `(now − weeks, now]`, so two consecutive windows
 * never count the same completion twice.
 */
export function computeCapacity(
  completions: readonly Completion[],
  areas: readonly Area[],
  window: CapacityWindow,
  now: Date,
): readonly AreaCapacity[] {
  if (window.weeks <= 0) {
    throw new InvariantError(
      'invalid_share',
      `the capacity window must be at least one week, not ${String(window.weeks)}`,
    );
  }

  const areaByKey = new Map<AreaKey, Area>();
  for (const area of areas) areaByKey.set(area.key, area);

  const windowStart = subtractDays(now, window.weeks * 7);
  const resolved = resolveWeights(window.weights, yearOfInstant(now));

  const minutes = new Map<AreaKey, number>();
  const counts = new Map<AreaKey, number>();
  const bySource = new Map<AreaKey, Record<DurationSource, number>>();
  for (const area of areas) {
    minutes.set(area.key, 0);
    counts.set(area.key, 0);
    bySource.set(area.key, { recorded: 0, declared: 0, default: 0 });
  }

  for (const completion of completions) {
    const area = areaByKey.get(completion.areaKey);
    if (!area) {
      throw new InvariantError(
        'unknown_area',
        `completion ${completion.id} names area "${completion.areaKey}", which is not in the area set`,
      );
    }
    if (completion.completedAt <= windowStart || completion.completedAt > now) continue;

    counts.set(area.key, (counts.get(area.key) ?? 0) + 1);

    // Signals are counted as volume and contribute no time: responding to an
    // alert is not a choice about how to spend a week.
    if (!countsTowardCapacity(area)) continue;

    const { minutes: attributed, source } = attribute(completion, window.defaultMinutes);
    minutes.set(area.key, (minutes.get(area.key) ?? 0) + attributed);
    const sources = bySource.get(area.key);
    if (sources) sources[source] += attributed;
  }

  let totalMinutes = 0;
  for (const area of areas) {
    if (countsTowardCapacity(area)) totalMinutes += minutes.get(area.key) ?? 0;
  }

  const [clampMin, clampMax] = window.balanceClamp;

  return areas
    .map((area): AreaCapacity => {
      const areaMinutes = countsTowardCapacity(area) ? (minutes.get(area.key) ?? 0) : 0;
      const actualSharePct = totalMinutes > 0 ? (areaMinutes / totalMinutes) * 100 : 0;
      const targetSharePct = isRankable(area) ? resolved.weightPctByArea.get(area.key) : undefined;

      const balanceFactor =
        targetSharePct === undefined
          ? 1
          : clamp(targetSharePct / actualSharePct, clampMin, clampMax);

      const base = {
        areaKey: area.key,
        kind: area.kind,
        minutes: areaMinutes,
        completions: counts.get(area.key) ?? 0,
        countsTowardCapacity: countsTowardCapacity(area),
        actualSharePct,
        targetSharePct,
        balanceFactor,
        stale: resolved.stale || (isRankable(area) && targetSharePct === undefined),
        minutesBySource: bySource.get(area.key) ?? { recorded: 0, declared: 0, default: 0 },
      };

      return area.kind === 'run'
        ? {
            ...base,
            runHoursPerWeek: areaMinutes / 60 / window.weeks,
            ...(area.runBudgetHoursPerWeek === undefined
              ? {}
              : { runBudgetHoursPerWeek: area.runBudgetHoursPerWeek }),
          }
        : base;
    })
    .sort((left, right) =>
      left.areaKey < right.areaKey ? -1 : left.areaKey > right.areaKey ? 1 : 0,
    );
}

/**
 * The bridge from measurement to ranking: only rankable areas reach a scoring
 * method, which is how Run and Signals stay out of the backlog without any
 * method needing to know they exist.
 */
export function toScoringContexts(
  capacity: readonly AreaCapacity[],
  areas: readonly Area[],
): readonly AreaScoringContext[] {
  const rankable = new Set<AreaKey>(areas.filter(isRankable).map((area) => area.key));

  return capacity
    .filter((entry) => rankable.has(entry.areaKey))
    .map((entry) => ({
      key: entry.areaKey,
      targetShare: entry.targetSharePct ?? 0,
      actualShare: entry.actualSharePct,
      balanceFactor: entry.balanceFactor,
      stale: entry.stale,
    }));
}
