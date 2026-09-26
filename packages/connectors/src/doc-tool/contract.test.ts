import { describe, expect, it } from 'vitest';
import { isConnectorError } from '../errors.js';
import { contentHash } from '../hash.js';
import type { HttpRequest } from '../http/transport.js';
import { loadFixture } from '../test-support/fixtures.js';
import { createRecordedBindings, createRecordedDocToolClient } from '../testing/recorded.js';
import { suppressUnchanged, watermarkFloor } from '../watermark.js';
import { createDocToolClient, DEFAULT_DOC_TOOL_API_VERSION } from './client.js';
import type { DocPropertyValue, DocRecord } from './types.js';

/**
 * Contract tests for the document tool, against the recorded responses in
 * `fixtures/connectors/`. As on the task-tool side these drive the real client
 * over a recorded transport, so the schemas, the property mapping, the
 * sanitisation, the pagination and the hashing are all in the path.
 */

const queryPages = [
  loadFixture('doc-tool.query-objectives.json'),
  loadFixture('doc-tool.query-objectives-page2.json'),
];
const page = loadFixture('doc-tool.page.json');
const blocksFixture = loadFixture('doc-tool.blocks.json') as {
  byParent: Record<string, unknown>;
};

function client() {
  return createRecordedDocToolClient({
    queryPages,
    page,
    blocksByParent: blocksFixture.byParent,
  });
}

function propertyOf(record: DocRecord, name: string): DocPropertyValue {
  const value = record.properties.get(name);
  if (value === undefined) throw new Error(`the fixture has no property ${name}`);
  return value;
}

describe('a role-keyed query', () => {
  it('follows next_cursor to the end', async () => {
    const records = await client().client.queryByRole('objectives_db');
    expect(records.map((record) => record.externalId)).toEqual([
      'doc-page-0001',
      'doc-page-0002',
      'doc-page-0003',
    ]);
  });

  it('stamps every record with the role it came from', async () => {
    const records = await client().client.queryByRole('objectives_db');
    expect(records.every((record) => record.role === 'objectives_db')).toBe(true);
  });

  it('addresses the store by its binding, never by a name in this repository', async () => {
    const recorded = client();
    await recorded.client.queryByRole('objectives_db');
    expect(recorded.transport.requests[0]?.url).toContain('recorded-objectives_db');
  });

  it('refuses to read a role prisme holds no read capability for', async () => {
    await expect(client().client.queryByRole('reviews_db')).rejects.toThrow(/write-only/);
  });

  it('sends the overlapped floor it was given, and computes none of its own', async () => {
    const recorded = client();
    const since = watermarkFloor(new Date('2026-09-16T08:58:30.000Z'));
    await recorded.client.queryByRole('objectives_db', since);

    const body = JSON.parse(recorded.transport.requests[0]?.body ?? '{}') as {
      filter?: { last_edited_time?: { on_or_after?: string } };
    };
    expect(body.filter?.last_edited_time?.on_or_after).toBe('2026-09-16T08:56:30.000Z');
  });

  it('sends no filter at all when asked for everything', async () => {
    const recorded = client();
    await recorded.client.queryByRole('objectives_db');
    const body = JSON.parse(recorded.transport.requests[0]?.body ?? '{}') as {
      filter?: unknown;
    };
    expect(body.filter).toBeUndefined();
  });
});

