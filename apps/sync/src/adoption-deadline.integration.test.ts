import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseCalendarDate } from '@prisme/domain';
import { createPostgresStore } from './state/postgres.js';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from './test-support/database.js';

/**
 * An adopted task's deadline, taken into prisme — against a real PostgreSQL.
 *
 * The planner decides *whether* (`plan.adoption.test.ts`); this is the half a
 * fake cannot show: the column is written, a deadline prisme already holds is
 * never replaced (the SQL repeats the planner's rule where the row is), and a
 * labelled task's capture carries its deadline in the same insert.
 *
 * Fixture data only: an invented area and invented titles.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

const TABLES = [
  'confirmation_token',
  'creation_intent',
  'capture',
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
  'area_weight',
  'area',
  'role_binding',
  'sync_cursor',
] as const;

describeOrSkip('adopting keeps the task’s deadline', () => {
  let database: SyncTestDatabase;
  let client: postgres.Sql;
  const at = new Date('2026-09-26T09:00:00Z');

  beforeAll(async () => {
    database = await openTestDatabase();
    client = database.client;
  }, 60_000);

  afterAll(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.truncate(TABLES);
    await client`insert into area (key, name, kind) values ('craft', 'Craft', 'area')`;
  });

  async function deadlineOf(id: string): Promise<string | null> {
    const rows = await client<{ deadline: string | null }[]>`
      select to_char(deadline, 'YYYY-MM-DD') as deadline from initiative where id = ${id}::uuid`;
    return rows[0]?.deadline ?? null;
  }

  async function initiative(deadline: string | null): Promise<string> {
    const rows = await client<{ id: string }[]>`
      insert into initiative (title, area_key, status, value, time_criticality, risk, size, origin,
                              deadline)
      values ('An invented initiative', 'craft', 'inbox', 3, 3, 3, 3, 'adopted', ${deadline}::date)
      returning id::text`;
    return (rows[0] as { id: string }).id;
  }

  it('writes it onto an initiative that has none', async () => {
    const id = await initiative(null);
    await createPostgresStore(client).adoptDeadline({
      initiativeId: id,
      deadline: parseCalendarDate('2026-12-01'),
      at,
    });
    expect(await deadlineOf(id)).toBe('2026-12-01');
  });

  it('never replaces one prisme already holds', async () => {
    const id = await initiative('2026-10-15');
    await createPostgresStore(client).adoptDeadline({
      initiativeId: id,
      deadline: parseCalendarDate('2026-12-01'),
      at,
    });
    expect(await deadlineOf(id)).toBe('2026-10-15');
  });

  it('carries it into an initiative captured from a labelled task', async () => {
    const id = await createPostgresStore(client).captureInitiative({
      externalId: 'task-invented-0001',
      title: 'Labelled by hand',
      areaKey: 'craft',
      deadline: parseCalendarDate('2026-12-01'),
      at,
    });
    expect(await deadlineOf(id)).toBe('2026-12-01');
  });
});
