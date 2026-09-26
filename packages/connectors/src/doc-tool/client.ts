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
  DocToolClient,
} from './types.js';
import {
  wireBlockListSchema,
  wireDatabaseSchema,
  wireDataSourceSchema,
  wirePageSchema,
  wireQueryResponseSchema,
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
  /** Role key → external identifier. Loaded from the seed data, never from git. */
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
   * A page read by id, in full.
   *
   * A named function rather than a method, because two paths need it: the
   * public `fetchPage`, and the level-triggered existence check a creation
   * makes before it sends anything. A match there has to come back *fully
   * read*, because the caller records an external id and a creation that
   * reported one it had not read is the orphan the ledger exists to prevent.
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
   * A page already under this parent with this title, if there is one.
   *
   * The document tool has no idempotency key and no custom field on a page
   * under a page, so the identity of "the page this creation is about" cannot
   * be attached to anything prisme sends. What it *can* be is a question about
   * the world: the operation becomes "ensure a page with this title exists
   * under this parent", which is the same shape every other pass in this
   * application has (ADR-0009).
   *
   * The limitation is real and worth stating: two pages with one title under
   * one parent are indistinguishable to this, so the second is treated as the
   * first. A workspace where that matters is a workspace whose pages a person
   * cannot tell apart either.
   */
  async function findChildPage(
    parentId: string,
    title: string,
    operation: string,
  ): Promise<DocPage | undefined> {
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

      for (const block of response.results) {
        if (block.type !== 'child_page') continue;
        const payload = block['child_page'] as { title?: unknown } | undefined;
        if (payload?.title !== title) continue;
        // A match is fetched in full, because the caller records an external
        // id and a creation that reported one it had not read would be the
        // orphan the ledger exists to prevent.
        return await readPageById(block.id, operation);
      }

      if (!response.has_more) return undefined;
      cursor = guardCursor(seen, response.next_cursor, operation);
      if (cursor === undefined) return undefined;
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
   * The template's top-level blocks, as objects the tool will accept back.
   *
   * Only the fields a creation may carry: a fetched block comes back with an
   * `id`, timestamps and its own children, and sending those back would ask the
   * tool to reproduce an object rather than to create one. `object`, `type` and
   * the type's own payload are what a create accepts.
   *
   * `PAGE_SIZE` caps it, which is also the tool's own limit on a page's initial
   * children — so a template deeper than a hundred top-level blocks is copied
   * as far as the tool would take in one request, and no further.
   */
  async function fetchTemplateChildren(
    templateId: string,
    operation: string,
  ): Promise<readonly unknown[]> {
    const body = await send(
      'GET',
      `/v1/blocks/${encodeURIComponent(templateId)}/children?page_size=${String(PAGE_SIZE)}`,
      operation,
    );
    const response = parseOrThrow(wireBlockListSchema, body, {
      tool: 'doc',
      operation,
      shape: 'block list',
    });

    return response.results.slice(0, PAGE_SIZE).map((block) => {
      const payload = block[block.type];
      return {
        object: 'block',
        type: block.type,
        ...(payload === undefined ? {} : { [block.type]: payload }),
      };
    });
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
      const database = parseOrThrow(
        wireDatabaseSchema,
        await send('GET', `/v1/databases/${encodeURIComponent(id)}`, operation),
        { tool: 'doc', operation, shape: 'database' },
      );
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

  return {
    async describe(externalId: string, shape: StoreShape): Promise<DocStoreDescription> {
      const operation = `describe ${shape}`;
      if (shape === 'data_source') return describeDataSource(externalId, operation);

      // Properties only. A page's blocks are its body, and describing a page
      // store is not a reason to read what anybody wrote under it.
      const body = await send('GET', `/v1/pages/${encodeURIComponent(externalId)}`, operation);
      const page = mapPageContent(
        parseOrThrow(wirePageSchema, body, { tool: 'doc', operation, shape: 'page' }),
        operation,
      );
      return { externalId: page.externalId, title: page.title, linkId: page.externalId };
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
     * ADR-0011's narrative page, created under the page store's bound parent.
     *
     * Three properties, and each is a decision ADR-0025 made:
     *
     *   - **The parent is the bound identifier.** The role key names *where* a
     *     page is created, so the thing it resolves to is the parent. Nothing
     *     here guesses a location, which is the whole reason the vocabulary had
     *     to grow before this method could exist.
     *   - **The body is a structural copy of the template's top-level blocks
     *     and nothing deeper.** The document tool has no template-instantiation
     *     operation, so "from the template" is a copy — and a copy of nested
     *     children is a document-tool feature prisme would be reimplementing.
     *     The page body belongs to the document tool the moment it exists
     *     (docs/11-ownership.md §3), so prisme writes nothing of its own into
     *     it: no backlink block, no marker, nothing.
     *   - **It is level-triggered.** The document tool has no idempotency key,
     *     so a retry after a timeout that had in fact succeeded cannot be
     *     told apart from a first attempt — unless the question asked is "is
     *     there already a page with this title under this parent", which is a
     *     question about the world rather than about the request (ADR-0009).
     *     That is what this does, and it is why the operation is safe to run
     *     twice.
     */
    async createPage(input: CreatePageInput): Promise<DocPage> {
      const operation = 'create page';
      assertCreatable(input.role, operation);
      // Read, so a template role that is write-only is refused for the right
      // reason rather than by a 403 from the tool.
      assertReadable(input.templateRole, operation);

      const parentId = options.bindings.resolve(input.role);
      const templateId = options.bindings.resolve(input.templateRole);

      const existing = await findChildPage(parentId, input.title, operation);
      if (existing !== undefined) return existing;

      const blocks = await fetchTemplateChildren(templateId, operation);

      const body = await send('POST', '/v1/pages', operation, {
        parent: { type: 'page_id', page_id: parentId },
        properties: {
          title: { title: [{ type: 'text', text: { content: input.title } }] },
        },
        ...(blocks.length === 0 ? {} : { children: blocks }),
      });

      const wirePage = parseOrThrow(wirePageSchema, body, {
        tool: 'doc',
        operation,
        shape: 'page',
      });
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