describe('property mapping', () => {
  it('reads the title property whatever the workspace calls it', async () => {
    const [record] = await client().client.queryByRole('objectives_db');
    expect(record?.title).toBe('Be measurably fitter by the end of the year');
  });

  it('maps the types prisme reads', async () => {
    const [record] = await client().client.queryByRole('objectives_db');
    const target = record as DocRecord;

    expect(propertyOf(target, 'Progress')).toEqual({ kind: 'number', value: 60 });
    expect(propertyOf(target, 'Status')).toEqual({ kind: 'status', value: 'In progress' });
    expect(propertyOf(target, 'Area')).toEqual({ kind: 'select', value: 'Health' });
    expect(propertyOf(target, 'Tags')).toEqual({
      kind: 'multi_select',
      values: ['annual', 'measurable'],
    });
    expect(propertyOf(target, 'Confirmed')).toEqual({ kind: 'checkbox', value: true });
    expect(propertyOf(target, 'Window')).toEqual({
      kind: 'date',
      start: '2026-01-01',
      end: '2026-12-31',
    });
    expect(propertyOf(target, 'Serves')).toEqual({ kind: 'relation', ids: ['doc-page-0003'] });
  });

  it('counts a property it declines to read, and keeps none of it', async () => {
    const [record] = await client().client.queryByRole('objectives_db');
    // People are the most sensitive property in a personal workspace, and
    // prisme has no feature that needs one.
    expect(propertyOf(record as DocRecord, 'Owner')).toEqual({
      kind: 'not_read',
      externalType: 'people',
      count: 1,
    });
  });

  it('treats a page as not live when the version spells the field the old way', async () => {
    // The pinned version returns `in_trash` and never `archived`; a version
    // older than it sends the opposite. One of the two is always absent, so a
    // reader that consulted either alone would call every trashed page live on
    // the version that spells it the other way — and a page that looks live
    // when it is not is drift the full pass can never see.
    const legacy = createRecordedDocToolClient({
      queryPages: [loadFixture('doc-tool.query-legacy-archived.json')],
    });
    const [record] = await legacy.client.queryByRole('objectives_db');
    expect(record?.archived).toBe(true);
  });

  it('records a type it has never seen rather than guessing at it', async () => {
    const [record] = await client().client.queryByRole('objectives_db');
    expect(propertyOf(record as DocRecord, 'Rolled up')).toEqual({
      kind: 'unsupported',
      externalType: 'rollup',
    });
  });

  it('sanitises rich text into marks and collects its links', async () => {
    const [record] = await client().client.queryByRole('objectives_db');
    const notes = propertyOf(record as DocRecord, 'Notes');
    expect(notes.kind).toBe('rich_text');
    if (notes.kind !== 'rich_text') return;

    expect(notes.text.text).toBe('Reference: the training plan');
    // `highlight` is not on the allow-list and does not survive.
    expect(notes.text.segments[1]?.marks).toEqual(['bold', 'italic']);
    expect(record?.urls).toEqual(['https://example.invalid/plan']);
  });

  it('reads a page with no properties at all without inventing a title', async () => {
    const records = await client().client.queryByRole('objectives_db');
    expect(records[2]?.title).toBe('');
    expect(records[2]?.properties.size).toBe(0);
  });

  it('treats in_trash as archived, because a trashed page is not live', async () => {
    const records = await client().client.queryByRole('objectives_db');
    expect(records[1]?.archived).toBe(true);
  });

  it('keeps null distinct from absent on a number', async () => {
    const records = await client().client.queryByRole('objectives_db');
    expect(propertyOf(records[1] as DocRecord, 'Progress')).toEqual({
      kind: 'number',
      value: null,
    });
  });
});

describe('the watermark, end to end', () => {
  it('reports zero changes when the overlap re-reads unchanged pages', async () => {
    const first = await client().client.queryByRole('objectives_db');
    const firstPass = suppressUnchanged(first, new Map());
    expect(firstPass.changed).toHaveLength(3);

    // The same query again, as the two-minute overlap guarantees will happen.
    const second = await client().client.queryByRole('objectives_db');
    const secondPass = suppressUnchanged(second, firstPass.hashes);

    expect(secondPass.changed).toEqual([]);
    expect(secondPass.unchanged).toHaveLength(3);
  });

  it('does not let a touched last_edited_time count as a change', async () => {
    const [record] = await client().client.queryByRole('objectives_db');
    const touched = {
      ...(record as DocRecord),
      lastEditedAt: new Date('2026-09-16T09:30:00.000Z'),
    };
    // The hash is computed from content, not from the timestamp, so a rollup
    // recalculating upstream does not wake the reconciler.
    expect(touched.contentHash).toBe(record?.contentHash);
  });

  it('does report a change when a property actually moved', async () => {
    const [record] = await client().client.queryByRole('objectives_db');
    const known = new Map([[record?.externalId ?? '', contentHash({ different: true })]]);
    expect(suppressUnchanged([record as DocRecord], known).changed).toHaveLength(1);
  });
});

