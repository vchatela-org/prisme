import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from '../test-support/database.js';
import { giveObjectivesTheirTasks } from './run.js';
import { createObjectiveTaskStore, OBJECTIVE_TASK_REASON } from './store.js';

/**
 * Giving an objective its own task, against a real PostgreSQL (ADR-0038):
 * the binding moves, the initiative is dropped without its anchor, both are
 * recorded, and anything that changed since the read is left alone. Every
 * title and identifier is invented.
 *
 * Skips loudly without a database, and throws in CI.
 */

const describeOrSkip = describeWithDatabase === 'run' ? describe : describe.skip;

const TABLES = [
  'confirmation_token',
  'creation_intent',
  'capture',
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
  'role_binding',
  'sync_cursor',
] as const;

describeOrSkip('an objective takes its own task, against PostgreSQL', () => {
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
    await client`insert into area (key, name, kind) values
      ('craft', 'Invented craft', 'area'), ('home', 'Invented home', 'area')`;
  });

  const NOW = new Date('2026-10-29T06:00:00.000Z');

  async function objective(title: string, area = 'craft', status = 'active'): Promise<string> {
    const [row] = await client<{ id: string }[]>`
      insert into objective (title, type, period, area_key, status)
      values (${title}, 'annual', '2026', ${area}, ${status})
      returning id::text`;
    return (row as { id: string }).id;
  }

  async function initiative(title: string, task: string, area = 'craft'): Promise<string> {
    const [row] = await client<{ id: string }[]>`
      insert into initiative
        (title, area_key, status, value, time_criticality, risk, size, origin, external_anchor_id)
      values (${title}, ${area}, 'next', 3, 3, 3, 3, 'adopted', ${task})
      returning id::text`;
    const id = (row as { id: string }).id;
    await client`
      insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
      values (${id}, 'initiative', 'task', ${task})`;
    return id;
  }

  it('moves the task to the objective, drops the initiative, and records both', async () => {
    const goal = await objective('Learn the cello');
    const work = await initiative('Learn the cello', 'task-invented-1');
    const other = await initiative('Tune the cello', 'task-invented-2');

    const result = await giveObjectivesTheirTasks({
      store: createObjectiveTaskStore(client),
      now: NOW,
      mode: 'apply',
    });
    expect(result).toEqual({ moved: 1, raced: 0 });

    const refs = await client<{ prisme_id: string; prisme_kind: string; external_id: string }[]>`
      select prisme_id, prisme_kind, external_id from entity_external_ref order by external_id`;
    expect(refs).toEqual([
      { prisme_id: goal, prisme_kind: 'objective', external_id: 'task-invented-1' },
      { prisme_id: other, prisme_kind: 'initiative', external_id: 'task-invented-2' },
    ]);

    const [dropped] = await client<
      { status: string; dropped_reason: string; external_anchor_id: string | null }[]
    >`select status, dropped_reason, external_anchor_id from initiative where id = ${work}::uuid`;
    expect(dropped).toEqual({
      status: 'dropped',
      dropped_reason: OBJECTIVE_TASK_REASON,
      external_anchor_id: null,
    });

    const [link] = await client<{ match_rule: string; confidence: string; decided_by: string }[]>`
      select match_rule, confidence, decided_by from entity_link where prisme_id = ${goal}`;
    expect(link).toEqual({ match_rule: 'exact_title', confidence: 'certain', decided_by: 'auto' });

    const events = await client<{ kind: string; entity_kind: string; actor: string }[]>`
      select kind, entity_kind, actor from event_log order by kind`;
    expect(events).toEqual([
      { kind: 'adoption_decision', entity_kind: 'objective', actor: 'sync' },
      { kind: 'status_changed', entity_kind: 'initiative', actor: 'sync' },
    ]);

    // Level-triggered and idempotent: the next pass finds nothing to do.
    await expect(
      giveObjectivesTheirTasks({
        store: createObjectiveTaskStore(client),
        now: NOW,
        mode: 'apply',
      }),
    ).resolves.toEqual({ moved: 0, raced: 0 });
  });

  it('takes nothing across areas, nor under plan', async () => {
    await objective('Learn the cello', 'home');
    await initiative('Learn the cello', 'task-invented-1');
    await objective('Paint the fence');
    await initiative('Paint the fence', 'task-invented-2');

    const planned = await giveObjectivesTheirTasks({
      store: createObjectiveTaskStore(client),
      now: NOW,
      mode: 'plan',
    });
    expect(planned.moved).toBe(1);
    const [count] = await client<{ n: string }[]>`
      select count(*) as n from entity_external_ref where prisme_kind = 'objective'`;
    expect(Number(count?.n)).toBe(0);
  });

  it('leaves a match alone when the initiative’s task changed after it was read', async () => {
    const goal = await objective('Learn the cello');
    const work = await initiative('Learn the cello', 'task-invented-1');
    await client`update initiative set external_anchor_id = 'task-invented-9' where id = ${work}::uuid`;

    await expect(
      createObjectiveTaskStore(client).giveTaskToObjective(
        { initiativeId: work, objectiveId: goal, externalTaskId: 'task-invented-1' },
        NOW,
      ),
    ).resolves.toBe(false);
    const [count] = await client<{ n: string }[]>`select count(*) as n from event_log`;
    expect(Number(count?.n)).toBe(0);
  });
});
