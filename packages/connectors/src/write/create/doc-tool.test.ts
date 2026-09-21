import { describe, expect, it } from 'vitest';
import { createDocToolClient } from '../../doc-tool/client.js';
import { createFixtureTransport } from '../../testing/fixture-transport.js';
import { createRecordedBindings } from '../../testing/recorded.js';
import { createDocToolCreationWriter } from './doc-tool.js';

/**
 * Creating a page, over a recorded transport (ADR-0025).
 *
 * What the assertions are about is not that a request was sent but **what was
 * in it**, because every rule here is a rule about content:
 *
 *   - the parent is the *bound* identifier for the page store, never a
 *     location prisme chose;
 *   - the body is the template's top-level blocks and nothing else — no
 *     backlink, no marker, nothing prisme wrote (docs/11-ownership.md §3);
 *   - and asked twice about the same title under the same parent, it makes
 *     **one** page, because the document tool has no idempotency key and the
 *     operation is level-triggered instead.
 *
 * No test reaches a network: the transport is a recorded one, as
 * `packages/connectors/CLAUDE.md` requires.
 */

const LIST = (results: readonly unknown[], hasMore = false) =>
  JSON.stringify({ object: 'list', results, next_cursor: null, has_more: hasMore });

/** A `child_page` block, which is what a page under a page is. */
function childPage(id: string, title: string): unknown {
  return {
    object: 'block',
    id,
    type: 'child_page',
    has_children: true,
    child_page: { title },
  };
}

function paragraph(id: string, text: string): unknown {
  return {
    object: 'block',
    id,
    type: 'paragraph',
    has_children: false,
    created_time: '2026-01-01T00:00:00.000Z',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text }, plain_text: text, annotations: {} }],
    },
  };
}

function pageBody(id: string, title: string): string {
  return JSON.stringify({
    object: 'page',
    id,
    created_time: '2026-09-21T09:00:00.000Z',
    last_edited_time: '2026-09-21T09:00:00.000Z',
    archived: false,
    // Shaped as the tool answers: a property carries its own `type`, and the
    // mapping refuses a shape it does not recognise rather than guessing.
    properties: {
      title: {
        id: 'title',
        type: 'title',
        title: [{ type: 'text', text: { content: title }, plain_text: title, annotations: {} }],
      },
    },
  });
}

interface World {
  /** What the parent page already holds, keyed by its bound identifier. */
  readonly children?: Readonly<Record<string, readonly unknown[]>>;
}

function harness(world: World = {}) {
  let created: unknown;

  const transport = createFixtureTransport([
    {
      matches: (request) => request.method === 'POST' && /\/v1\/pages$/.test(request.url),
      respond: (request) => {
        created = JSON.parse(request.body ?? '{}') as unknown;
        const title = (
          created as { properties?: { title?: { title?: { text?: { content?: string } }[] } } }
        ).properties?.title?.title?.[0]?.text?.content;
        return { body: pageBody('made-page-0001', title ?? '') };
      },
    },
    {
      matches: (request) =>
        request.method === 'GET' && /\/v1\/blocks\/.+\/children/.test(request.url),
      respond: (request) => {
        const id = decodeURIComponent(/\/blocks\/([^/]+)\/children/.exec(request.url)?.[1] ?? '');
        // The template is bound to `recorded-project_page_template`; everything
        // else is a page store, and only the parent has children here.
        if (id === 'recorded-project_page_template') {
          return {
            body: LIST([paragraph('tpl-1', 'What is this for?'), paragraph('tpl-2', 'Notes')]),
          };
        }
        return { body: LIST(world.children?.[id] ?? []) };
      },
    },
    {
      matches: (request) => request.method === 'GET' && /\/v1\/pages\/.+\/?$/.test(request.url),
      respond: (request) => {
        const id = decodeURIComponent(/\/v1\/pages\/([^/?]+)/.exec(request.url)?.[1] ?? '');
        return { body: pageBody(id, 'Already there') };
      },
    },
  ]);

  const client = createDocToolClient({
    token: 'recorded-fixture-token',
    bindings: createRecordedBindings(),
    transport: transport.transport,
  });

  return { client, transport, created: () => created };
}

