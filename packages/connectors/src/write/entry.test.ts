import type { CalendarDate } from '@prisme/domain';
import { describe, expect, it } from 'vitest';
import { createDocToolClient } from '../doc-tool/client.js';
import { isConnectorError } from '../errors.js';
import type { HttpRequest } from '../http/transport.js';
import { createFixtureTransport } from '../testing/fixture-transport.js';
import { createRecordedBindings } from '../testing/recorded.js';
import { auditDocumentEntryWriter, type WriteAttempt } from './audit.js';
import { createDocToolEntryWriter, createFrozenDocumentEntryWriter } from './entry.js';

/**
 * Setting an objectives-store entry's date column, over a recorded transport
 * (ADR-0034).
 *
 * The rules are about **what is sent and to whom**, so the assertions read the
 * requests: the entry is read before it is written, a page that is not the
 * store's, a trashed one and one without a date column are refused with
 * nothing sent, and the one request sent carries the two dates and no other
 * property, addressed by the property's id. No test reaches a network, and
 * every identifier is invented.
 */

const STORE = 'recorded-objectives_db';
const PAGE = 'objective-page-0001';
/** A column name no code could guess, as a workspace's would be. */
const COLUMN = 'Échéance du cycle';

interface World {
  readonly parent?: Record<string, unknown>;
  readonly trashed?: boolean;
  readonly columnType?: string;
  readonly columnAbsent?: boolean;
  readonly patchStatus?: number;
}

function page(world: World): unknown {
  return {
    object: 'page',
    id: PAGE,
    created_time: '2026-09-21T09:00:00.000Z',
    last_edited_time: '2026-09-21T09:00:00.000Z',
    in_trash: world.trashed ?? false,
    parent: world.parent ?? {
      type: 'data_source_id',
      data_source_id: STORE,
      database_id: 'database-0001',
    },
    properties: {
      Nom: {
        id: 'title',
        type: 'title',
        title: [
          { type: 'text', text: { content: 'A plan' }, plain_text: 'A plan', annotations: {} },
        ],
      },
      ...(world.columnAbsent === true
        ? {}
        : {
            [COLUMN]:
              (world.columnType ?? 'date') === 'date'
                ? {
                    id: 'd%3Aq',
                    type: 'date',
                    date: { start: '2028-01-01', end: '2028-12-31' },
                  }
                : { id: 'd%3Aq', type: world.columnType, rich_text: [] },
          }),
    },
  };
}

function harness(world: World = {}) {
  const transport = createFixtureTransport([
    {
      matches: (request) => request.method === 'GET' && request.url.endsWith(`/v1/pages/${PAGE}`),
      respond: () => ({ body: JSON.stringify(page(world)) }),
    },
    {
      matches: (request) => request.method === 'PATCH' && request.url.endsWith(`/v1/pages/${PAGE}`),
      respond: () =>
        world.patchStatus === undefined
          ? { body: JSON.stringify(page(world)) }
          : { status: world.patchStatus, body: JSON.stringify({ object: 'error' }) },
    },
  ]);
  const client = createDocToolClient({
    token: 'recorded-fixture-token',
    bindings: createRecordedBindings(),
    transport: transport.transport,
  });
  return { client, requests: transport.requests };
}

const DATES = {
  startsOn: '2027-01-01' as CalendarDate,
  endsOn: '2027-12-31' as CalendarDate,
};

const WRITE = { pageId: PAGE, property: COLUMN, ...DATES };

function patches(requests: readonly HttpRequest[]): readonly HttpRequest[] {
  return requests.filter((request) => request.method === 'PATCH');
}

async function failureOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return isConnectorError(error) ? error.failure : 'not a connector error';
  }
  return undefined;
}

