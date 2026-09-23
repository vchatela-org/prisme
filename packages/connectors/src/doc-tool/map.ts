import { isCalendarDate, type CalendarDate } from '@prisme/domain';
import { ConnectorError } from '../errors.js';
import { contentHash } from '../hash.js';
import { parseOrThrow, type ParseContext } from '../parse.js';
import type { RoleKey } from '../role-key.js';
import {
  EMPTY_TEXT,
  sanitisePlainText,
  sanitiseRichText,
  type SanitisedText,
} from '../sanitise.js';
import type { DocBlock, DocPropertyValue, DocRecord } from './types.js';
import {
  NOT_READ_PROPERTY_TYPES,
  WIRE_PROPERTY_SCHEMAS,
  wirePropertyEnvelopeSchema,
  wireTextBlockPayloadSchema,
  type WireBlock,
  type WirePage,
  type WireRichText,
} from './wire.js';

/**
 * Wire → typed record for the document tool.
 *
 * One distinction runs through this file and is the whole of "never guess a
 * mapping" made concrete:
 *
 * | Situation | What happens |
 * |---|---|
 * | A type prisme knows, with the payload it documents | Mapped |
 * | A type prisme knows, with a **different payload** | **The run fails** |
 * | A type prisme knows and declines to read | `not_read`, counted |
 * | A type prisme has never heard of | `unsupported`, recorded verbatim |
 *
 * Rows two and four are the ones people conflate. A tool that adds a property
 * type next quarter must not break a sync — so an unknown discriminant is
 * recorded and skipped. A tool that changes what `number` contains must break
 * it loudly, because everything downstream is about to write a wrong value into
 * a real workspace.
 */

const TOOL = 'doc' as const;

const NOT_READ: ReadonlySet<string> = new Set(NOT_READ_PROPERTY_TYPES);

function instant(raw: string, field: string, operation: string): Date {
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new ConnectorError('invalid_shape', `${field} is not a timestamp`, {
      tool: TOOL,
      operation,
    });
  }
  return at;
}

/** A date property's calendar day. A time of day is dropped — see the task-tool mapper. */
function calendarDay(raw: string): CalendarDate | null {
  const day = raw.slice(0, 10);
  return isCalendarDate(day) ? day : null;
}

function richText(runs: readonly WireRichText[]): SanitisedText {
  return sanitiseRichText(
    runs.map((run) => ({
      text: run.plain_text,
      href: run.href,
      annotations: run.annotations,
    })),
  );
}

function countOf(payload: unknown, type: string): number {
  if (typeof payload !== 'object' || payload === null) return 0;
  const value = (payload as Record<string, unknown>)[type];
  if (Array.isArray(value)) return value.length;
  return value == null ? 0 : 1;
}

export function mapProperty(raw: unknown, context: ParseContext): DocPropertyValue {
  const envelope = parseOrThrow(wirePropertyEnvelopeSchema, raw, {
    ...context,
    shape: 'page property',
  });
  const type = envelope.type;

  if (NOT_READ.has(type)) {
    return { kind: 'not_read', externalType: type, count: countOf(raw, type) };
  }

  switch (type) {
    case 'title': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.title, raw, {
        ...context,
        shape: 'title property',
      });
      return { kind: 'title', text: richText(value.title) };
    }
    case 'rich_text': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.rich_text, raw, {
        ...context,
        shape: 'rich_text property',
      });
      return { kind: 'rich_text', text: richText(value.rich_text) };
    }
    case 'number': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.number, raw, {
        ...context,
        shape: 'number property',
      });
      return { kind: 'number', value: value.number };
    }
    case 'select': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.select, raw, {
        ...context,
        shape: 'select property',
      });
      return {
        kind: 'select',
        value: value.select === null ? null : sanitisePlainText(value.select.name),
      };
    }
    case 'status': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.status, raw, {
        ...context,
        shape: 'status property',
      });
      return {
        kind: 'status',
        value: value.status === null ? null : sanitisePlainText(value.status.name),
      };
    }
    case 'multi_select': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.multi_select, raw, {
        ...context,
        shape: 'multi_select property',
      });
      return {
        kind: 'multi_select',
        values: value.multi_select.map((entry) => sanitisePlainText(entry.name)),
      };
    }
    case 'checkbox': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.checkbox, raw, {
        ...context,
        shape: 'checkbox property',
      });
      return { kind: 'checkbox', value: value.checkbox };
    }
    case 'url': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.url, raw, {
        ...context,
        shape: 'url property',
      });
      return { kind: 'url', value: value.url === null ? null : sanitisePlainText(value.url) };
    }
    case 'relation': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.relation, raw, {
        ...context,
        shape: 'relation property',
      });
      return { kind: 'relation', ids: value.relation.map((entry) => entry.id) };
    }
    case 'date': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.date, raw, {
        ...context,
        shape: 'date property',
      });
      if (value.date === null) return { kind: 'date', start: null, end: null };
      return {
        kind: 'date',
        start: calendarDay(value.date.start),
        end: value.date.end == null ? null : calendarDay(value.date.end),
      };
    }
    case 'created_time': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.created_time, raw, {
        ...context,
        shape: 'created_time property',
      });
      return {
        kind: 'created_time',
        at: instant(value.created_time, 'created_time', context.operation),
      };
    }
    case 'last_edited_time': {
      const value = parseOrThrow(WIRE_PROPERTY_SCHEMAS.last_edited_time, raw, {
        ...context,
        shape: 'last_edited_time property',
      });
      return {
        kind: 'last_edited_time',
        at: instant(value.last_edited_time, 'last_edited_time', context.operation),
      };
    }
    default:
      return { kind: 'unsupported', externalType: type };
  }
}

