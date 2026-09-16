import { z } from 'zod';

/**
 * The document tool's wire format.
 *
 * The properties of a page are a map keyed by **user-defined names**, so this
 * file is careful about two different things at once:
 *
 *   - a property's *payload* is validated strictly, per type, because that is
 *     where a silent mis-mapping would come from;
 *   - a property's *name* is never used in a schema, a message or a log. It
 *     describes somebody's workspace (docs/17-privacy.md §1). `parse.ts` also
 *     redacts it out of any issue path that reaches an error.
 */

export const wireAnnotationsSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    strikethrough: z.boolean().optional(),
    underline: z.boolean().optional(),
    code: z.boolean().optional(),
    color: z.string().optional(),
  })
  .optional();

export const wireRichTextSchema = z.object({
  plain_text: z.string(),
  href: z.string().nullable().optional(),
  annotations: wireAnnotationsSchema,
});

export const wireRichTextArraySchema = z.array(wireRichTextSchema);

const named = z.object({ name: z.string() });

/** One schema per property type prisme reads. Selected by the `type` discriminant. */
export const WIRE_PROPERTY_SCHEMAS = {
  title: z.object({ title: wireRichTextArraySchema }),
  rich_text: z.object({ rich_text: wireRichTextArraySchema }),
  number: z.object({ number: z.number().nullable() }),
  select: z.object({ select: named.nullable() }),
  status: z.object({ status: named.nullable() }),
  multi_select: z.object({ multi_select: z.array(named) }),
  checkbox: z.object({ checkbox: z.boolean() }),
  url: z.object({ url: z.string().nullable() }),
  relation: z.object({ relation: z.array(z.object({ id: z.string().min(1) })) }),
  date: z.object({
    date: z.object({ start: z.string(), end: z.string().nullable().optional() }).nullable(),
  }),
  created_time: z.object({ created_time: z.string().min(1) }),
  last_edited_time: z.object({ last_edited_time: z.string().min(1) }),
} as const;

/**
 * Types prisme knows about and declines to read.
 *
 * `people`, `email` and `phone_number` are the most sensitive properties a
 * personal workspace has, and prisme has no feature that needs them. `files`
 * carries expiring signed URLs. Each is counted and discarded — see
 * `DocPropertyValue.not_read`.
 */
export const NOT_READ_PROPERTY_TYPES = [
  'people',
  'email',
  'phone_number',
  'files',
  'created_by',
  'last_edited_by',
] as const;

/** Just enough of a property to choose a schema. The payload is parsed separately. */
export const wirePropertyEnvelopeSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
});

export const wirePageSchema = z.object({
  object: z.literal('page'),
  id: z.string().min(1),
  created_time: z.string().min(1),
  last_edited_time: z.string().min(1),
  archived: z.boolean().optional(),
  in_trash: z.boolean().optional(),
  // Deliberately not read: `url` and `public_url` identify the workspace.
  properties: z.record(z.string(), z.unknown()),
});

export const wireQueryResponseSchema = z.object({
  object: z.literal('list'),
  results: z.array(z.unknown()),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

export const wireBlockSchema = z
  .object({
    object: z.literal('block'),
    id: z.string().min(1),
    type: z.string().min(1),
    has_children: z.boolean(),
  })
  .loose();

export const wireBlockListSchema = z.object({
  object: z.literal('list'),
  results: z.array(wireBlockSchema),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

/** The text-bearing payload shared by paragraphs, headings, list items and the rest. */
export const wireTextBlockPayloadSchema = z.object({
  rich_text: wireRichTextArraySchema,
  checked: z.boolean().optional(),
});

export type WirePage = z.infer<typeof wirePageSchema>;
export type WireRichText = z.infer<typeof wireRichTextSchema>;
export type WireBlock = z.infer<typeof wireBlockSchema>;
