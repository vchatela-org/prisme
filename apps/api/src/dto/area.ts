import { z } from 'zod';
import { defineWrite, named } from '../http/schema.js';
import { areaKey, areaKind, calendarDate, page, percentage, year as yearSchema } from './common.js';
import { AREA_READ_ONLY, AREA_WEIGHT_READ_ONLY } from './ownership.js';

/**
 * Areas, lanes and the year-scoped weights.
 *
 * The rule the shapes here exist to keep unbreakable: **a weight always
 * requires a year** (ADR-0007). There is no `weightPct` on an area DTO and no
 * endpoint that returns "the current weight" — every weight arrives inside a
 * year, so a chart of last year cannot silently re-render against this year's
 * decision.
 */

export const areaMappingDto = z.object({
  externalProjectId: z.string(),
  externalSectionId: z.string().nullable(),
  /** Where prisme creates new work for the area — anchors and captures alike. */
  isHome: z.boolean(),
});

/**
 * A palette slot, 1 to 8. The palette's ceiling is fixed: a ninth generated hue
 * is indistinguishable from an existing one under colour-vision deficiency.
 */
const colorSlot = z.int().min(1).max(8);

const mappingInput = z.strictObject({
  externalProjectId: z.string().min(1).max(200),
  externalSectionId: z.string().min(1).max(200).optional(),
  isHome: z.boolean().optional(),
});

/** New work for an area goes to one place, so one mapping at most is its home. */
const mappingList = z
  .array(mappingInput)
  .refine((mappings) => mappings.filter((mapping) => mapping.isHome === true).length <= 1, {
    error: 'at most one mapping can be the home location',
  });

export const areaDto = z.object({
  key: areaKey,
  name: z.string(),
  kind: areaKind,
  active: z.boolean(),
  /** Only the Change lane is ranked. Run and Signals are lanes, not competitors. */
  rankable: z.boolean(),
  externalPageId: z.string().nullable(),
  /** Upkeep is budgeted in hours per week, not a share of capacity. */
  runBudgetHoursPerWeek: z.number().nullable(),
  /**
   * The palette slot chosen on the Settings screen, or `null` for "not chosen"
   * — the environment's pin applies then, else the key's hash. Lanes paint grey
   * whatever this says.
   */
  colorSlot: colorSlot.nullable(),
  mappings: z.array(areaMappingDto),
});

export const areaWeightDto = z.object({
  areaKey,
  year: yearSchema,
  weightPct: percentage,
});

/**
 * The weights in force for a year, and whether they were decided *for* it.
 *
 * `stale` is the year gate (docs/10-model.md, *The year gate*): weights carry
 * forward until they are set, but loudly. A surface that renders this without
 * showing `stale` has re-introduced exactly the silence ADR-0007 removed.
 */
export const areaWeightsDto = z.object({
  year: yearSchema,
  sourceYear: yearSchema.nullable(),
  stale: z.boolean(),
  /** Whether the rankable areas' weights add up to a whole person's capacity. */
  sumPct: z.number(),
  weights: z.array(areaWeightDto),
});

export const areaListDto = z.object({ items: z.array(areaDto) });

export const AreaDto = named('Area', areaDto);
export const AreaListDto = named('AreaList', areaListDto);
export const AreaWeightsDto = named('AreaWeights', areaWeightsDto);
export const AreaWeightDto = named('AreaWeight', areaWeightDto);
export const AreaPageDto = named('AreaPage', page(areaDto));

export const createAreaBody = defineWrite(
  'CreateArea',
  z
    .strictObject({
      key: areaKey,
      name: z.string().min(1).max(200),
      kind: areaKind,
      active: z.boolean().default(true),
      externalPageId: z.string().min(1).max(200).optional(),
      runBudgetHoursPerWeek: z.number().min(0).max(168).optional(),
      colorSlot: colorSlot.optional(),
      mappings: mappingList.default([]),
    })
    .refine((value) => value.runBudgetHoursPerWeek === undefined || value.kind === 'run', {
      error: 'an hours-per-week budget belongs to the Run lane',
      path: ['runBudgetHoursPerWeek'],
    }),
  // `key` and `kind` are absent from the refusal table here on purpose: this is
  // the one request that sets them.
  {
    weightPct: AREA_READ_ONLY.weightPct,
    actualShare: AREA_READ_ONLY.actualShare,
    balanceFactor: AREA_READ_ONLY.balanceFactor,
    narrative: AREA_READ_ONLY.narrative,
    body: AREA_READ_ONLY.body,
  },
);

export const updateAreaBody = defineWrite(
  'UpdateArea',
  z.strictObject({
    name: z.string().min(1).max(200).optional(),
    active: z.boolean().optional(),
    externalPageId: z.string().min(1).max(200).nullable().optional(),
    runBudgetHoursPerWeek: z.number().min(0).max(168).nullable().optional(),
    colorSlot: colorSlot.nullable().optional(),
  }),
  AREA_READ_ONLY,
);

export const putAreaWeightBody = defineWrite(
  'PutAreaWeight',
  z.strictObject({ weightPct: percentage }),
  AREA_WEIGHT_READ_ONLY,
);

export const replaceAreaMappingsBody = defineWrite(
  'ReplaceAreaMappings',
  z.strictObject({ mappings: mappingList }),
);

/**
 * Declared versus observed, per area — the view that exists nowhere else.
 *
 * `targetSharePct` is the decision, `actualSharePct` is what happened, and
 * `balanceFactor` is the ratio the scoring method reads. Run carries hours
 * against its budget instead of a share; Signals carries volume and no time at
 * all (ADR-0014).
 */
export const areaBalanceDto = z.object({
  areaKey,
  name: z.string(),
  kind: areaKind,
  countsTowardCapacity: z.boolean(),
  minutes: z.number(),
  completions: z.int(),
  actualSharePct: z.number(),
  targetSharePct: z.number().nullable(),
  balanceFactor: z.number(),
  stale: z.boolean(),
  minutesBySource: z.object({
    recorded: z.number(),
    declared: z.number(),
    default: z.number(),
  }),
  runHoursPerWeek: z.number().nullable(),
  runBudgetHoursPerWeek: z.number().nullable(),
});

export const balanceDto = z.object({
  /** The window the observation covers, half-open: `(from, to]`. */
  from: calendarDate,
  to: calendarDate,
  windowWeeks: z.int(),
  weightYear: yearSchema,
  weightSourceYear: yearSchema.nullable(),
  /** True when the weights behind every target share were carried forward. */
  stale: z.boolean(),
  /**
   * Which record the observed side came from (W13).
   *
   * `capacity_week` is the backfill's materialised history — every completion
   * it could reach, attributed through `area_mapping`. `task_mirror` is the
   * anchor subtree, which is all prisme has until a backfill has run. The two
   * give different numbers for the same week, so this is a field and not a
   * footnote: a reader comparing two months deserves to know which they have.
   */
  observedSource: z.enum(['capacity_week', 'task_mirror']),
  /**
   * How far the backfill's coverage reaches, when it is the source.
   *
   * The window above is the one *measured*; this is the one the fetch covered.
   * They can differ — the backfill is a command a human runs, not a schedule —
   * and a reading whose coverage ends before its window is a reading that
   * under-reports, which the reader can only see if it is stated.
   */
  observedThrough: calendarDate.nullable(),
  areas: z.array(areaBalanceDto),
});

export const BalanceDto = named('Balance', balanceDto);
