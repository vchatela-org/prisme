import { z } from 'zod';
import { defineWrite, named } from '../http/schema.js';
import {
  areaKey,
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
  externalPageId: z.string().nullable(),
  keyResults: z.array(keyResultDto),
  createdAt: instant,
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

export const updateObjectiveBody = defineWrite(
  'UpdateObjective',
  z.strictObject({
    title: z.string().min(1).max(300).optional(),
    status: objectiveStatus.optional(),
    externalPageId: z.string().min(1).max(200).nullable().optional(),
  }),
  OBJECTIVE_READ_ONLY,
);

export const createKeyResultBody = defineWrite(
  'CreateKeyResult',
  z.strictObject({
    statement: z.string().min(1).max(500),
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
    target: z.number().optional(),
    unit: z.string().min(1).max(50).optional(),
    progressSelf: percentage.optional(),
    servedBy: z.array(entityId).optional(),
  }),
  KEY_RESULT_READ_ONLY,
);

export const createMeasurementBody = defineWrite(
  'CreateMeasurement',
  z.strictObject({
    value: z.number(),
    observedAt: instant.optional(),
    note: z.string().min(1).max(500).optional(),
  }),
);
