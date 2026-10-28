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
});
