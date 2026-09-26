import { ConnectorError } from '../errors.js';
import type { RetryPolicy } from '../http/backoff.js';
import { trimTrailing } from '../util/trim.js';
import { executeJson, type RequestOptions } from '../http/request.js';
import { createRefusingTransport, type Transport } from '../http/transport.js';
import { contentHash } from '../hash.js';
import type { ConnectorMetrics } from '../metrics.js';
import { parseOrThrow } from '../parse.js';
import { assertCreatable, assertReadable, type RoleBindings, type RoleKey } from '../role-key.js';
import type { StoreShape } from '../role-key.js';
import { sanitisePlainText } from '../sanitise.js';
import { mapBlock, mapPage, mapPageContent } from './map.js';
import type {
  CreatePageInput,
  DocBlock,
  DocPage,
  DocRecord,
  DocStoreDescription,
  DocTemplate,
  DocToolClient,
} from './types.js';
import {
  wireBlockListSchema,
  wireDatabaseSchema,
  wireDataSourceSchema,
  wireDataSourcePropertiesSchema,
  wirePageSchema,
  wireQueryResponseSchema,
  wireTemplateListSchema,
  type WirePage,
  type WireRichText,
} from './wire.js';

/**
 * The live document-tool client.
 *
 * Three things here are not obvious from the endpoint calls:
 *
 *   - **`since` is already overlapped.** This client passes the caller's floor
 *     straight through. The two-minute rule lives in `watermark.ts`, alone, so
 *     that it is implemented once and tested once (docs/16-sync.md §2).
 *   - **Pagination is bounded and cursor-checked.** A cursor that repeats is a
 *     loop, and a loop inside a pass holds the advisory lock against every
 *     later run.
 *   - **No store is addressed by name.** `queryByRole` takes a role key and
 *     resolves it through the bindings; the identifier it gets back is never
 *     logged and never appears in an error (docs/17-privacy.md §1).
 */

/** The tool's public API host. No workspace appears in it, and it is overridable. */
export const DEFAULT_DOC_TOOL_BASE_URL = 'https://api.notion.com';

/**
 * Pinned: the tool dates its breaking changes, and an unpinned version is a
 * silent upgrade.
 *
 * The **value** matters as much as the pin. A version header is not a
 * capability list — the tool rejects a string it does not recognise — and the
 * endpoints below belong to an API surface that only exists from `2025-09-03`
 * onwards: `POST /v1/data_sources/<id>/query` answers `400 invalid_request_url`
 * under `2022-06-28`, which is the pin this client shipped with. So the pin and
 * the calls were from two different eras, and every query failed.
 *
 * Bumping it is not a one-line change to be made on faith: a version accompanies
 * *breaking* changes, so each endpoint this client reads has to be checked
 * against the new one (see the comments on `wirePageSchema` and `mapPageContent`
 * for the one that moved when this was raised).
 */
export const DEFAULT_DOC_TOOL_API_VERSION = '2026-03-11';

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
/** How far block recursion goes. A page body is nested lists, not a filesystem. */
const MAX_BLOCK_DEPTH = 3;

export interface DocToolClientOptions {
  /** The integration token. Held here, logged nowhere (docs/14-threat-model.md §1, A1). */
  readonly token: string;
  /** Role key → external identifier. Set in Settings → Notion, never in git. */
  readonly bindings: RoleBindings;
  readonly baseUrl?: string | undefined;
  readonly apiVersion?: string | undefined;
  readonly transport?: Transport | undefined;
  readonly retry?: RetryPolicy | undefined;
  readonly metrics?: ConnectorMetrics | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => Date) | undefined;
  readonly maxBlockDepth?: number | undefined;
}

