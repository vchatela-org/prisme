import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WRITE_AUDIT_RETENTION } from '@prisme/domain';
import {
  describeWithDatabase,
  openTestDatabase,
  type TestDatabase,
} from '../test-support/database.js';
import { createTestApp, identityWith } from '../test-support/app.js';
import { seedFixtures } from '../test-support/seed.js';
import { API_BASE_PATH } from './index.js';

/**
 * The audit of outward writes, as the screens read it (ADR-0031).
 *
 * The rows are inserted here the way the writers insert them, because the API
 * never writes one — which is itself one of the things tested: there is no
 * route that could. Every identifier and title is invented.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

interface WriteBody {
  id: string;
  occurredAt: string;
  tool: string;
  operation: string;
  origin: string;
  entityId: string | null;
  entityTitle: string | null;
  externalId: string | null;
  request: Record<string, unknown>;
  outcome: string;
  failure: string | null;
}

interface PageBody {
  items: WriteBody[];
  total: number;
}

interface RetentionBody {
  retentionDays: number;
  chosen: boolean;
  defaultDays: number;
  minDays: number;
  maxDays: number;
  updatedAt: string | null;
  records: number;
  oldestAt: string | null;
}

describeOrSkip('the write audit routes against PostgreSQL', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await openTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  const url = (path: string): string => `${API_BASE_PATH}${path}`;

  async function record(row: {
    occurredAt: string;
    tool: 'task' | 'document';
    operation: string;
    origin: 'reconciler' | 'creation';
    request: Record<string, unknown>;
    externalId?: string;
    entityId?: string;
    failed?: boolean;
  }): Promise<void> {
    await database.client`
      insert into external_write
        (occurred_at, tool, operation, origin, run_id, entity_kind, entity_id, external_id,
         request, idempotency_key, outcome, failure, error, duration_ms)
      values (${row.occurredAt}::timestamptz, ${row.tool}, ${row.operation}, ${row.origin},
              'run-1', ${row.entityId === undefined ? null : 'initiative'}, ${row.entityId ?? null},
              ${row.externalId ?? null}, ${JSON.stringify(row.request)}::jsonb, 'k',
              ${row.failed === true ? 'failed' : 'succeeded'},
              ${row.failed === true ? 'rate_limited' : null},
              ${row.failed === true ? 'task tool: update task: rate limited' : null}, 12)`;
  }

  beforeEach(async () => {
    await database.truncate();
    await record({
      occurredAt: '2026-03-01T08:00:00.000Z',
      tool: 'task',
      operation: 'create_anchor',
      origin: 'reconciler',
      request: { content: 'Replace the fence', projectId: 'p-1' },
      externalId: 'task-0001',
      entityId: 'init-0001',
    });
    await record({
      occurredAt: '2026-03-02T08:00:00.000Z',
      tool: 'task',
      operation: 'update_task',
      origin: 'reconciler',
      request: { priority: 'highest' },
      externalId: 'task-0001',
      entityId: 'init-0001',
      failed: true,
    });
    await record({
      occurredAt: '2026-03-03T08:00:00.000Z',
      tool: 'document',
      operation: 'create_page',
      origin: 'creation',
      request: { kind: 'initiative', title: 'Garden plan', templateId: 'tpl-1' },
      externalId: 'page-0001',
    });
  });

  it('lists every call, most recent first', async () => {
    const response = await createTestApp({ client: database.client }).request(
      'GET',
      url('/audit/writes'),
    );

    expect(response.status).toBe(200);
    const body = response.body as PageBody;
    expect(body.total).toBe(3);
    expect(body.items.map((item) => item.operation)).toEqual([
      'create_page',
      'update_task',
      'create_anchor',
    ]);
    expect(body.items[2]?.request).toEqual({ content: 'Replace the fence', projectId: 'p-1' });
  });

  it.each([
    ['tool=document', ['create_page']],
    ['operation=create_anchor,update_task', ['update_task', 'create_anchor']],
    ['outcome=failed', ['update_task']],
    ['origin=creation', ['create_page']],
    ['entityId=init-0001', ['update_task', 'create_anchor']],
    ['search=FENCE', ['create_anchor']],
    ['search=page-0001', ['create_page']],
    [
      'from=2026-03-02T00:00:00.000Z&to=2026-03-03T08:00:00.000Z',
      ['update_task'], // `to` is exclusive
    ],
  ])('narrows by %s', async (query, expected) => {
    const response = await createTestApp({ client: database.client }).request(
      'GET',
      url(`/audit/writes?${query}`),
    );
    expect(response.status).toBe(200);
    expect((response.body as PageBody).items.map((item) => item.operation)).toEqual(expected);
  });

  it('names the entity by its title now, and finds a call by it', async () => {
    await seedFixtures(database.client);
    const [initiative] = await database.client<{ id: string; title: string }[]>`
      select id::text, title from initiative order by title limit 1`;
    if (initiative === undefined) throw new Error('the fixture set has no initiative');
    await record({
      occurredAt: '2026-03-04T08:00:00.000Z',
      tool: 'task',
      operation: 'move_task',
      origin: 'reconciler',
      request: { projectId: 'p-2' },
      externalId: 'task-0009',
      entityId: initiative.id,
    });

    const app = createTestApp({ client: database.client });
    const all = await app.request('GET', url('/audit/writes?operation=move_task'));
    expect((all.body as PageBody).items[0]?.entityTitle).toBe(initiative.title);

    // A move sends no title; the search still finds it by what it was for.
    const found = await app.request(
      'GET',
      url(`/audit/writes?search=${encodeURIComponent(initiative.title.toUpperCase())}`),
    );
    expect((found.body as PageBody).items.map((item) => item.operation)).toEqual(['move_task']);

    // An entity id that names nothing any more reads as no title, not an error.
    const gone = await app.request('GET', url('/audit/writes?entityId=init-0001'));
    expect((gone.body as PageBody).items.every((item) => item.entityTitle === null)).toBe(true);
  });

  it('refuses an operation it does not know', async () => {
    const response = await createTestApp({ client: database.client }).request(
      'GET',
      url('/audit/writes?operation=delete_task'),
    );
    expect(response.status).toBe(400);
  });

  it('pages', async () => {
    const response = await createTestApp({ client: database.client }).request(
      'GET',
      url('/audit/writes?limit=1&offset=1'),
    );
    const body = response.body as PageBody;
    expect(body.total).toBe(3);
    expect(body.items.map((item) => item.operation)).toEqual(['update_task']);
  });

  it('is refused without read:sync', async () => {
    const response = await createTestApp({
      client: database.client,
      identity: identityWith(['read:backlog']),
    }).request('GET', url('/audit/writes'));
    expect(response.status).toBe(403);
  });

  describe('the retention window', () => {
    it('reports the default until one is chosen, with what is held', async () => {
      const response = await createTestApp({ client: database.client }).request(
        'GET',
        url('/audit/retention'),
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        retentionDays: WRITE_AUDIT_RETENTION.defaultDays,
        chosen: false,
        defaultDays: WRITE_AUDIT_RETENTION.defaultDays,
        minDays: WRITE_AUDIT_RETENTION.minDays,
        maxDays: WRITE_AUDIT_RETENTION.maxDays,
        updatedAt: null,
        records: 3,
        oldestAt: '2026-03-01T08:00:00.000Z',
      } satisfies RetentionBody);
    });

    it('takes a chosen window and keeps it', async () => {
      const app = createTestApp({ client: database.client });

      const put = await app.request('PUT', url('/audit/retention'), { retentionDays: 30 });
      expect(put.status).toBe(200);
      expect(put.body).toMatchObject({ retentionDays: 30, chosen: true });
      expect((put.body as RetentionBody).updatedAt).not.toBeNull();

      const again = await app.request('PUT', url('/audit/retention'), { retentionDays: 365 });
      expect((again.body as RetentionBody).retentionDays).toBe(365);

      const read = await app.request('GET', url('/audit/retention'));
      expect((read.body as RetentionBody).retentionDays).toBe(365);
    });

    it.each([0, WRITE_AUDIT_RETENTION.minDays - 1, WRITE_AUDIT_RETENTION.maxDays + 1, 14.5])(
      'refuses %s days',
      async (days) => {
        const response = await createTestApp({ client: database.client }).request(
          'PUT',
          url('/audit/retention'),
          { retentionDays: days },
        );
        expect(response.status).toBe(400);
      },
    );

    it('is refused without admin:settings', async () => {
      const response = await createTestApp({
        client: database.client,
        identity: identityWith(['read:sync']),
      }).request('PUT', url('/audit/retention'), { retentionDays: 30 });
      expect(response.status).toBe(403);
    });
  });
});