/** The text a property contributes to the record's hash and URL list. */
function textOf(value: DocPropertyValue): SanitisedText {
  switch (value.kind) {
    case 'title':
    case 'rich_text':
      return value.text;
    default:
      return EMPTY_TEXT;
  }
}

/**
 * What a property contributes to the content hash.
 *
 * `Date` objects are reduced to ISO strings by the canonicaliser, so this only
 * has to drop what must not count: nothing, as it turns out — every kept kind
 * is something prisme reads, and a change to any of them is a real change.
 */
function hashableProperties(
  properties: ReadonlyMap<string, DocPropertyValue>,
): Record<string, unknown> {
  const hashable: Record<string, unknown> = {};
  for (const [name, value] of properties) {
    hashable[name] =
      value.kind === 'title' || value.kind === 'rich_text'
        ? { kind: value.kind, text: value.text.text }
        : value;
  }
  return hashable;
}

/**
 * Whether a page is live, from the two spellings the tool uses for "not live".
 *
 * `in_trash` is the field the tool documents and the one the version this client
 * pins returns; `archived` is the alias it used to return and no longer does.
 * Reading **both** is what makes the answer the same under either version — and
 * it has to be an *or*, not a choice of one: a version that sends the old name
 * sends nothing under the new one, so a reader that picked either field alone
 * would call every trashed page live on the other version. A trashed page is not
 * live, which is the fact this is about; which key carries it is the tool's
 * business. It matters because the read is level-triggered (docs/16-sync.md §2):
 * a page that reads as live when it is not is drift no later pass will notice.
 */
function isArchived(page: WirePage): boolean {
  return (page.archived ?? false) || (page.in_trash ?? false);
}

/**
 * Everything a page record holds except which store it came from.
 *
 * Split out because `fetchPage` reads one page by ID and has no role to report;
 * inventing one to satisfy the shape would put a wrong role key on a record,
 * and a wrong role key is the kind of thing that later reads as a fact.
 */
export function mapPageContent(page: WirePage, operation: string): Omit<DocRecord, 'role'> {
  const context: ParseContext = { tool: TOOL, operation, shape: 'page' };

  const properties = new Map<string, DocPropertyValue>();
  const urls: string[] = [];
  let title = '';

  for (const [name, raw] of Object.entries(page.properties)) {
    const value = mapProperty(raw, context);
    properties.set(name, value);

    if (value.kind === 'title') title = value.text.text;
    for (const url of textOf(value).urls) {
      if (!urls.includes(url)) urls.push(url);
    }
  }

  return {
    externalId: page.id,
    lastEditedAt: instant(page.last_edited_time, 'last_edited_time', operation),
    createdAt: instant(page.created_time, 'created_time', operation),
    archived: isArchived(page),
    title,
    properties,
    urls,
    // Deliberately excludes `last_edited_time`: a touch that changes nothing
    // must not look like a change (docs/16-sync.md §2).
    contentHash: contentHash({
      archived: isArchived(page),
      properties: hashableProperties(properties),
    }),
  };
}

export function mapPage(page: WirePage, role: RoleKey, operation: string): DocRecord {
  return { role, ...mapPageContent(page, operation) };
}

/**
 * Block types prisme extracts text from.
 *
 * An allow-list, so a new block type is skipped rather than half-read. What is
 * *not* here is as deliberate: an image, a file, an embed and a bookmark all
 * carry URLs and no prose, and a `child_page` is a different page with its own
 * identity.
 */
export const TEXT_BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
  'code',
] as const;

const TEXT_BLOCKS: ReadonlySet<string> = new Set(TEXT_BLOCK_TYPES);

export interface MappedBlock {
  readonly block: DocBlock | undefined;
  readonly hasChildren: boolean;
}

export function mapBlock(block: WireBlock, depth: number, operation: string): MappedBlock {
  if (!TEXT_BLOCKS.has(block.type)) {
    return { block: undefined, hasChildren: block.has_children };
  }

  const payload = parseOrThrow(
    wireTextBlockPayloadSchema,
    (block as unknown as Record<string, unknown>)[block.type],
    { tool: TOOL, operation, shape: `${block.type} block` },
  );

  return {
    block: {
      externalId: block.id,
      type: block.type,
      depth,
      text: richText(payload.rich_text),
      ...(payload.checked === undefined ? {} : { checked: payload.checked }),
    },
    hasChildren: block.has_children,
  };
}
