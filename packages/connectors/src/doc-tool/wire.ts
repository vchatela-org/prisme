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
  /*
   * Both spellings of "not live", because the tool renamed the field.
   *
   * `archived` was the tool's alias for `in_trash`, and the version this client
   * pins dropped it from every response — a page now returns `in_trash` where an
   * older one returned `archived`. Neither is required here, so a response
   * carrying only the new name parses either way; what keeps the *meaning* is
   * `mapPageContent` reading both (see the note there). They are optional
   * together rather than one-of, because a version may send both and the two
   * are documented to agree.
   */
  archived: z.boolean().optional(),
  in_trash: z.boolean().optional(),
  /*
   * Deliberately not read: `url` and `public_url` identify the workspace.
   *
   * Also unread, and for a different reason: `is_archived` and `is_locked`,
   * which the tool returns on every page but does not document. A boolean whose
   * meaning is not written down is not a mapping — it is a guess, and this
   * package refuses those (packages/connectors/CLAUDE.md, *Never guess a
   * mapping*). They are additive fields, present under every version, so
   * ignoring them is not a version problem; it is an open question, recorded
   * rather than answered.
   */
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

/**
 * A data source, as far as a person needs to recognise one.
 *
 * Read for the Settings screen and nothing else: the title, and the database
 * that holds it — which is what a browser opens, because a data source has no
 * page of its own. `properties` and the rest of the object are not read.
 */
export const wireDataSourceSchema = z.object({
  object: z.literal('data_source'),
  id: z.string().min(1),
  title: wireRichTextArraySchema,
  parent: z.object({ type: z.string(), database_id: z.string().min(1).optional() }).loose(),
});

/**
 * A database, read for one reason: a person pasted its link.
 *
 * A database link is what the tool's own *Copy link* gives, and prisme queries
 * the **data source** inside it. A database holding exactly one is resolved to
 * it; one holding several is refused rather than guessed.
 */
export const wireDatabaseSchema = z.object({
  object: z.literal('database'),
  id: z.string().min(1),
  title: wireRichTextArraySchema,
  data_sources: z.array(z.object({ id: z.string().min(1), name: z.string() })),
});

/** The text-bearing payload shared by paragraphs, headings, list items and the rest. */
export const wireTextBlockPayloadSchema = z.object({
  rich_text: wireRichTextArraySchema,
  checked: z.boolean().optional(),
});

export type WirePage = z.infer<typeof wirePageSchema>;
export type WireDataSource = z.infer<typeof wireDataSourceSchema>;
export type WireDatabase = z.infer<typeof wireDatabaseSchema>;
export type WireRichText = z.infer<typeof wireRichTextSchema>;
export type WireBlock = z.infer<typeof wireBlockSchema>;
