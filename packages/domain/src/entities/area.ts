import { z } from 'zod';
import { type Year, yearSchema } from './calendar.js';
import { InvariantError } from './errors.js';

/**
 * Areas, and the year-scoped weights that allocate capacity between them.
 *
 * The rule this file exists to make unbreakable: **a weight always requires a
 * year** (ADR-0007). There is no current-weight accessor here, and adding one
 * would let a chart of last year silently re-render against this year's
 * decision.
 *
 * Lanes are areas with a different `kind` so that capacity accounting is
 * uniform (docs/10-model.md §3, ADR-0014). Only `kind: 'area'` is ranked.
 */

export type AreaKey = string;

export type AreaKind = 'area' | 'run' | 'signals';

export const AREA_KINDS = ['area', 'run', 'signals'] as const;

export interface Area {
  readonly key: AreaKey;
  readonly name: string;
  readonly kind: AreaKind;
  readonly active: boolean;
  /** Optional narrative page in the document tool. The body is the document tool's. */
  readonly externalPageId?: string | undefined;
  /** Only meaningful for `kind: 'run'` — upkeep is budgeted in time, not share. */
  readonly runBudgetHoursPerWeek?: number | undefined;
}

/**
 * `area_weight (area_key, year, weight_pct)` — primary key `(area_key, year)`.
 * Percentage points of discretionary capacity, not a fraction.
 */
export interface AreaWeight {
  readonly areaKey: AreaKey;
  readonly year: Year;
  readonly weightPct: number;
}

export interface AreaMapping {
  readonly areaKey: AreaKey;
  readonly externalProjectId: string;
  readonly externalSectionId?: string | undefined;
}

export const areaSchema: z.ZodType<Area> = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(AREA_KINDS),
  active: z.boolean(),
  externalPageId: z.string().min(1).optional(),
  runBudgetHoursPerWeek: z.number().nonnegative().optional(),
});

export const areaWeightSchema: z.ZodType<AreaWeight> = z.object({
  areaKey: z.string().min(1),
  year: yearSchema,
  weightPct: z.number().min(0).max(100),
});

/** Only the Change lane is ranked. Run and Signals are lanes, not competitors. */
export function isRankable(area: Area): boolean {
  return area.kind === 'area' && area.active;
}

/** Signals are noise volume, counted nowhere else. Run is upkeep and counts. */
export function countsTowardCapacity(area: Area): boolean {
  return area.kind !== 'signals';
}

/**
 * The weight for one area in one year. **The year is not optional and not
 * inferable** — that is the whole point of ADR-0007, and the `Year` brand means
 * a bare number cannot stand in for it.
 *
 * Returns `undefined` when that year was never decided. Callers reach for
 * {@link resolveWeights}, which carries a previous year forward *loudly*.
 */
export function weightFor(
  weights: readonly AreaWeight[],
  areaKey: AreaKey,
  year: Year,
): number | undefined {
  for (const weight of weights) {
    if (weight.areaKey === areaKey && weight.year === year) return weight.weightPct;
  }
  return undefined;
}

export interface ResolvedWeights {
  /** The year that was asked for. */
  readonly year: Year;
  /** The year the weights actually came from. Equal to `year` when fresh. */
  readonly sourceYear: Year | undefined;
  /**
   * True when `year` itself has no weights. The year gate: weights carry
   * forward until they are set, but the UI must say so and the balance factors
   * derived from them are marked stale (docs/10-model.md, *The year gate*).
   */
  readonly stale: boolean;
  readonly weightPctByArea: ReadonlyMap<AreaKey, number>;
}

/**
 * Weights in force for `year`, falling back to the most recent earlier year.
 *
 * A year with no weights does not silently inherit: it inherits *and says so*.
 * Silence here is what lets an annual decision slide for eighteen months.
 */
export function resolveWeights(weights: readonly AreaWeight[], year: Year): ResolvedWeights {
  const years = new Set<Year>();
  for (const weight of weights) years.add(weight.year);

  let sourceYear: Year | undefined;
  if (years.has(year)) {
    sourceYear = year;
  } else {
    for (const candidate of years) {
      if (candidate < year && (sourceYear === undefined || candidate > sourceYear)) {
        sourceYear = candidate;
      }
    }
  }

  const weightPctByArea = new Map<AreaKey, number>();
  if (sourceYear !== undefined) {
    for (const weight of weights) {
      if (weight.year === sourceYear) weightPctByArea.set(weight.areaKey, weight.weightPct);
    }
  }

  return { year, sourceYear, stale: sourceYear !== year, weightPctByArea };
}

/**
 * Rejects a weight set whose shares cannot be a division of one person's
 * capacity. Run and Signals carry no percentage, so only `kind: 'area'` counts.
 */
export function assertWeightsSumTo100(resolved: ResolvedWeights): void {
  let total = 0;
  for (const pct of resolved.weightPctByArea.values()) total += pct;
  if (Math.abs(total - 100) > 1e-9) {
    throw new InvariantError(
      'invalid_weight',
      `area weights for ${String(resolved.sourceYear ?? resolved.year)} sum to ${total}, not 100`,
    );
  }
}
