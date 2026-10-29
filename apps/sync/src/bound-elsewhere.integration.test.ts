import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresStore } from './state/postgres.js';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from './test-support/database.js';

/**
 * Which tasks the reconciler treats as taken by something other than an
 * initiative — against a real PostgreSQL (S1, *convert to key result*).
 *
 * The planner decides what to do with them (`plan.adoption.test.ts`); this is
 * the half a fake cannot show: the set is read from `entity_external_ref`, and
 * it holds every non-initiative binding of a task and nothing else.
 *
 * Fixture data only: invented identifiers.
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
  'area_weight',
  'area',
  'role_binding',
  'sync_cursor',
] as const;

describeOrSkip('tasks bound to something other than an initiative', () => {
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
  });

  it('are the task bindings of key results and captures, and no initiative’s', async () => {
    await client`
      insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id) values
        ('kr-invented', 'key_result', 'task', 'task-invented-kr'),
        ('capture-invented', 'capture', 'task', 'task-invented-capture'),
        ('init-invented', 'initiative', 'task', 'task-invented-anchor'),
        ('project-invented', 'project', 'project', 'project-invented')`;

    const desired = await createPostgresStore(client).loadDesired();
    expect([...desired.boundElsewhere].sort()).toEqual([
      'task-invented-capture',
      'task-invented-kr',
    ]);
  });
  /** S15: which key results want an anchor, and what the store says about each. */
  it('offers the key results of objectives under way, with their task, link and deadline', async () => {
    await client`insert into area (key, name, kind) values ('craft', 'Invented craft', 'area')`;
    await client`
      insert into area_mapping (area_key, external_project_id, external_section_id, is_home)
      values ('craft', 'project-invented', null, true)`;
    const objectives = await client<{ id: string; status: string }[]>`
      insert into objective (title, type, period, area_key, status) values
        ('Invented active', 'annual', '2026', 'craft', 'active'),
        ('Invented draft', 'annual', '2026', 'craft', 'draft'),
        ('Invented next month', 'monthly', '2026-11', 'craft', 'active')
      returning id::text, status`;
    const active = objectives[0]?.id as string;
    const keyResults = await client<{ id: string }[]>`
      insert into key_result (objective_id, statement, target, unit) values
        (${active}::uuid, 'Invented bound', 1, 'race'),
        (${active}::uuid, 'Invented linked', 1, 'race'),
        (${active}::uuid, 'Invented bare', 1, 'race'),
        (${objectives[1]?.id as string}::uuid, 'Invented draft kr', 1, 'race'),
        (${objectives[2]?.id as string}::uuid, 'Invented future kr', 1, 'race')
      returning id::text`;
    const [bound, linked, bare] = keyResults.map((row) => row.id);
    await client`
      insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
      values (${bound as string}, 'key_result', 'task', 'task-invented-bound')`;
    await client`
      insert into entity_link
        (prisme_id, external_kind, external_id, match_rule, confidence, decided_by, decided_at)
      values (${linked as string}, 'task', 'task-invented-linked', 'manual', 'manual', 'human', now())`;

    const store = createPostgresStore(client, { today: () => '2026-10-28' });
    const desired = await store.loadDesired();
    const byId = new Map((desired.keyResultAnchors ?? []).map((kr) => [kr.keyResultId, kr]));

    expect([...byId.keys()].sort()).toEqual([bound, linked, bare].sort());
    expect(byId.get(bound as string)).toMatchObject({
      externalAnchorId: 'task-invented-bound',
      deadline: '2026-12-31',
    });
    // Its objective holds no task, so it has nowhere to be made (ADR-0038).
    expect(byId.get(bound as string)?.objectiveTaskId).toBeUndefined();
    expect(byId.get(linked as string)?.pendingExternalId).toBe('task-invented-linked');
    expect(byId.get(bare as string)?.externalAnchorId).toBeUndefined();

    await store.bindKeyResultRef({
      keyResultId: bare as string,
      externalId: 'task-invented-created',
      at: new Date('2026-10-28T09:00:00Z'),
    });
    const [row] = await client<{ external_anchor_id: string | null }[]>`
      select external_anchor_id from key_result where id = ${bare as string}::uuid`;
    expect(row?.external_anchor_id).toBe('task-invented-created');
    expect((await store.loadDesired()).boundElsewhere.has('task-invented-created')).toBe(true);
  });

  /** ADR-0038: an objective's own task is taken, offered while under way, and parents its key results. */
  it('offers an objective’s own task while it is under way, and names it on its key results', async () => {
    await client`insert into area (key, name, kind) values ('craft', 'Invented craft', 'area')`;
    const objectives = await client<{ id: string }[]>`
      insert into objective (title, type, period, area_key, status) values
        ('Invented under way', 'annual', '2026', 'craft', 'active'),
        ('Invented later', 'annual', '2027', 'craft', 'draft')
      returning id::text`;
    const [underWay, later] = objectives.map((row) => row.id) as [string, string];
    const [keyResult] = await client<{ id: string }[]>`
      insert into key_result (objective_id, statement, target, unit)
      values (${underWay}::uuid, 'Invented statement', 1, 'race')
      returning id::text`;
    await client`
      insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id) values
        (${underWay}, 'objective', 'task', 'task-invented-objective'),
        (${later}, 'objective', 'task', 'task-invented-later')`;

    const desired = await createPostgresStore(client, { today: () => '2026-10-29' }).loadDesired();

    expect(desired.objectiveTasks).toEqual([
      {
        objectiveId: underWay,
        title: 'Invented under way',
        deadline: '2026-12-31',
        externalTaskId: 'task-invented-objective',
      },
    ]);
    expect(desired.keyResultAnchors?.[0]).toMatchObject({
      keyResultId: keyResult?.id,
      objectiveTaskId: 'task-invented-objective',
    });
    expect(desired.boundElsewhere.has('task-invented-objective')).toBe(true);
    expect(desired.boundElsewhere.has('task-invented-later')).toBe(true);
  });
});
