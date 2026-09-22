import { z } from 'zod';

/**
 * The task tool's wire format, as a schema per response shape.
 *
 * Every field here is either read by {@link ../task-tool/map.ts} or asserted to
 * have the shape the mapping assumes. Nothing is `z.any()`, and nothing is
 * coerced: a `priority` outside 1–4, an `is_deleted` that arrives as `0`
 * instead of `false`, a duration in an unknown unit — each one fails the run
 * with the field named, because the alternative is a plausible-looking guess
 * writing wrong priorities into a real backlog.
 *
 * Unknown *extra* keys are ignored rather than rejected. That asymmetry is
 * deliberate: a tool adding a field is routine and harmless, while a tool
 * changing the type of a field prisme reads is exactly the event this schema
 * exists to catch.
 */

const externalId = z.string().min(1);

const nullableId = externalId.nullable().optional();

/** `YYYY-MM-DD`, or a full timestamp for a task due at a time of day. */
const wireDate = z.string().min(8);

export const wireDueSchema = z.object({
  date: wireDate,
  is_recurring: z.boolean().optional(),
  string: z.string().optional(),
  timezone: z.string().nullable().optional(),
  lang: z.string().optional(),
});

export const wireDeadlineSchema = z.object({
  date: wireDate,
  lang: z.string().optional(),
});

export const wireDurationSchema = z.object({
  amount: z.number().int().positive(),
  unit: z.enum(['minute', 'day']),
});

export const wireItemSchema = z.object({
  id: externalId,
  project_id: externalId,
  section_id: nullableId,
  parent_id: nullableId,
  content: z.string(),
  description: z.string().optional(),
  // 4 is the tool's highest. Outside 1–4 there is no honest mapping.
  priority: z.number().int().min(1).max(4),
  labels: z.array(z.string()),
  checked: z.boolean(),
  is_deleted: z.boolean(),
  child_order: z.number().int().optional(),
  added_at: z.string().optional(),
  completed_at: z.string().nullable().optional(),
  due: wireDueSchema.nullable().optional(),
  deadline: wireDeadlineSchema.nullable().optional(),
  duration: wireDurationSchema.nullable().optional(),
});

export const wireProjectSchema = z.object({
  id: externalId,
  name: z.string(),
  parent_id: nullableId,
  is_archived: z.boolean(),
  is_deleted: z.boolean(),
  child_order: z.number().int().optional(),
});

export const wireSectionSchema = z.object({
  id: externalId,
  project_id: externalId,
  name: z.string(),
  is_archived: z.boolean(),
  is_deleted: z.boolean(),
  section_order: z.number().int().optional(),
});

export const wireLabelSchema = z.object({
  id: externalId,
  name: z.string(),
  is_deleted: z.boolean(),
  item_order: z.number().int().optional(),
});

/**
 * The sync response.
 *
 * Each collection is optional because the tool omits what did not change, and
 * an omitted collection genuinely means "nothing here" — unlike an omitted
 * `sync_token`, which would mean the next run silently re-reads the world.
 */
export const wireSyncResponseSchema = z.object({
  sync_token: z.string().min(1),
  full_sync: z.boolean().optional(),
  items: z.array(wireItemSchema).optional(),
  projects: z.array(wireProjectSchema).optional(),
  sections: z.array(wireSectionSchema).optional(),
  labels: z.array(wireLabelSchema).optional(),
});

/**
 * One completion.
 *
 * This is **not** v9's `completed/get_all` record. That endpoint is gone
 * (410), and its replacement returns a *task* rather than a completion: the
 * task's own id arrives as `id`, where v9 sent `task_id`. Nothing else about
 * the item moved, so the mapping changed in one place and nowhere else.
 */
export const wireCompletedItemSchema = z.object({
  id: externalId,
  project_id: nullableId,
  section_id: nullableId,
  completed_at: z.string().min(1),
  content: z.string().optional(),
  duration: wireDurationSchema.nullable().optional(),
});

/**
 * The completion-history envelope.
 *
 * `next_cursor` is the whole of the paging contract: present while there is
 * more to read, absent (or null) on the last page. There is deliberately no
 * `offset` here — the endpoint ignores one, and a reader that paged by offset
 * would spin on page one for ever while looking healthy.
 */
export const wireCompletedResponseSchema = z.object({
  items: z.array(wireCompletedItemSchema),
  next_cursor: z.string().min(1).nullable().optional(),
});

export type WireItem = z.infer<typeof wireItemSchema>;
export type WireProject = z.infer<typeof wireProjectSchema>;
export type WireSection = z.infer<typeof wireSectionSchema>;
export type WireLabel = z.infer<typeof wireLabelSchema>;
export type WireSyncResponse = z.infer<typeof wireSyncResponseSchema>;
export type WireCompletedItem = z.infer<typeof wireCompletedItemSchema>;
