import { z } from 'zod';
import type { AreaKey } from './area.js';
import type { InitiativeId } from './initiative.js';

/**
 * Objectives and key results (ADR-0012, ADR-0013).
 *
 * A key result is first-class, not a bullet inside a document, and every one
 * gets an anchor task — a key result you can break into subtasks is a key
 * result that gets worked on.
 *
 * `progress_self` is the primary measure and the one that syncs outward.
 * `progress_computed` is shown beside it and **never** written back: the gap
 * between them is more informative than either alone, and automating the number
 * would destroy the signal.
 */

export type ObjectiveId = string;
export type KeyResultId = string;

export type ObjectiveType = 'annual' | 'monthly';

export type ObjectiveStatus = 'draft' | 'active' | 'met' | 'missed' | 'dropped';

export const OBJECTIVE_TYPES = ['annual', 'monthly'] as const;
export const OBJECTIVE_STATUSES = ['draft', 'active', 'met', 'missed', 'dropped'] as const;

export interface Objective {
  readonly id: ObjectiveId;
  readonly title: string;
  readonly type: ObjectiveType;
  /** `2026` for an annual objective, `2026-03` for a monthly one. */
  readonly period: string;
  readonly areaKey: AreaKey;
  readonly status: ObjectiveStatus;
  /** The narrative lives in the document tool. prisme holds only the link. */
  readonly externalPageId?: string | undefined;
}

export interface KeyResult {
  readonly id: KeyResultId;
  readonly objectiveId: ObjectiveId;
  readonly statement: string;
  readonly target: number;
  readonly unit: string;
  /** 0–100, set by hand, by judgement. The primary measure. */
  readonly progressSelf: number;
  readonly externalAnchorId?: string | undefined;
  /** Initiatives that serve this key result. */
  readonly servedBy: readonly InitiativeId[];
}

/** Append-only, so a trend exists rather than a single current number. */
export interface KeyResultMeasurement {
  readonly keyResultId: KeyResultId;
  readonly observedAt: Date;
  readonly value: number;
  readonly note?: string | undefined;
}

export const objectiveSchema: z.ZodType<Objective> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(OBJECTIVE_TYPES),
  period: z.string().regex(/^\d{4}(-\d{2})?$/, 'expected YYYY or YYYY-MM'),
  areaKey: z.string().min(1),
  status: z.enum(OBJECTIVE_STATUSES),
  externalPageId: z.string().min(1).optional(),
});

export const keyResultSchema: z.ZodType<KeyResult> = z.object({
  id: z.string().min(1),
  objectiveId: z.string().min(1),
  statement: z.string().min(1),
  target: z.number(),
  unit: z.string().min(1),
  progressSelf: z.number().min(0).max(100),
  externalAnchorId: z.string().min(1).optional(),
  servedBy: z.array(z.string().min(1)).readonly(),
});

/**
 * Tasks done ÷ total, shown beside `progressSelf`. Derived, never written
 * outward. `undefined` when there is no breakdown to compute from — which is
 * honest, and different from zero.
 */
export function computeProgress(doneCount: number, totalCount: number): number | undefined {
  if (totalCount <= 0) return undefined;
  return (doneCount / totalCount) * 100;
}
