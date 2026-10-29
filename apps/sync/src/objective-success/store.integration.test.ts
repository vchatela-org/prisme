import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from '../test-support/database.js';
import { createObjectiveSuccessStore } from './store.js';

/**
 * The success read's store against a real PostgreSQL (ADR-0042): the column it
 * reads with its format, the objectives it reads for, and what it writes and
 * clears. Every title and column name is invented.
 *
 * Skips loudly without a database, and throws in CI.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

/** Every table, children first — the list `../adoption/store.integration.test.ts` keeps. */
const TABLES = [
  'confirmation_token',
  // W15's two (migration 0007). `creation_intent` references itself and
  // `capture` references both `area` and `initiative`, so both come first.
  'creation_intent',
  'capture',
  // W13's three (migration 0006). `capacity_week` references `area`, so leaving
  // it out makes this `truncate` refuse the whole statement rather than merely
  // leaving rows behind.
  'capacity_completion',
  'capacity_week',
  'completion_history',
  'backfill_cursor',
  'adoption_candidate',
  'adoption_ignore',
  'api_token',
  'sync_conflict',
  'last_applied',
  'entity_link',
  'entity_external_ref',
  'event_log',
  'review_session',
  'ritual_adherence',
  'ritual',
  'takeaway',
  'key_result_measurement',
  'key_result_served_by',
  'key_result',
  'objective',
  'task_mirror',
  'initiative_score',
  'initiative_dependency',
  'initiative',
  'project',
  'area_mapping',
  'signals_label_setting',
  'area_weight',
  'area',
  // W16's one table. It references nothing and nothing references it, so
  // omitting it would leave a binding behind rather than refusing the
  // statement — which is the quieter failure of the two.
  'role_binding',
  'sync_cursor',
] as const;

describeOrSkip('the objective success store against PostgreSQL', () => {
  let database: SyncTestDatabase;
  let client: postgres.Sql;

  beforeAll(async () => {
    database = await openTestDatabase();
    client = database.client;
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate(TABLES);
    await client`insert into area (key, name, kind) values ('health', 'Health', 'area')`;
  });

  async function objective(title: string, pageId: string | null): Promise<string> {
    const [row] = await client<{ id: string }[]>`
      insert into objective (title, type, period, area_key, status, external_page_id)
      values (${title}, 'annual', '2026', 'health', 'active', ${pageId})
      returning id::text`;
    return (row as { id: string }).id;
  }

  async function bind(successProperty: string | null, numberProperties: unknown): Promise<void> {
    await client`
      insert into role_binding (role, external_id, success_property, number_properties)
      values ('objectives_db', 'ds-0001', ${successProperty},
              ${JSON.stringify(numberProperties)}::jsonb)`;
  }

  const NOW = new Date('2027-02-01T06:00:00.000Z');

  it('reads the chosen column with the format its check listed', async () => {
    await bind('Réussite', [
      { name: 'Budget', format: 'euro' },
      { name: 'Réussite', format: 'percent' },
    ]);
    await expect(createObjectiveSuccessStore(client).loadSuccessColumn()).resolves.toEqual({
      property: 'Réussite',
      format: 'percent',
    });
  });

  it('reads no column when none is chosen, and an unlisted one as unknown', async () => {
    await bind(null, []);
    await expect(createObjectiveSuccessStore(client).loadSuccessColumn()).resolves.toBeUndefined();
    await client`update role_binding set success_property = 'Gone'`;
    await expect(createObjectiveSuccessStore(client).loadSuccessColumn()).resolves.toEqual({
      property: 'Gone',
      format: 'unknown',
    });
  });

  it('reads only objectives linked to a page, and writes and clears their figures', async () => {
    const linked = await objective('Walk every day', 'page-0001');
    const other = await objective('Swim a mile', 'page-0002');
    await objective('Cook on Sundays', null);
    const store = createObjectiveSuccessStore(client);

    expect((await store.loadLinkedObjectives()).map((entry) => entry.id).sort()).toEqual(
      [linked, other].sort(),
    );

    await expect(
      store.recordSuccess(
        new Map<string, number | null>([
          [linked, 100],
          [other, null],
        ]),
        NOW,
      ),
    ).resolves.toBe(2);
    const rows = await client<
      { id: string; document_success: string | null; document_success_read_at: Date | null }[]
    >`
      select id::text, document_success::text, document_success_read_at
      from objective where external_page_id is not null order by title`;
    expect(rows.find((row) => row.id === other)?.document_success).toBeNull();
    expect(Number(rows.find((row) => row.id === linked)?.document_success)).toBe(100);
    expect(rows.find((row) => row.id === linked)?.document_success_read_at).not.toBeNull();

    await expect(store.clearSuccess()).resolves.toBe(1);
    const [left] = await client<{ n: string }[]>`
      select count(*) as n from objective where document_success is not null`;
    expect(Number(left?.n)).toBe(0);
  });

  it('refuses a negative figure and a figure without its time, at the database', async () => {
    const id = await objective('Walk every day', 'page-0001');
    await expect(
      client`update objective set document_success = -1, document_success_read_at = now()
             where id = ${id}::uuid`,
    ).rejects.toThrow();
    await expect(
      client`update objective set document_success = 50 where id = ${id}::uuid`,
    ).rejects.toThrow();
  });
});