describe('setting an objective page’s dates', () => {
  it('reads the entry first, then sends the two dates and nothing else', async () => {
    const { client, requests } = harness();

    await createDocToolEntryWriter({ client }).setObjectivePageDates(WRITE, 'key-0001');

    expect(requests.map((request) => request.method)).toEqual(['GET', 'PATCH']);
    expect(JSON.parse(patches(requests)[0]?.body ?? '{}')).toEqual({
      properties: { 'd%3Aq': { date: { start: '2027-01-01', end: '2027-12-31' } } },
    });
  });

  it('addresses the column by its id, and never sends its name', async () => {
    const { client, requests } = harness();

    await createDocToolEntryWriter({ client }).setObjectivePageDates(WRITE, 'key-0001');

    expect(patches(requests)[0]?.body).not.toContain(COLUMN);
  });

  it('refuses a page that is not an entry of the objectives store, and sends nothing', async () => {
    for (const parent of [
      { type: 'data_source_id', data_source_id: 'recorded-takeaways_db' },
      { type: 'page_id', page_id: 'another-page-0001' },
      { type: 'workspace', workspace: true },
    ]) {
      const { client, requests } = harness({ parent });

      const failure = await failureOf(
        createDocToolEntryWriter({ client }).setObjectivePageDates(WRITE, 'key-0001'),
      );

      expect(failure).toBe('refused');
      expect(patches(requests)).toHaveLength(0);
    }
  });

  it('compares the parent the way the tool writes one identifier two ways', async () => {
    // Bound bare, answered dashed: the same data source, so the edit goes ahead.
    // Built at run time: the privacy deny-list refuses an identifier-shaped
    // literal in the tree, invented or not.
    const bare = 'c'.repeat(32);
    const dashed = [8, 4, 4, 4, 12].map((length) => 'c'.repeat(length)).join('-');
    const transport = createFixtureTransport([
      {
        matches: (request) => request.method === 'GET',
        respond: () => ({
          body: JSON.stringify(
            page({ parent: { type: 'data_source_id', data_source_id: dashed } }),
          ),
        }),
      },
      {
        matches: (request) => request.method === 'PATCH',
        respond: () => ({ body: JSON.stringify(page({})) }),
      },
    ]);
    const client = createDocToolClient({
      token: 'recorded-fixture-token',
      bindings: {
        resolve: () => bare,
        has: () => true,
        bound: () => ['objectives_db'],
      },
      transport: transport.transport,
    });

    await client.setEntryDate({
      role: 'objectives_db',
      pageId: PAGE,
      property: COLUMN,
      start: DATES.startsOn,
      end: DATES.endsOn,
    });

    expect(patches(transport.requests)).toHaveLength(1);
  });

  it('does not edit an entry back out of the trash', async () => {
    const { client, requests } = harness({ trashed: true });

    expect(
      await failureOf(createDocToolEntryWriter({ client }).setObjectivePageDates(WRITE, 'k')),
    ).toBe('refused');
    expect(patches(requests)).toHaveLength(0);
  });

  it('refuses a column that is gone or no longer a date, rather than writing whatever it is now', async () => {
    for (const world of [{ columnAbsent: true }, { columnType: 'rich_text' }]) {
      const { client, requests } = harness(world);

      expect(
        await failureOf(createDocToolEntryWriter({ client }).setObjectivePageDates(WRITE, 'k')),
      ).toBe('refused');
      expect(patches(requests)).toHaveLength(0);
    }
  });

  it('keeps the column’s name out of every refusal', async () => {
    const { client } = harness({ columnAbsent: true });
    try {
      await createDocToolEntryWriter({ client }).setObjectivePageDates(WRITE, 'k');
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(COLUMN);
      expect(String(error)).not.toContain(STORE);
    }
  });

  it('edits only in a store that carries the edit capability', async () => {
    const { client, requests } = harness();

    for (const role of ['takeaways_db', 'reviews_db', 'initiative_pages_db'] as const) {
      expect(
        await failureOf(
          client.setEntryDate({
            role,
            pageId: PAGE,
            property: COLUMN,
            start: DATES.startsOn,
            end: DATES.endsOn,
          }),
        ),
      ).toBe('role_not_editable');
    }
    expect(requests).toHaveLength(0);
  });

  it('reports a refused update as the failure it is', async () => {
    const { client } = harness({ patchStatus: 400 });

    expect(
      await failureOf(createDocToolEntryWriter({ client }).setObjectivePageDates(WRITE, 'k')),
    ).toBe('refused');
  });
});

describe('the frozen editing writer', () => {
  it('refuses without reaching anything', async () => {
    expect(
      await failureOf(createFrozenDocumentEntryWriter().setObjectivePageDates(WRITE, 'k')),
    ).toBe('refused');
  });
});

describe('the audited editing writer', () => {
  it('records the page and the dates, and not the column’s name', async () => {
    const { client } = harness();
    const attempts: WriteAttempt[] = [];
    const writer = auditDocumentEntryWriter(createDocToolEntryWriter({ client }), {
      sink: {
        record: (attempt) => {
          attempts.push(attempt);
          return Promise.resolve();
        },
      },
      now: () => new Date('2026-09-28T10:00:00.000Z'),
      onRecordError: () => undefined,
    });

    await writer.setObjectivePageDates(WRITE, 'key-0001');

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      tool: 'document',
      operation: 'update_page',
      externalId: PAGE,
      request: { startsOn: '2027-01-01', endsOn: '2027-12-31' },
      outcome: 'succeeded',
    });
    expect(JSON.stringify(attempts[0]?.request)).not.toContain(COLUMN);
  });

  it('records a refusal as faithfully as a success', async () => {
    const attempts: WriteAttempt[] = [];
    const writer = auditDocumentEntryWriter(createFrozenDocumentEntryWriter(), {
      sink: {
        record: (attempt) => {
          attempts.push(attempt);
          return Promise.resolve();
        },
      },
      now: () => new Date('2026-09-28T10:00:00.000Z'),
      onRecordError: () => undefined,
    });

    await expect(writer.setObjectivePageDates(WRITE, 'key-0001')).rejects.toThrow();

    expect(attempts[0]).toMatchObject({ outcome: 'failed', failure: 'refused', externalId: PAGE });
  });
});
