import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from '../test-support/database.js';
import { advanceObjectiveWindows } from './run.js';
import { createObjectiveWindowStore } from './store.js';

/**
 * The window step against a real PostgreSQL (ADR-0037): which objectives it
 * reads, that a change and its event land together, and that a status somebody
 * changed first is left alone. Every title is invented.
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
  // ADR-0041's setting (migration 0026) references `area`.
  'signals_label_setting',
  'area_weight',
  'area',
  // W16's one table. It references nothing and nothing references it, so
  // omitting it would leave a binding behind rather than refusing the
  // statement — which is the quieter failure of the two.
  'role_binding',
  'sync_cursor',
] as const;

describeOrSkip('the objective window step against PostgreSQL', () => {
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

  async function objective(
    title: string,
    type: 'annual' | 'monthly',
    period: string,
    status: string,
  ): Promise<string> {
    const [row] = await client<{ id: string }[]>`
      insert into objective (title, type, period, area_key, status)
      values (${title}, ${type}, ${period}, 'health', ${status})
      returning id::text`;
    return (row as { id: string }).id;
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const [row] = await client<{ status: string }[]>`
      select status from objective where id = ${id}::uuid`;
    return row?.status;
  }

  const NOW = new Date('2027-02-01T06:00:00.000Z');

  it('moves every open objective to where its window says, and records why', async () => {
    const running = await objective('Walk every day', 'annual', '2027', 'draft');
    const early = await objective('Swim a mile', 'annual', '2028', 'active');
    const unjudged = await objective('Sleep eight hours', 'annual', '2026', 'active');
    const closing = await objective('Cook on Sundays', 'monthly', '2027-01', 'active');
    const judged = await objective('Stretch daily', 'annual', '2026', 'met');

    const result = await advanceObjectiveWindows({
      store: createObjectiveWindowStore(client),
      today: '2027-02-01',
      now: NOW,
      mode: 'apply',
    });

    expect(result).toEqual({
      counts: { period_started: 1, period_not_started: 1, review_window_ended: 1 },
      raced: 0,
    });
    expect(await statusOf(running)).toBe('active');
    expect(await statusOf(early)).toBe('draft');
    expect(await statusOf(unjudged)).toBe('missed');
    expect(await statusOf(closing)).toBe('active');
    expect(await statusOf(judged)).toBe('met');

    const events = await client<
      { entity_id: string; before: unknown; after: unknown; actor: string; field: string }[]
    >`
      select entity_id, before, after, actor, field from event_log
      where kind = 'status_changed' and entity_kind = 'objective'
      order by entity_id`;
    expect(events).toHaveLength(3);
    expect(events.find((event) => event.entity_id === unjudged)).toEqual({
      entity_id: unjudged,
      before: { status: 'active' },
      after: { status: 'missed', reason: 'review_window_ended' },
      actor: 'sync',
      field: 'status',
    });
  });

  it('writes nothing under plan, and nothing twice', async () => {
    const id = await objective('Walk every day', 'annual', '2027', 'draft');
    const store = createObjectiveWindowStore(client);

    const planned = await advanceObjectiveWindows({
      store,
      today: '2027-02-01',
      now: NOW,
      mode: 'plan',
    });
    expect(planned.counts.period_started).toBe(1);
    expect(await statusOf(id)).toBe('draft');

    await advanceObjectiveWindows({ store, today: '2027-02-01', now: NOW, mode: 'apply' });
    const again = await advanceObjectiveWindows({
      store,
      today: '2027-02-01',
      now: NOW,
      mode: 'apply',
    });
    expect(again.counts).toEqual({
      period_started: 0,
      period_not_started: 0,
      review_window_ended: 0,
    });
    const [count] = await client<{ n: string }[]>`select count(*) as n from event_log`;
    expect(Number(count?.n)).toBe(1);
  });

  it('leaves an objective a person judged after it was read', async () => {
    const id = await objective('Sleep eight hours', 'annual', '2026', 'active');
    const store = createObjectiveWindowStore(client);
    await client`update objective set status = 'met' where id = ${id}::uuid`;

    await expect(
      store.applyStep(id, { from: 'active', to: 'missed', reason: 'review_window_ended' }, NOW),
    ).resolves.toBe(false);
    expect(await statusOf(id)).toBe('met');
    const [count] = await client<{ n: string }[]>`select count(*) as n from event_log`;
    expect(Number(count?.n)).toBe(0);
  });
});
