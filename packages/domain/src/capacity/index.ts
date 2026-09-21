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
 * What one area was observed to have done over a window, already totalised.
 *
 * The shape exists so that the balance rule below is written **once** while the
 * measuring has two sources. Live completions arrive from the anchor subtree;
 * `capacity_week` arrives already attributed by the backfill, which is the only
 * place that knows how to re-attribute a completion from `area_mapping` and how
 * to apply the duration preference order (W13). Neither source should own the
 * arithmetic that turns totals into shares and a balance factor.
 */
export interface AreaObservation {
  readonly areaKey: AreaKey;
  readonly completions: number;
  readonly minutesBySource: Readonly<Record<DurationSource, number>>;
}

const NO_MINUTES: Readonly<Record<DurationSource, number>> = {
  recorded: 0,
  declared: 0,
  default: 0,
};

function sumOfSources(bySource: Readonly<Record<DurationSource, number>>): number {
  return bySource.recorded + bySource.declared + bySource.default;
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

  const observations = new Map<
    AreaKey,
    { completions: number; minutes: Record<DurationSource, number> }
  >();
  for (const area of areas) {
    observations.set(area.key, { completions: 0, minutes: { ...NO_MINUTES } });
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

    const observed = observations.get(area.key);
    if (observed === undefined) continue;
    observed.completions += 1;

    // Signals are counted as volume and contribute no time: responding to an
    // alert is not a choice about how to spend a week.
    if (!countsTowardCapacity(area)) continue;

    const { minutes: attributed, source } = attribute(completion, window.defaultMinutes);
    observed.minutes[source] += attributed;
  }

  return computeCapacityFrom(
    [...observations].map(([areaKey, observed]) => ({
      areaKey,
      completions: observed.completions,
      minutesBySource: observed.minutes,
    })),
    areas,
    window,
    now,
  );
}

/**
 * The same balance rule, from totals somebody else already measured.
 *
 * `capacity_week` is what this exists for: the backfill has attributed and
 * duration-estimated every completion it could reach, and re-deriving any of
 * that here would be the second implementation of a rule the domain package is
 * supposed to own alone. What the two paths share is everything below the
 * measuring — the share, the clamp, the lane rules and the Run budget.
 */
export function computeCapacityFrom(
  observations: readonly AreaObservation[],
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

  const measured = new Map<AreaKey, AreaObservation>();
  for (const observation of observations) {
    if (!areaByKey.has(observation.areaKey)) {
      throw new InvariantError(
        'unknown_area',
        `an observation names area "${observation.areaKey}", which is not in the area set`,
      );
    }
    measured.set(observation.areaKey, observation);
  }

  const resolved = resolveWeights(window.weights, yearOfInstant(now));

  const minutes = new Map<AreaKey, number>();
  const counts = new Map<AreaKey, number>();
  const bySource = new Map<AreaKey, Record<DurationSource, number>>();
  for (const area of areas) {
    const own = measured.get(area.key);
    counts.set(area.key, own?.completions ?? 0);
    // A lane that does not count toward capacity keeps its completions and no
    // minutes at all — the rule is the area's kind, and it holds whichever
    // source measured it.
    const sources = countsTowardCapacity(area) ? (own?.minutesBySource ?? NO_MINUTES) : NO_MINUTES;
    bySource.set(area.key, { ...sources });
    minutes.set(area.key, countsTowardCapacity(area) ? sumOfSources(sources) : 0);
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
        minutesBySource: bySource.get(area.key) ?? { ...NO_MINUTES },
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
