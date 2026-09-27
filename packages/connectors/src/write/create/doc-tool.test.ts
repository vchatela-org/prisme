import { describe, expect, it } from 'vitest';
import { createDocToolClient } from '../../doc-tool/client.js';
import { isConnectorError } from '../../errors.js';
import { createFixtureTransport } from '../../testing/fixture-transport.js';
import { createRecordedBindings } from '../../testing/recorded.js';
import { createDocToolCreationWriter } from './doc-tool.js';

/**
 * Creating a page, over a recorded transport (ADR-0025, ADR-0030).
 *
 * What the assertions are about is not that a request was sent but **what was
 * in it**, because every rule here is a rule about content:
 *
 *   - the parent is the *bound* data source for the page store, never a
 *     location prisme chose;
 *   - the only property sent is the title, addressed by the title property's
 *     id — found by type, because its name is the workspace's;
 *   - the template is sent as the identifier it was resolved to, never as
 *     `default`, and with no `children` beside it;
 *   - nothing prisme wrote reaches the body — no backlink, no marker;
 *   - and asked twice about the same title in the same database, it makes
 *     **one** page, because the document tool has no idempotency key and the
 *     operation is level-triggered instead.
 *
 * No test reaches a network: the transport is a recorded one, as
 * `packages/connectors/CLAUDE.md` requires. Every identifier is invented.
 */

const STORE = 'recorded-project_pages_db';

/**
 * A data source's schema, shaped as the tool answers. The title property's
 * *name* is deliberately something no code could guess — the client must find
 * it by type and address it by id.
 */
function schema(titleProperties = 1): string {
  const properties: Record<string, unknown> = {
    'Étiquette libre': { id: 'st%3Ax', type: 'status', status: {} },
  };
  for (let index = 0; index < titleProperties; index += 1) {
    properties[`Nom ${String(index)}`] = {
      id: index === 0 ? 'title' : `t${String(index)}`,
      type: 'title',
      title: {},
    };
  }
  return JSON.stringify({ object: 'data_source', id: STORE, properties });
}

function entry(id: string, title: string, archived = false): unknown {
  return {
    object: 'page',
    id,
    created_time: '2026-09-21T09:00:00.000Z',
    last_edited_time: '2026-09-21T09:00:00.000Z',
    in_trash: archived,
    // Shaped as the tool answers: a property carries its own `type`, and the
    // mapping refuses a shape it does not recognise rather than guessing.
    properties: {
      'Nom 0': {
        id: 'title',
        type: 'title',
        title: [{ type: 'text', text: { content: title }, plain_text: title, annotations: {} }],
      },
    },
  };
}

function titleOf(candidate: unknown): string | undefined {
  return (candidate as { properties: { 'Nom 0': { title: { plain_text: string }[] } } }).properties[
    'Nom 0'
  ].title[0]?.plain_text;
}

interface World {
  /** The entries the store's database already holds. */
  readonly entries?: readonly unknown[];
  readonly titleProperties?: number;
}

function harness(world: World = {}) {
  let created: Record<string, unknown> | undefined;

  const transport = createFixtureTransport([
    {
      matches: (request) => request.method === 'POST' && /\/v1\/pages$/.test(request.url),
      respond: (request) => {
        created = JSON.parse(request.body ?? '{}') as Record<string, unknown>;
        const properties = created['properties'] as Record<
          string,
          { title?: { text?: { content?: string } }[] }
        >;
        const title = properties['title']?.title?.[0]?.text?.content;
        return { body: JSON.stringify(entry('made-page-0001', title ?? '')) };
      },
    },
    {
      matches: (request) => request.method === 'POST' && request.url.includes('/query?'),
      respond: (request) => {
        // The tool's filter, simulated: exact title matches only.
        const sent = JSON.parse(request.body ?? '{}') as {
          filter: { title: { equals: string } };
        };
        const results = (world.entries ?? []).filter(
          (candidate) => titleOf(candidate) === sent.filter.title.equals,
        );
        return {
          body: JSON.stringify({ object: 'list', results, next_cursor: null, has_more: false }),
        };
      },
    },
    {
      matches: (request) =>
        request.method === 'GET' && /\/v1\/data_sources\/[^/?]+$/.test(request.url),
      respond: () => ({ body: schema(world.titleProperties) }),
    },
  ]);

  const client = createDocToolClient({
    token: 'recorded-fixture-token',
    bindings: createRecordedBindings(),
    transport: transport.transport,
  });

  return { client, transport, created: () => created };
}

const REQUEST = {
  role: 'project_pages_db',
  title: 'Renovate the workshop',
  templateId: 'tpl-brief',
} as const;

