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
      mappings: z
        .array(
          z.strictObject({
            externalProjectId: z.string().min(1).max(200),
            externalSectionId: z.string().min(1).max(200).optional(),
          }),
        )
        .default([]),
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
  z.strictObject({
    mappings: z.array(
      z.strictObject({
        externalProjectId: z.string().min(1).max(200),
        externalSectionId: z.string().min(1).max(200).optional(),
      }),
    ),
  }),
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
  areas: z.array(areaBalanceDto),
});

export const BalanceDto = named('Balance', balanceDto);
