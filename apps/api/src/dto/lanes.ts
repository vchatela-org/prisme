import { z } from 'zod';
import { defineWrite, named } from '../http/schema.js';
import {
  areaKey,
  calendarDate,
  entityId,
  instant,
  page,
  percentage,
  ritualCadence,
} from './common.js';
import { RITUAL_READ_ONLY, TAKEAWAY_READ_ONLY } from './ownership.js';

/**
 * The lanes deliberately outside the ranked backlog (ADR-0014), and the reading
 * pipeline that feeds it.
 *
 * A takeaway is owned outright by the document tool: prisme mirrors it, and the
 * only write it offers is **promotion**, which creates an initiative and links
 * back. It does not copy the takeaway's text and does not modify it
 * (docs/10-model.md §8) — which is why the takeaway DTO carries an external
 * page id and no body.
 */

export const takeawayDto = z.object({
  id: entityId,
  /** A principle never enters the backlog; an action is a candidate initiative. */
  kind: z.enum(['principle', 'action']),
  externalPageId: z.string(),
  areaKey: areaKey.nullable(),
  promotedTo: entityId.nullable(),
  mayEnterBacklog: z.boolean(),
  observedAt: instant,
});

export const ritualDto = z.object({
  id: entityId,
  name: z.string(),
  areaKey,
  cadence: ritualCadence,
  targetAdherencePct: percentage,
  externalPageId: z.string().nullable(),
  /**
   * The recurring task its adherence is measured from (S2), or null for a habit
   * that is not a task — whose periods are recorded by hand instead.
   */
  externalTaskId: z.string().nullable(),
  /** The most recent period's adherence, or null when nothing has been recorded. */
  latestAdherencePct: z.number().nullable(),
  /**
   * The period today falls in (`ritualPeriodOf`), and what is recorded for it so
   * far — zero completions when nothing is. What *done this period* writes to.
   */
  currentPeriod: z.object({
    periodStart: calendarDate,
    opportunities: z.int(),
    completions: z.int(),
  }),
});

/**
 * One open recurring task in the task tool, as a ritual's task is picked from.
 * `heldBy` names what in prisme already holds it — the guard a pick would hit.
 */
export const recurringTaskDto = z.object({
  id: z.string(),
  title: z.string(),
  /** The area its project or section maps to, or null when none does. */
  areaKey: areaKey.nullable(),
  heldBy: z.object({ kind: z.string(), id: z.string() }).nullable(),
});

export const adherenceDto = z.object({
  periodStart: calendarDate,
  opportunities: z.int(),
  completions: z.int(),
  /** Null when there was no opportunity — which is different from missing every one. */
  adherencePct: z.number().nullable(),
});

export const TakeawayPageDto = named('TakeawayPage', page(takeawayDto));
export const RitualListDto = named('RitualList', z.object({ items: z.array(ritualDto) }));
export const RitualDto = named('Ritual', ritualDto);
export const RecurringTasksDto = named(
  'RecurringTasks',
  z.object({
    items: z.array(recurringTaskDto),
    /** Why the task tool could not be read — a connector failure kind — or `null`. */
    failure: z.string().nullable(),
  }),
);
export const AdherenceSeriesDto = named(
  'AdherenceSeries',
  z.object({
    ritualId: entityId,
    targetAdherencePct: percentage,
    items: z.array(adherenceDto),
  }),
);

export const promoteTakeawayBody = defineWrite(
  'PromoteTakeaway',
  z.strictObject({
    /** The initiative's title is written here, not copied from the takeaway. */
    title: z.string().min(1).max(500),
    areaKey,
    value: z.literal([1, 2, 3, 5, 8, 13]),
    timeCriticality: z.literal([1, 2, 3, 5, 8, 13]),
    risk: z.literal([1, 2, 3, 5, 8, 13]),
    size: z.literal([1, 2, 3, 5, 8, 13]),
  }),
  TAKEAWAY_READ_ONLY,
);

export const createRitualBody = defineWrite(
  'CreateRitual',
  z.strictObject({
    name: z.string().min(1).max(200),
    areaKey,
    cadence: ritualCadence,
    targetAdherencePct: percentage,
    externalPageId: z.string().min(1).max(200).optional(),
    /** The recurring task to measure it from. Refused with `409` if another entity holds it. */
    externalTaskId: z.string().min(1).max(200).optional(),
  }),
  RITUAL_READ_ONLY,
);

export const updateRitualBody = defineWrite(
  'UpdateRitual',
  z.strictObject({
    name: z.string().min(1).max(200).optional(),
    cadence: ritualCadence.optional(),
    targetAdherencePct: percentage.optional(),
    externalPageId: z.string().min(1).max(200).nullable().optional(),
    /** Another task replaces the one before; `null` unties it. `409` if another entity holds it. */
    externalTaskId: z.string().min(1).max(200).nullable().optional(),
  }),
  RITUAL_READ_ONLY,
);

export const recordAdherenceBody = defineWrite(
  'RecordAdherence',
  z
    .strictObject({
      periodStart: calendarDate,
      opportunities: z.int().min(0),
      completions: z.int().min(0),
    })
    .refine((value) => value.completions <= value.opportunities, {
      error: 'a period cannot record more completions than it offered opportunities',
      path: ['completions'],
    }),
);
