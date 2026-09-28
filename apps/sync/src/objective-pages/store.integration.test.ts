import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lastAppliedKey } from '../reconcile/types.js';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from '../test-support/database.js';
import { OBJECTIVE_PAGE } from './plan.js';
import { createObjectivePageStore } from './store.js';

/**
 * The objective-pages store, against a real PostgreSQL (ADR-0034).
 *
 * What a fake cannot get wrong: which objectives count as linked, where the
 * date column is read from, that `last_applied` is read back for this pass's
 * entity kind alone, and that the three shared writes land in the tables the
 * rest of the application reads. Every identifier is invented.
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
  'area_weight',
  'area',
  // W16's one table. It references nothing and nothing references it, so
  // omitting it would leave a binding behind rather than refusing the
  // statement — which is the quieter failure of the two.
  'role_binding',
  'sync_cursor',
] as const;

describeOrSkip('the objective-pages store against PostgreSQL', () => {
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

  const store = () => createObjectivePageStore(client);

  async function objective(title: string, page: string | null, period = '2027'): Promise<string> {
    const [row] = await client<{ id: string }[]>`
      insert into objective (title, type, period, area_key, status, external_page_id)
      values (${title}, 'annual', ${period}, 'health', 'active', ${page})
      returning id::text`;
    return (row as { id: string }).id;
  }

  describe('loadDateColumn', () => {
    it('is the objectives store’s chosen date column', async () => {
      await client`
        insert into role_binding (role, external_id, date_property) values
          ('objectives_db', 'ds-objectives-0001', 'Période'),
          ('takeaways_db', 'ds-takeaways-0001', 'Lu le')`;

      await expect(store().loadDateColumn()).resolves.toBe('Période');
    });

    it('is nothing when the store is bound without one, or not bound at all', async () => {
      await expect(store().loadDateColumn()).resolves.toBeUndefined();

      await client`
        insert into role_binding (role, external_id) values ('objectives_db', 'ds-objectives-0001')`;
      await expect(store().loadDateColumn()).resolves.toBeUndefined();
    });
  });

  describe('loadLinkedObjectives', () => {
    it('returns every objective with a page, and none without', async () => {
      const linked = await objective('Run a first marathon', 'page-0001', '2028');
      await objective('Read twelve books', null);
      await objective('Learn the cello', '  ');

      await expect(store().loadLinkedObjectives()).resolves.toEqual([
        {
          objectiveId: linked,
          title: 'Run a first marathon',
          type: 'annual',
          period: '2028',
          pageId: 'page-0001',
        },
      ]);
    });

    it('includes a closed objective: its page keeps the period it was judged against', async () => {
      const id = await objective('Run a first marathon', 'page-0001');
      await client`update objective set status = 'met' where id = ${id}::uuid`;

      await expect(store().loadLinkedObjectives()).resolves.toHaveLength(1);
    });
  });

  describe('last_applied', () => {
    it('reads back what it recorded, and only its own entity kind', async () => {
      const at = new Date('2026-09-28T10:00:00.000Z');
      await store().recordLastApplied(
        [
          {
            entityKind: OBJECTIVE_PAGE,
            entityId: 'page-0001',
            field: 'dates',
            value: '2027-01-01/2027-12-31',
          },
        ],
        at,
      );
      await client`
        insert into last_applied (entity_kind, entity_id, field, value, applied_at)
        values ('anchor', 'task-0001', 'priority', 'high', ${at.toISOString()}::timestamptz)`;

      const index = await store().loadLastApplied();

      expect([...index.keys()]).toEqual([lastAppliedKey(OBJECTIVE_PAGE, 'page-0001', 'dates')]);
      expect(index.get(lastAppliedKey(OBJECTIVE_PAGE, 'page-0001', 'dates'))?.value).toBe(
        '2027-01-01/2027-12-31',
      );
    });

    it('replaces the value on a second write rather than adding a row', async () => {
      const write = (value: string) =>
        store().recordLastApplied(
          [{ entityKind: OBJECTIVE_PAGE, entityId: 'page-0001', field: 'dates', value }],
          new Date('2026-09-28T10:00:00.000Z'),
        );
      await write('2028-01-01/2028-12-31');
      await write('2027-01-01/2027-12-31');

      const index = await store().loadLastApplied();
      expect(index.size).toBe(1);
      expect([...index.values()][0]?.value).toBe('2027-01-01/2027-12-31');
    });
  });

  describe('the shared writes', () => {
    it('puts a conflict in the ledger and an action in the event log', async () => {
      const id = await objective('Run a first marathon', 'page-0001');
      const at = new Date('2026-09-28T10:00:00.000Z');

      await store().recordConflict(
        {
          entityId: id,
          field: 'period',
          prismeValue: '2027-01-01/2027-12-31',
          externalValue: '2027-06-01/2027-12-31',
          resolution: 'prisme_wins',
        },
        at,
      );
      await store().recordEvent({
        kind: 'sync_action',
        entityKind: 'objective',
        entityId: id,
        after: { tag: 'conflict', detail: 'restored' },
        occurredAt: at,
      });

      const conflicts = await client<{ entity_id: string; field: string; actor: string }[]>`
        select entity_id, field, actor from sync_conflict`;
      expect(conflicts).toEqual([{ entity_id: id, field: 'period', actor: 'sync' }]);
      const events = await client<{ kind: string; entity_kind: string }[]>`
        select kind, entity_kind from event_log`;
      expect(events).toEqual([{ kind: 'sync_action', entity_kind: 'objective' }]);
    });
  });
});