describe('creating a narrative page', () => {
  it('parents the page at the store the role binds, not at a location prisme chose', async () => {
    const { client, created } = harness();

    const page = await client.createPage({
      role: 'project_pages_db',
      templateRole: 'project_page_template',
      title: 'Renovate the workshop',
    });

    expect(page.externalId).toBe('made-page-0001');
    expect((created() as { parent: { page_id: string } }).parent).toEqual({
      type: 'page_id',
      page_id: 'recorded-project_pages_db',
    });
  });

  it('copies the template’s top-level blocks and sends no read-only field back', async () => {
    const { client, created } = harness();

    await client.createPage({
      role: 'project_pages_db',
      templateRole: 'project_page_template',
      title: 'Renovate the workshop',
    });

    const children = (created() as { children: Record<string, unknown>[] }).children;
    expect(children).toHaveLength(2);
    // `id`, `created_time` and `has_children` came back from the template fetch
    // and are absent from what is sent: a creation accepts `object`, `type` and
    // the type's payload, and sending the rest would ask the tool to reproduce
    // an object rather than to create one.
    for (const block of children) {
      expect(Object.keys(block).sort()).toEqual(['object', 'paragraph', 'type']);
    }
    expect(children[0]?.['object']).toBe('block');
    expect(children[0]?.['type']).toBe('paragraph');
  });

  it('writes nothing of prisme’s own into the body', async () => {
    // The page body belongs to the document tool the moment the page exists
    // (docs/11-ownership.md §3). A backlink block would be an ownership leak,
    // and it is the obvious thing to add — so it is asserted rather than
    // assumed.
    const { client, created } = harness();

    await client.createPage({
      role: 'project_pages_db',
      templateRole: 'project_page_template',
      title: 'Renovate the workshop',
    });

    const sent = JSON.stringify(created());
    expect(sent).not.toMatch(/backlink|prisme\.example|http/i);
    // Nothing in the body is prisme's: the title is in `properties`, and the
    // body is the template's blocks verbatim.
    expect(sent).toContain('What is this for?');
  });

  it('is level-triggered: a second call under the same parent finds the page', async () => {
    // The document tool has no idempotency key, so a retry after a timeout
    // cannot be told from a first attempt by anything prisme sends. It can be
    // told by what the world holds, which is what this asks (ADR-0009).
    const { client, transport } = harness({
      children: { 'recorded-project_pages_db': [childPage('existing-1', 'Renovate the workshop')] },
    });

    const page = await client.createPage({
      role: 'project_pages_db',
      templateRole: 'project_page_template',
      title: 'Renovate the workshop',
    });

    expect(page.externalId).toBe('existing-1');
    expect(transport.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  it('creates one when the parent’s children have other titles', async () => {
    const { client, created } = harness({
      children: { 'recorded-project_pages_db': [childPage('other-1', 'Something else')] },
    });

    const page = await client.createPage({
      role: 'project_pages_db',
      templateRole: 'project_page_template',
      title: 'Renovate the workshop',
    });

    expect(page.externalId).toBe('made-page-0001');
    expect(created()).toBeDefined();
  });

  it('refuses to create in a store prisme only reads', async () => {
    // The capability table is a boundary, not a description: a bug that creates
    // under `areas_db` is a bug that writes to an archive.
    const { client, transport } = harness();

    await expect(
      client.createPage({
        role: 'areas_db',
        templateRole: 'project_page_template',
        title: 'Nope',
      }),
    ).rejects.toThrow(/may not add to it/);
    expect(transport.requests).toHaveLength(0);
  });

  it('refuses to read a template that is not readable, rather than letting the tool say so', async () => {
    const { client, transport } = harness();

    await expect(
      client.createPage({
        role: 'project_pages_db',
        templateRole: 'reviews_db',
        title: 'Nope',
      }),
    ).rejects.toThrow(/may not query it/);
    expect(transport.requests).toHaveLength(0);
  });

  it('goes through the creating writer, which is what the freeze replaces', async () => {
    // The port exists so that `createFrozenDocumentCreationWriter` can be the
    // object a frozen deployment is handed; this checks the live one wires the
    // kind to the two role keys rather than passing them through.
    const { client, created } = harness();

    const { externalId } = await createDocToolCreationWriter({ client }).createPage(
      { kind: 'project', title: 'Renovate the workshop' },
      'derived-key',
    );

    expect(externalId).toBe('made-page-0001');
    expect((created() as { parent: { page_id: string } }).parent.page_id).toBe(
      'recorded-project_pages_db',
    );
  });
});
