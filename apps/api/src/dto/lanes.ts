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
  /** The most recent period's adherence, or null when nothing has been recorded. */
  latestAdherencePct: z.number().nullable(),
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
