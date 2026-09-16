import { ConnectorError } from '../errors.js';
import type { RetryPolicy } from '../http/backoff.js';
import { trimTrailing } from '../util/trim.js';
import { executeJson, type RequestOptions } from '../http/request.js';
import { createRefusingTransport, type Transport } from '../http/transport.js';
import { contentHash } from '../hash.js';
import type { ConnectorMetrics } from '../metrics.js';
import { parseOrThrow } from '../parse.js';
import { assertReadable, type RoleBindings, type RoleKey } from '../role-key.js';
import { mapBlock, mapPage, mapPageContent } from './map.js';
import type { DocBlock, DocPage, DocRecord, DocToolClient } from './types.js';
import { wireBlockListSchema, wirePageSchema, wireQueryResponseSchema } from './wire.js';

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

/** Pinned: the tool dates its breaking changes, and an unpinned version is a silent upgrade. */
export const DEFAULT_DOC_TOOL_API_VERSION = '2022-06-28';

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

  return {
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

    async fetchPage(id: string): Promise<DocPage> {
      const operation = 'fetch page';
      const body = await send('GET', `/v1/pages/${encodeURIComponent(id)}`, operation);
      const wirePage = parseOrThrow(wirePageSchema, body, {
        tool: 'doc',
        operation,
        shape: 'page',
      });

      // No role: a page fetched by ID did not arrive through a role-keyed
      // query, and stamping one on it would be an invention.
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
    },
  };
}
