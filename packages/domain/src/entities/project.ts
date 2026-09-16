import { z } from 'zod';
import type { AreaKey } from './area.js';
import { type CalendarDate, calendarDateSchema } from './calendar.js';
import { type Origin, originSchema } from './provenance.js';

/**
 * Project — the optional container between area and initiative (ADR-0019).
 *
 * Most initiatives have none. A project exists for the multi-month shape of
 * work that has its own structure in both external tools; it is **not** an
 * outcome finishable in one to six weeks, so it is never scored.
 *
 * One area per project, per the current model. OQ-1 is open on whether that
 * holds; until it closes, the type says exactly one and means it.
 */

export type ProjectId = string;

export type ProjectStatus = 'active' | 'paused' | 'done' | 'dropped';

export const PROJECT_STATUSES = ['active', 'paused', 'done', 'dropped'] as const;

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly areaKey: AreaKey;
  readonly status: ProjectStatus;
  readonly deadline?: CalendarDate | undefined;
  /** Ordered subtopics. Become sections in the task tool. */
  readonly sections: readonly string[];
  readonly externalPageId?: string | undefined;
  readonly externalProjectId?: string | undefined;
  readonly origin: Origin;
}

export const projectSchema: z.ZodType<Project> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  areaKey: z.string().min(1),
  status: z.enum(PROJECT_STATUSES),
  deadline: calendarDateSchema.optional(),
  sections: z.array(z.string().min(1)).readonly(),
  externalPageId: z.string().min(1).optional(),
  externalProjectId: z.string().min(1).optional(),
  origin: originSchema,
});
