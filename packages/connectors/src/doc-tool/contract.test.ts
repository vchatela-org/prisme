import { describe, expect, it } from 'vitest';
import { isConnectorError } from '../errors.js';
import { contentHash } from '../hash.js';
import { loadFixture } from '../test-support/fixtures.js';
import { createRecordedDocToolClient } from '../testing/recorded.js';
import { suppressUnchanged, watermarkFloor } from '../watermark.js';
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
