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
  /** Where new work for the area is created. At most one per area. */
  readonly isHome?: boolean | undefined;
}

/**
 * Where prisme creates new work for an area — an anchor or a capture alike.
 *
 * `area_mapping` is many-to-one, so an area can have several locations and one
 * of them has to be chosen. Before this rule there were two: the reconciler took
 * the first mapping in key order and the capture flow the most specific, so the
 * same area sent new work to two places and neither was a decision anybody made.
 *
 * The order is:
 *
 * 1. **the home** — the mapping a person marked on the Settings screen;
 * 2. **the most specific** — a section says more about where things go than a
 *    whole project;
 * 3. **the first by identifier** — stable, so two creations a second apart do
 *    not land in different places.
 *
 * `undefined` when the area is mapped nowhere. That is not a failure to route
 * around with a default: prisme has no idea where the work belongs, and the
 * caller refuses and says which area needs a mapping.
 */
export function homeLocation<T extends AreaMappingShape>(
  areaKey: AreaKey,
  mappings: readonly T[],
): T | undefined {
  const candidates = mappings
    .filter((mapping) => mapping.areaKey === areaKey)
    .sort((left, right) => {
      const home = Number(right.isHome === true) - Number(left.isHome === true);
      if (home !== 0) return home;
      const specificity = Number(hasSection(right)) - Number(hasSection(left));
      if (specificity !== 0) return specificity;
      if (left.externalProjectId !== right.externalProjectId) {
        return left.externalProjectId < right.externalProjectId ? -1 : 1;
      }
      const leftSection = left.externalSectionId ?? '';
      const rightSection = right.externalSectionId ?? '';
      return leftSection < rightSection ? -1 : leftSection > rightSection ? 1 : 0;
    });
  return candidates[0];
}

/**
 * The fields {@link homeLocation} reads. Structural, so a database row whose
 * absent section is `null` and a domain mapping whose absent section is
 * `undefined` are both accepted without a conversion at every call site.
 */
export interface AreaMappingShape {
  readonly areaKey: AreaKey;
  readonly externalProjectId: string;
  readonly externalSectionId?: string | null | undefined;
  readonly isHome?: boolean | undefined;
}

function hasSection(mapping: AreaMappingShape): boolean {
  return mapping.externalSectionId !== undefined && mapping.externalSectionId !== null;
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
