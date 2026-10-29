import { z } from 'zod';
import { defineWrite, named } from '../http/schema.js';
import {
  areaKey,
  calendarDate,
  entityId,
  instant,
  objectiveStatus,
  objectiveType,
  page,
  percentage,
} from './common.js';
import { KEY_RESULT_READ_ONLY, OBJECTIVE_READ_ONLY } from './ownership.js';

/**
 * Objectives and key results (ADR-0012, ADR-0013).
 *
 * `progressSelf` and `progressComputed` sit side by side and only one of them
 * is writable. That asymmetry is the feature: the gap between what you judge
 * you have achieved and what the closed tasks say is more informative than
 * either number alone, and automating the first would destroy the signal
 * (docs/10-model.md §7). `progressComputed` is therefore nullable rather than
 * zero — no breakdown to compute from is a different fact from no progress.
 */

export const measurementDto = z.object({
  observedAt: instant,
  value: z.number(),
  note: z.string().nullable(),
});

export const keyResultDto = z.object({
  id: entityId,
  objectiveId: entityId,
  statement: z.string(),
  /**
   * The sub-objective it is grouped under (ADR-0039), or `null` for none. Free
   * text; it groups key results and places a new key result's task.
   */
  subObjective: z.string().nullable(),
  target: z.number(),
  unit: z.string(),
  /** 0–100, set by hand, by judgement. The primary measure, and the one that syncs outward. */
  progressSelf: percentage,
  /** Tasks done ÷ total beneath the anchor. Shown beside, never written outward. */
  progressComputed: z.number().nullable(),
  externalAnchorId: z.string().nullable(),
  servedBy: z.array(entityId),
  measurementCount: z.int(),
  createdAt: instant,
});

export const objectiveDto = z.object({
  id: entityId,
  title: z.string(),
  type: objectiveType,
  /** `2026` for an annual objective, `2026-03` for a monthly one. */
  period: z.string(),
  areaKey,
  status: objectiveStatus,
  /**
   * The days the period covers, and the last day it can be judged before its
   * window closes it as missed (ADR-0037). `null` when the period is not
   * written the way its type says.
   */
  window: z
    .object({
      startsOn: calendarDate,
      endsOn: calendarDate,
      judgeBy: calendarDate,
    })
    .nullable(),
  externalPageId: z.string().nullable(),
  keyResults: z.array(keyResultDto),
  createdAt: instant,
  /**
   * The document tool's own success figure for this objective, as a
   * percentage (100 = met), as the last pass read it from the linked page
   * (ADR-0042). **Read-only, and the document tool's**: shown beside the
   * status when the objective is judged, never written, never a score. `null`
   * when no success column is chosen on Settings → Notion, the objective has
   * no page, or the page holds no number.
   */
  documentSuccess: z.number().nullable(),
  documentSuccessReadAt: instant.nullable(),
  /**
   * The figure reads 100% or more (`documentSaysMet`, packages/domain). An
   * open objective that says so is not closed `missed` by its window; it waits
   * for a person to judge it, and the screen asks *mark met?*.
   */
  documentSaysMet: z.boolean(),
});

export const ObjectiveDto = named('Objective', objectiveDto);
export const ObjectivePageDto = named('ObjectivePage', page(objectiveDto));
export const KeyResultDto = named('KeyResult', keyResultDto);
export const MeasurementListDto = named(
  'MeasurementList',
  z.object({ keyResultId: entityId, items: z.array(measurementDto) }),
);

const PERIOD = /^\d{4}(-\d{2})?$/;

export const createObjectiveBody = defineWrite(
  'CreateObjective',
  z
    .strictObject({
      title: z.string().min(1).max(300),
      type: objectiveType,
      period: z.string().regex(PERIOD, 'expected YYYY for an annual period or YYYY-MM for a month'),
      areaKey,
      status: objectiveStatus.default('draft'),
      externalPageId: z.string().min(1).max(200).optional(),
    })
    .refine((value) => (value.type === 'annual') === !value.period.includes('-'), {
      error: 'an annual objective takes a YYYY period and a monthly one takes YYYY-MM',
      path: ['period'],
    }),
  OBJECTIVE_READ_ONLY,
);

/**
 * `type` and `period` move an **open** objective to another period (ADR-0034).
 * Either may be sent alone — a monthly objective moved a month sends only its
 * period — so whether the pair agrees is decided against the objective as it
 * will be, by the service, and refused there with a 422.
 */
export const updateObjectiveBody = defineWrite(
  'UpdateObjective',
  z.strictObject({
    title: z.string().min(1).max(300).optional(),
    status: objectiveStatus.optional(),
    externalPageId: z.string().min(1).max(200).nullable().optional(),
    type: objectiveType.optional(),
    period: z
      .string()
      .regex(PERIOD, 'expected YYYY for an annual period or YYYY-MM for a month')
      .optional(),
  }),
  OBJECTIVE_READ_ONLY,
);

export const createKeyResultBody = defineWrite(
  'CreateKeyResult',
  z.strictObject({
    statement: z.string().min(1).max(500),
    subObjective: z.string().trim().min(1).max(200).optional(),
    target: z.number(),
    unit: z.string().min(1).max(50),
    progressSelf: percentage.default(0),
    servedBy: z.array(entityId).default([]),
  }),
  KEY_RESULT_READ_ONLY,
);

export const updateKeyResultBody = defineWrite(
  'UpdateKeyResult',
  z.strictObject({
    statement: z.string().min(1).max(500).optional(),
    /** `null` takes the key result out of its sub-objective. */
    subObjective: z.string().trim().min(1).max(200).nullable().optional(),
    target: z.number().optional(),
    unit: z.string().min(1).max(50).optional(),
    progressSelf: percentage.optional(),
    servedBy: z.array(entityId).optional(),
  }),
  KEY_RESULT_READ_ONLY,
);

/** One initiative added to what serves a key result; the others stay. */
export const addServedByBody = defineWrite(
  'AddKeyResultServedBy',
  z.strictObject({ initiativeId: entityId }),
);

export const createMeasurementBody = defineWrite(
  'CreateMeasurement',
  z.strictObject({
    value: z.number(),
    observedAt: instant.optional(),
    note: z.string().min(1).max(500).optional(),
  }),
);