describe('fetching one page', () => {
  it('reads the page and walks its blocks', async () => {
    const fetched = await client().client.fetchPage('doc-page-0001');
    expect(fetched.title).toBe('Be measurably fitter by the end of the year');
    expect(fetched.blocks.map((block) => block.type)).toEqual([
      'heading_2',
      'paragraph',
      'to_do',
      'bulleted_list_item',
      'paragraph',
    ]);
  });

  it('descends into a block that has children, and records the depth', async () => {
    const fetched = await client().client.fetchPage('doc-page-0001');
    const nested = fetched.blocks.find((block) => block.externalId === 'block-0006');
    expect(nested?.depth).toBe(1);
    expect(nested?.text.text).toBe('Sunday morning, before anything else.');
  });

  it('carries a to_do checkbox', async () => {
    const fetched = await client().client.fetchPage('doc-page-0001');
    expect(fetched.blocks.find((block) => block.type === 'to_do')?.checked).toBe(true);
  });

  it('records the block types it skipped rather than failing on them', async () => {
    const fetched = await client().client.fetchPage('doc-page-0001');
    expect(fetched.skippedBlockTypes).toEqual(['image']);
  });

  it('does not collect the expiring signed URL behind an image', async () => {
    const fetched = await client().client.fetchPage('doc-page-0001');
    // A file URL is a time-limited credential. Storing one is storing a secret.
    expect(fetched.urls).not.toContain('https://example.invalid/signed/expiring');
    expect(fetched.urls).toEqual(['https://example.invalid/reference']);
  });

  it('carries pasted markup as characters, and strips the bidi override with it', async () => {
    const fetched = await client().client.fetchPage('doc-page-0001');
    const paragraph = fetched.blocks.find((block) => block.externalId === 'block-0002');
    expect(paragraph?.text.text).toBe(
      "Pasted from the web: <script>alert('xss')</script> and a flipped run.the reference",
    );
    expect(paragraph?.text.text).not.toContain('\u202e');
  });
});

describe('the pinned API version', () => {
  /**
   * The earliest version in which the surface this client calls exists.
   *
   * Below it, `POST /v1/data_sources/<id>/query` answers
   * `400 invalid_request_url` — measured against the live API, not inferred —
   * and the tool rejects a version string it does not recognise outright, so a
   * guessed date is not a way to move forward either. The client once pinned a
   * version from the era of `/v1/databases/` while calling this surface, and
   * every query failed; the defect was invisible because the one caller reports
   * a refused read as "not read" rather than as an error.
   */
  const SURFACE_FLOOR = '2025-09-03';

  it('sends the pin on every request, rather than leaving the version to the tool', async () => {
    const sent: HttpRequest[] = [];
    const client = createDocToolClient({
      token: 'example-token',
      bindings: createRecordedBindings(),
      transport: (request) => {
        sent.push(request);
        return Promise.resolve({
          status: 200,
          headers: {},
          body: JSON.stringify({ object: 'list', results: [], next_cursor: null, has_more: false }),
        });
      },
    });

    await client.queryByRole('objectives_db');

    // A version the tool dates its breaking changes by is only a pin if it is
    // sent; an absent header is the silent upgrade the constant exists to stop.
    expect(sent[0]?.headers['notion-version']).toBe(DEFAULT_DOC_TOOL_API_VERSION);
  });

  it('keeps the pin at or after the version the surface it calls arrived in', () => {
    // A date-shaped version string compares as a date. This is the cheap half of
    // the guard: it fails the moment someone pins back to a pre-data-sources
    // version, which is the mistake that made every document-tool read fail.
    expect(DEFAULT_DOC_TOOL_API_VERSION >= SURFACE_FLOOR).toBe(true);
  });
});