export function createDocToolClient(options: DocToolClientOptions): DocToolClient {
  const baseUrl = trimTrailing(options.baseUrl ?? DEFAULT_DOC_TOOL_BASE_URL, '/');
  const transport = options.transport ?? createRefusingTransport('doc');
  const maxBlockDepth = options.maxBlockDepth ?? MAX_BLOCK_DEPTH;

  const headers = {
    authorization: `Bearer ${options.token}`,
    'notion-version': options.apiVersion ?? DEFAULT_DOC_TOOL_API_VERSION,
    'content-type': 'application/json',
  };

  const requestOptions = (operation: string): RequestOptions => ({
    tool: 'doc',
    operation,
    transport,
    retry: options.retry,
    metrics: options.metrics,
    sleep: options.sleep,
    random: options.random,
    now: options.now,
  });

  const send = async (
    method: 'GET' | 'POST',
    path: string,
    operation: string,
    body?: unknown,
  ): Promise<unknown> =>
    executeJson(
      {
        method,
        url: `${baseUrl}${path}`,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      requestOptions(operation),
    );

  /** Refuses a cursor that repeats, and a result set that will not end. */
  const guardCursor = (
    seen: Set<string>,
    cursor: string | null,
    operation: string,
  ): string | undefined => {
    if (cursor === null) return undefined;
    if (seen.has(cursor)) {
      throw new ConnectorError('pagination', 'the cursor repeated; this would page forever', {
        tool: 'doc',
        operation,
      });
    }
    seen.add(cursor);
    return cursor;
  };

  async function fetchBlocks(
    parentId: string,
    depth: number,
    operation: string,
  ): Promise<{ blocks: DocBlock[]; skipped: Set<string> }> {
    const blocks: DocBlock[] = [];
    const skipped = new Set<string>();
    if (depth > maxBlockDepth) return { blocks, skipped };

    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ page_size: String(PAGE_SIZE) });
      if (cursor !== undefined) query.set('start_cursor', cursor);

      const body = await send(
        'GET',
        `/v1/blocks/${encodeURIComponent(parentId)}/children?${query.toString()}`,
        operation,
      );
      const response = parseOrThrow(wireBlockListSchema, body, {
        tool: 'doc',
        operation,
        shape: 'block list',
      });

      for (const wireBlock of response.results) {
        const mapped = mapBlock(wireBlock, depth, operation);
        if (mapped.block === undefined) skipped.add(wireBlock.type);
        else blocks.push(mapped.block);

        if (mapped.hasChildren && depth < maxBlockDepth) {
          const children = await fetchBlocks(wireBlock.id, depth + 1, operation);
          blocks.push(...children.blocks);
          for (const type of children.skipped) skipped.add(type);
        }
      }

      if (!response.has_more) return { blocks, skipped };
      cursor = guardCursor(seen, response.next_cursor, operation);
      if (cursor === undefined) return { blocks, skipped };
    }

    throw new ConnectorError(
      'pagination',
      `block list did not end after ${String(MAX_PAGES)} pages`,
      {
        tool: 'doc',
        operation,
      },
    );
  }

  /**
   * A page read by id, in full — properties and body.
   *
   * Only `fetchPage` reaches it. The creating path deliberately does not: the
   * page it finds or makes belongs to the document tool, and `create` reads a
   * store's entry *titles* and nothing of their bodies (ADR-0030 rule 7).
   *
   * No role is stamped on the result: a page fetched by id did not arrive
   * through a role-keyed query, and inventing one would be a lie about where
   * it came from.
   */
  async function readPageById(id: string, operation: string): Promise<DocPage> {
    const body = await send('GET', `/v1/pages/${encodeURIComponent(id)}`, operation);
    const wirePage = parseOrThrow(wirePageSchema, body, {
      tool: 'doc',
      operation,
      shape: 'page',
    });

    const record = mapPageContent(wirePage, operation);
    const { blocks, skipped } = await fetchBlocks(wirePage.id, 0, operation);

    const text = blocks.map((block) => block.text.text).join('\n');
    const urls = [...new Set(blocks.flatMap((block) => [...block.text.urls]))];

    return {
      externalId: record.externalId,
      title: record.title,
      lastEditedAt: record.lastEditedAt,
      createdAt: record.createdAt,
      archived: record.archived,
      blocks,
      text,
      urls,
      skippedBlockTypes: [...skipped].sort(),
      contentHash: contentHash({ properties: record.contentHash, text }),
    };
  }

  /**
   * The id of a data source's **title property**, found by type (ADR-0030 rule 1).
   *
   * Not by name: the title column is called whatever the workspace calls it, in
   * whatever language the workspace is in, and prisme has no business knowing
   * either. A data source has exactly one title property by the tool's own
   * rules, so none — or two — is a shape this client does not recognise, and it
   * says so rather than writing the title into whichever it met first.
   *
   * The name, which is the map's key, is read past and never kept.
   */
  async function titlePropertyOf(dataSourceId: string, operation: string): Promise<string> {
    const schema = parseOrThrow(
      wireDataSourcePropertiesSchema,
      await send('GET', `/v1/data_sources/${encodeURIComponent(dataSourceId)}`, operation),
      { tool: 'doc', operation, shape: 'data source' },
    );
    const titles = Object.values(schema.properties).filter((property) => property.type === 'title');
    const [only, ...others] = titles;
    if (only === undefined || others.length > 0) {
      throw new ConnectorError(
        'invalid_shape',
        `the data source has ${String(titles.length)} title properties where the tool guarantees one`,
        { tool: 'doc', operation },
      );
    }
    return only.id;
  }

  /**
   * The live entry of this data source whose title is this one, if there is one.
   *
   * The document tool has no idempotency key, so the identity of "the page this
   * creation is about" cannot be attached to anything prisme sends. What it
   * *can* be is a question about the world: the operation becomes "ensure an
   * entry with this title exists in this database", which is the same shape
   * every other pass in this application has (ADR-0009, ADR-0030 rule 6).
   *
   * Two properties keep it inside what `create` may read (ADR-0030 rule 7):
   * the filter asks the tool for **exact title matches** only, and
   * `filter_properties` asks it to return **the title and nothing else** — so
   * no other entry, and no other property of a matching one, reaches prisme.
   * The body is never fetched: a match is returned as the entry it is.
   *
   * The limitation is real and worth stating: two live entries with one title
   * in one database are indistinguishable to this, so the second is treated as
   * the first. A database where that matters is one whose entries a person
   * cannot tell apart either. A trashed entry is not a match — the tool leaves
   * archived entries out of a query, and one that arrives anyway is skipped —
   * so a page somebody deleted is created again rather than resurrected.
   */
  async function findLiveEntry(
    dataSourceId: string,
    titleProperty: string,
    title: string,
    operation: string,
  ): Promise<WirePage | undefined> {
    const seen = new Set<string>();
    let cursor: string | undefined;
    const only = new URLSearchParams([['filter_properties[]', titleProperty]]);

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await send(
        'POST',
        `/v1/data_sources/${encodeURIComponent(dataSourceId)}/query?${only.toString()}`,
        operation,
        {
          page_size: PAGE_SIZE,
          ...(cursor === undefined ? {} : { start_cursor: cursor }),
          filter: { property: titleProperty, title: { equals: title } },
        },
      );
      const response = parseOrThrow(wireQueryResponseSchema, body, {
        tool: 'doc',
        operation,
        shape: 'query response',
      });

      for (const result of response.results) {
        const entry = parseOrThrow(wirePageSchema, result, {
          tool: 'doc',
          operation,
          shape: 'page',
        });
        if (!mapPageContent(entry, operation).archived) return entry;
      }

      if (!response.has_more) return undefined;
      cursor = guardCursor(seen, response.next_cursor, operation);
      if (cursor === undefined) return undefined;
    }

    throw new ConnectorError('pagination', `query did not end after ${String(MAX_PAGES)} pages`, {
      tool: 'doc',
      operation,
    });
  }

  /** A page's properties as the creating path returns them: no body, by design. */
  function entryOf(wirePage: WirePage, operation: string): DocPage {
    const record = mapPageContent(wirePage, operation);
    return {
      externalId: record.externalId,
      title: record.title,
      lastEditedAt: record.lastEditedAt,
      createdAt: record.createdAt,
      archived: record.archived,
      blocks: [],
      text: '',
      urls: [],
      skippedBlockTypes: [],
      contentHash: record.contentHash,
    };
  }

  /**
   * A data source by id — or, when the id is a database, the one data source
   * inside it.
   *
   * The tool's *Copy link* on a database gives the **database**, and prisme
   * queries the **data source**; the two ids differ and a person cannot see the
   * second anywhere. So a database is resolved when that is unambiguous, and a
   * database holding several data sources is refused with a count rather than
   * bound to whichever the tool happened to list first.
   */
  async function describeDataSource(id: string, operation: string): Promise<DocStoreDescription> {
    let body: unknown;
    try {
      body = await send('GET', `/v1/data_sources/${encodeURIComponent(id)}`, operation);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      let databaseBody: unknown;
      try {
        databaseBody = await send('GET', `/v1/databases/${encodeURIComponent(id)}`, operation);
      } catch (notDatabase) {
        if (!isNotFound(notDatabase)) throw notDatabase;
        return refuseOtherKind(id, operation, notDatabase);
      }
      const database = parseOrThrow(wireDatabaseSchema, databaseBody, {
        tool: 'doc',
        operation,
        shape: 'database',
      });
      const [only, ...others] = database.data_sources;
      if (only === undefined || others.length > 0) {
        throw new ConnectorError(
          'refused',
          `that database holds ${String(database.data_sources.length)} data sources; bind one of them rather than the database`,
          { tool: 'doc', operation },
        );
      }
      return {
        externalId: only.id,
        title: plain(database.title) || only.name,
        linkId: database.id,
      };
    }

    const source = parseOrThrow(wireDataSourceSchema, body, {
      tool: 'doc',
      operation,
      shape: 'data source',
    });
    return {
      externalId: source.id,
      title: plain(source.title),
      linkId: source.parent.database_id ?? source.id,
    };
  }

  /**
   * Why an identifier that is neither a data source nor a database failed —
   * **as far as the tool lets that be known**.
   *
   * A page store used to be a page (ADR-0025), and a binding made then names
   * one; ADR-0030 says such a binding "now fails its check as the wrong kind of
   * object — which is the truth". The tool answers a data-source or database
   * read of a page's identifier the same way it answers one of an object the
   * integration cannot see, so the difference is only observable by reading the
   * identifier *as a page*: if that succeeds, it is a page, shared, and the
   * wrong kind. Properties only — the same metadata `describe` reads anywhere —
   * and the page is not described, because it is not what the role names.
   *
   * If that read fails too, nothing distinguishes "not shared" from "not a
   * database", and the original refusal is what is reported.
   */
  async function refuseOtherKind(id: string, operation: string, refusal: unknown): Promise<never> {
    let isPage = false;
    try {
      parseOrThrow(
        wirePageSchema,
        await send('GET', `/v1/pages/${encodeURIComponent(id)}`, operation),
        { tool: 'doc', operation, shape: 'page' },
      );
      isPage = true;
    } catch {
      // Not a page the integration can see either: nothing tells the two apart.
    }
    if (isPage) {
      throw new ConnectorError('wrong_kind', 'that identifier names a page, not a database', {
        tool: 'doc',
        operation,
      });
    }
    throw refusal;
  }

  /**
   * Every template a data source holds, following the list's cursor.
   *
   * Sorted by name so that two reads of an unchanged database list the same
   * way — a screen that reorders a select between two visits reads as a change.
   */
  async function templatesOf(dataSourceId: string, operation: string): Promise<DocTemplate[]> {
    const templates: DocTemplate[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ page_size: String(PAGE_SIZE) });
      if (cursor !== undefined) query.set('start_cursor', cursor);

      const response = parseOrThrow(
        wireTemplateListSchema,
        await send(
          'GET',
          `/v1/data_sources/${encodeURIComponent(dataSourceId)}/templates?${query.toString()}`,
          operation,
        ),
        { tool: 'doc', operation, shape: 'template list' },
      );

      for (const template of response.templates) {
        templates.push({
          id: template.id,
          name: sanitisePlainText(template.name).trim(),
          isDefault: template.is_default,
        });
      }

      if (!response.has_more) {
        return templates.sort((left, right) => left.name.localeCompare(right.name));
      }
      cursor = guardCursor(seen, response.next_cursor, operation);
      if (cursor === undefined) {
        return templates.sort((left, right) => left.name.localeCompare(right.name));
      }
    }

    throw new ConnectorError(
      'pagination',
      `template list did not end after ${String(MAX_PAGES)} pages`,
      { tool: 'doc', operation },
    );
  }

  return {
    describe(externalId: string, shape: StoreShape): Promise<DocStoreDescription> {
      // Every role names a data source since ADR-0030, so there is one way to
      // describe one. The shape is still taken, and still named in the
      // operation, because it is what the caller asked for.
      return describeDataSource(externalId, `describe ${shape}`);
    },

    async queryByRole(role: RoleKey, since?: Date): Promise<DocRecord[]> {
      const operation = `query ${role}`;
      assertReadable(role, operation);
      const externalId = options.bindings.resolve(role);

      const records: DocRecord[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const body = await send(
          'POST',
          `/v1/data_sources/${encodeURIComponent(externalId)}/query`,
          operation,
          {
            page_size: PAGE_SIZE,
            ...(cursor === undefined ? {} : { start_cursor: cursor }),
            ...(since === undefined
              ? {}
              : {
                  filter: {
                    timestamp: 'last_edited_time',
                    last_edited_time: { on_or_after: since.toISOString() },
                  },
                }),
            sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
          },
        );

        const response = parseOrThrow(wireQueryResponseSchema, body, {
          tool: 'doc',
          operation,
          shape: 'query response',
        });

        for (const result of response.results) {
          const wirePage = parseOrThrow(wirePageSchema, result, {
            tool: 'doc',
            operation,
            shape: 'page',
          });
          records.push(mapPage(wirePage, role, operation));
        }

        if (!response.has_more) return records;
        cursor = guardCursor(seen, response.next_cursor, operation);
        if (cursor === undefined) return records;
      }

      throw new ConnectorError('pagination', `query did not end after ${String(MAX_PAGES)} pages`, {
        tool: 'doc',
        operation,
      });
    },

    /**
     * The templates of a page store's database (ADR-0030 rule 3).
     *
     * Behind `assertCreatable`, not `assertReadable`: this is one of the three
     * reads the `create` capability carries, and it is refused on a role prisme
     * only reads — a template list is a question about where pages are made,
     * and a read store is not one.
     */
    async listTemplates(role: RoleKey): Promise<readonly DocTemplate[]> {
      const operation = `list templates ${role}`;
      assertCreatable(role, operation);
      return templatesOf(options.bindings.resolve(role), operation);
    },

    /**
     * ADR-0011's narrative page, created as an entry of the page store's
     * database (ADR-0030).
     *
     * Four properties, and each is a decision one of the two records made:
     *
     *   - **The parent is the bound data source.** The role key names *where* a
     *     page is created, so the thing it resolves to is the parent. Nothing
     *     here guesses a location, which is the whole reason the vocabulary had
     *     to grow before this method could exist.
     *   - **The title is the only property sent**, keyed by the title
     *     property's id — found by type in the schema, because the column's name
     *     is the workspace's. A template may set other properties; those are the
     *     template's and the document tool's, and prisme does not read them back.
     *   - **The template is applied by the document tool.** The resolved
     *     identifier is sent as `template_id` — never `default`, so that what the
     *     plan showed is what is sent — and no `children`, which the tool refuses
     *     beside a template. The tool fills the body *after* answering, and this
     *     neither waits for it nor reads it: the page belongs to the document
     *     tool the moment it exists (docs/11-ownership.md §3), and prisme writes
     *     nothing of its own into it — no backlink, no marker, nothing.
     *   - **It is level-triggered.** The document tool has no idempotency key,
     *     so a retry after a timeout that had in fact succeeded cannot be told
     *     apart from a first attempt — unless the question asked is "is there
     *     already a live entry with this title in this database", which is a
     *     question about the world rather than about the request (ADR-0009,
     *     ADR-0030 rule 6). That is what this does, and it is why the operation
     *     is safe to run twice.
     */
    async createPage(input: CreatePageInput): Promise<DocPage> {
      const operation = 'create page';
      assertCreatable(input.role, operation);

      const dataSourceId = options.bindings.resolve(input.role);
      const titleProperty = await titlePropertyOf(dataSourceId, operation);

      const existing = await findLiveEntry(dataSourceId, titleProperty, input.title, operation);
      if (existing !== undefined) return entryOf(existing, operation);

      const body = await send('POST', '/v1/pages', operation, {
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties: {
          [titleProperty]: { title: [{ type: 'text', text: { content: input.title } }] },
        },
        template: { type: 'template_id', template_id: input.templateId },
      });

      return entryOf(
        parseOrThrow(wirePageSchema, body, { tool: 'doc', operation, shape: 'page' }),
        operation,
      );
    },

    fetchPage(id: string): Promise<DocPage> {
      return readPageById(id, 'fetch page');
    },
  };
}

/** A 404, or the 400 the tool answers when an id names an object of another kind. */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof ConnectorError &&
    error.failure === 'refused' &&
    (error.status === 404 || error.status === 400)
  );
}

function plain(runs: readonly WireRichText[]): string {
  return sanitisePlainText(runs.map((run) => run.plain_text).join('')).trim();
}