describe('creating a narrative page', () => {
  it('creates an entry of the bound data source, not under a location prisme chose', async () => {
    const { client, created } = harness();

    const page = await client.createPage(REQUEST);

    expect(page.externalId).toBe('made-page-0001');
    expect(created()?.['parent']).toEqual({ type: 'data_source_id', data_source_id: STORE });
  });

  it('sets the title and nothing else, by the title property’s id', async () => {
    const { client, created } = harness();

    await client.createPage(REQUEST);

    // Found by type, addressed by id: the column's name is the workspace's, and
    // it is neither guessed nor sent.
    expect(created()?.['properties']).toEqual({
      title: { title: [{ type: 'text', text: { content: 'Renovate the workshop' } }] },
    });
    expect(JSON.stringify(created())).not.toContain('Nom 0');
  });

  it('sends the resolved template by id, never `default`, and no children', async () => {
    const { client, created } = harness();

    await client.createPage(REQUEST);

    expect(created()?.['template']).toEqual({ type: 'template_id', template_id: 'tpl-brief' });
    expect(created()).not.toHaveProperty('children');
    expect(created()).not.toHaveProperty('content');
  });

  it('writes nothing of prisme’s own and reads no body', async () => {
    // The page body belongs to the document tool the moment the page exists
    // (docs/11-ownership.md §3), and the template fills it asynchronously —
    // which this neither waits for nor reads (ADR-0030 rule 4).
    const { client, transport, created } = harness();

    const page = await client.createPage(REQUEST);

    expect(JSON.stringify(created())).not.toMatch(/backlink|prisme\.example|http/i);
    expect(page.blocks).toEqual([]);
    expect(transport.requests.some((request) => request.url.includes('/blocks/'))).toBe(false);
  });

  it('is level-triggered: a live entry with the title is returned rather than made again', async () => {
    // The document tool has no idempotency key, so a retry after a timeout
    // cannot be told from a first attempt by anything prisme sends. It can be
    // told by what the database holds, which is what this asks (ADR-0030 rule 6).
    const { client, transport } = harness({
      entries: [entry('existing-1', 'Renovate the workshop')],
    });

    const page = await client.createPage(REQUEST);

    expect(page.externalId).toBe('existing-1');
    expect(transport.requests.some((request) => request.url.endsWith('/v1/pages'))).toBe(false);
  });

  it('asks the database for exact title matches and for the title property only', async () => {
    const { client, transport } = harness();

    await client.createPage(REQUEST);

    const query = transport.requests.find((request) => request.url.includes('/query'));
    expect(new URL(query?.url ?? 'http://x').searchParams.getAll('filter_properties[]')).toEqual([
      'title',
    ]);
    expect(JSON.parse(query?.body ?? '{}')).toMatchObject({
      filter: { property: 'title', title: { equals: 'Renovate the workshop' } },
    });
  });

  it('creates one when the only entry with the title is in the trash', async () => {
    // A page somebody deleted is created again rather than resurrected.
    const { client, created } = harness({
      entries: [entry('trashed-1', 'Renovate the workshop', true)],
    });

    const page = await client.createPage(REQUEST);

    expect(page.externalId).toBe('made-page-0001');
    expect(created()).toBeDefined();
  });

  it('creates one when the database’s entries have other titles', async () => {
    const { client, created } = harness({ entries: [entry('other-1', 'Something else')] });

    const page = await client.createPage(REQUEST);

    expect(page.externalId).toBe('made-page-0001');
    expect(created()).toBeDefined();
  });

  it('refuses a schema without exactly one title property rather than picking one', async () => {
    const { client, transport } = harness({ titleProperties: 2 });

    const failure = await client.createPage(REQUEST).catch((error: unknown) => error);

    expect(isConnectorError(failure) && failure.failure).toBe('invalid_shape');
    expect(transport.requests.some((request) => request.method === 'POST')).toBe(false);
  });

  it('refuses to create in a store prisme only reads', async () => {
    // The capability table is a boundary, not a description: a bug that creates
    // under `areas_db` is a bug that writes to an archive.
    const { client, transport } = harness();

    await expect(client.createPage({ ...REQUEST, role: 'areas_db' })).rejects.toThrow(
      /may not add to it/,
    );
    expect(transport.requests).toHaveLength(0);
  });

  it('goes through the creating writer, which is what the freeze replaces', async () => {
    // The port exists so that `createFrozenDocumentCreationWriter` can be the
    // object a frozen deployment is handed; this checks the live one wires the
    // kind to its role key and carries the resolved template through.
    const { client, created } = harness();

    const { externalId } = await createDocToolCreationWriter({ client }).createPage(
      { kind: 'project', title: 'Renovate the workshop', templateId: 'tpl-brief' },
      'derived-key',
    );

    expect(externalId).toBe('made-page-0001');
    expect(created()?.['parent']).toEqual({ type: 'data_source_id', data_source_id: STORE });
    expect(created()?.['template']).toEqual({ type: 'template_id', template_id: 'tpl-brief' });
  });
});