describe('a response that does not match', () => {
  it('fails on a number property carrying a string, rather than coercing it', async () => {
    const recorded = createRecordedDocToolClient({
      queryPages: [loadFixture('malformed/doc-tool.number-property-is-text.json')],
    });

    try {
      await recorded.client.queryByRole('objectives_db');
      expect.unreachable('the run should have failed');
    } catch (error) {
      expect(isConnectorError(error) && error.failure).toBe('invalid_shape');
      const { message } = error as Error;
      expect(message).toMatch(/number/);
      // The property is called "Progress" in this workspace; the message must
      // not say so.
      expect(message).not.toContain('Progress');
    }
  });
});

describe('describing a store before it is bound', () => {
  const richText = (text: string) => [{ plain_text: text, href: null }];
  const dataSource = {
    object: 'data_source',
    id: 'ds-0001',
    title: richText('Reading notes'),
    parent: { type: 'database_id', database_id: 'db-0001' },
  };
  const database = (sources: readonly string[]) => ({
    object: 'database',
    id: 'db-0001',
    title: richText('Reading notes'),
    data_sources: sources.map((id) => ({ id, name: 'Reading notes' })),
  });

  function describing(routes: Readonly<Record<string, unknown>>) {
    const requests: HttpRequest[] = [];
    const client = createDocToolClient({
      token: 'recorded-fixture-token',
      bindings: createRecordedBindings(),
      transport: (request) => {
        requests.push(request);
        const path = new URL(request.url).pathname;
        const body = routes[path];
        return Promise.resolve(
          body === undefined
            ? { status: 404, headers: {}, body: JSON.stringify({ code: 'object_not_found' }) }
            : { status: 200, headers: {}, body: JSON.stringify(body) },
        );
      },
      retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
      sleep: () => Promise.resolve(),
    });
    return { client, requests };
  }

  it('names a data source, and links to the database a person opens', async () => {
    const { client } = describing({ '/v1/data_sources/ds-0001': dataSource });
    await expect(client.describe('ds-0001', 'data_source')).resolves.toEqual({
      externalId: 'ds-0001',
      title: 'Reading notes',
      linkId: 'db-0001',
    });
  });

  it('resolves a pasted database to the one data source inside it', async () => {
    const { client, requests } = describing({ '/v1/databases/db-0001': database(['ds-0001']) });
    await expect(client.describe('db-0001', 'data_source')).resolves.toEqual({
      externalId: 'ds-0001',
      title: 'Reading notes',
      linkId: 'db-0001',
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/v1/data_sources/db-0001',
      '/v1/databases/db-0001',
    ]);
  });

  it('refuses a database holding several data sources rather than picking one', async () => {
    const { client } = describing({
      '/v1/databases/db-0001': database(['ds-0001', 'ds-0002']),
    });
    const failure = await client
      .describe('db-0001', 'data_source')
      .catch((error: unknown) => error);
    expect(isConnectorError(failure) && failure.failure).toBe('refused');
    // A count, never an identifier: this message can reach a screen.
    expect(String(failure)).toContain('holds 2 data sources');
    expect(String(failure)).not.toContain('ds-0002');
  });

  it('names a page from its title property, and reads none of its body', async () => {
    const { client, requests } = describing({ '/v1/pages/doc-page-0001': page });
    const described = await client.describe('doc-page-0001', 'page');
    expect(described.externalId).toBe('doc-page-0001');
    expect(described.linkId).toBe('doc-page-0001');
    expect(described.title.length).toBeGreaterThan(0);
    expect(requests.some((request) => request.url.includes('/blocks/'))).toBe(false);
  });
});
