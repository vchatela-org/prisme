// Imported rather than read off the global, for the same reason the adoption
// and backfill suites do it: the repository restricts the *global* `process`
// so configuration goes through `@prisme/config`, and a test harness choosing
// its own database is not application configuration.
import process from 'node:process';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from '@prisme/db';
import { idempotencyKey } from '@prisme/connectors/write';

import { createCreationStore } from './store.js';

/**
 * The creation store, against a real PostgreSQL.
 *
 * Everything asserted here is something an in-memory fake cannot get wrong,
 * and every one of them is load-bearing for W15's definition of done:
 *
 *   - `recordSatisfied` either writes the ledger row, the entity's reference
 *     column and `entity_external_ref` in **one** transaction, or it leaves a
 *     state where one of the three disagrees with the other two.
 *   - `entity_external_ref`'s unique index either refuses a second binding of
 *     one object, or guard 1 is decoration.
 *   - `loadOutstanding` either brings a satisfied *prerequisite* along with
 *     the rows that wait on it, or every section whose project succeeded looks
 *     like it waits on something that vanished.
 *   - `jsonb` either arrives parsed or arrives as text, which is the bug W05
 *     found twice and a type checker cannot see.
 *
 * Skips loudly without a database, and throws in CI.
 */

function envUrl(name: string): string | undefined {
  const url = process.env[name];
  return url === undefined || url.trim() === '' ? undefined : url;
}

const databaseUrl = envUrl('PRISME_TEST_DATABASE_URL');
const migrationUrl = envUrl('PRISME_TEST_MIGRATION_DATABASE_URL') ?? databaseUrl;

const describeOrSkip: typeof describe | typeof describe.skip = (() => {
  if (databaseUrl !== undefined) return describe;
  if (process.env['CI'] !== undefined && process.env['CI'] !== '') {
    throw new Error(
      'PRISME_TEST_DATABASE_URL is unset in CI: this suite would skip silently, ' +
        'which reports green for tests that did not run',
    );
  }
  return describe.skip;
})();

/** Every table, children first — never `cascade`. The same list as the sibling suites. */
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
  'sync_cursor',
] as const;

const NOW = new Date('2026-09-20T10:00:00.000Z');

/**
 * Derived, never a literal. A UUID literal is refused by the privacy
 * deny-list: the pattern cannot tell a made-up one from a real workspace
 * identifier, and using the real function is what the ledger does anyway.
 */
const keyFor = (slot: string): string =>
  idempotencyKey({ runId: 'creation-intent', operation: 'create', subject: slot });

describeOrSkip('the creation store against PostgreSQL', () => {
  let client: postgres.Sql;
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = postgres(migrationUrl as string, { max: 1, onnotice: () => undefined });
    await runMigrations({ client: owner, migrations: loadMigrations(migrationsDir()) });
    client = postgres(databaseUrl as string, { max: 2, onnotice: () => undefined });
  }, 60_000);

  afterAll(async () => {
    await client.end();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.unsafe(`truncate table ${TABLES.join(', ')}`);
    await client`insert into area (key, name, kind) values ('home', 'Home', 'area')`;
  });

  async function makeProject(sections: readonly string[] = []): Promise<string> {
    const rows = await client<{ id: string }[]>`
      insert into project (name, area_key, status, sections, origin)
      values ('A large effort', 'home', 'active', ${sections as string[]}::text[],
              'created_in_prisme')
      returning id::text`;
    return rows[0]?.id as string;
  }

  async function makeIntent(input: {
    entityKind: 'capture' | 'initiative' | 'project';
    entityId: string;
    tool?: 'task' | 'document';
    objectKind: 'task' | 'project' | 'section' | 'page';
    ordinal?: number;
    draft?: Record<string, unknown>;
    requires?: string | undefined;
    key?: string;
  }): Promise<string> {
    const rows = await client<{ id: string }[]>`
      insert into creation_intent
        (entity_kind, entity_id, tool, object_kind, ordinal, draft, idempotency_key, requires)
      values (${input.entityKind}, ${input.entityId}::uuid, ${input.tool ?? 'task'},
              ${input.objectKind}, ${input.ordinal ?? 0},
              ${client.json((input.draft ?? {}) as never)},
              ${input.key ?? keyFor(`${input.entityId}:${input.objectKind}:${String(input.ordinal ?? 0)}`)}::uuid,
              ${input.requires ?? null}::uuid)
      returning id::text`;
    return rows[0]?.id as string;
  }

  describe('loading what is outstanding', () => {
    it('reads a jsonb draft back as an object, not as text', async () => {
      const projectId = await makeProject(['First']);
      await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'project',
        draft: { name: 'A large effort', nested: { deep: true } },
      });

      const [intent] = await createCreationStore(client).loadOutstanding();

      // The bug this is about: `jsonb` arrives as the *string*
      // `'{"name":"…"}'`, on which every property access silently yields
      // undefined and nothing in a type checker notices.
      expect(typeof intent?.draft).toBe('object');
      expect(intent?.draft['name']).toBe('A large effort');
    });

    /**
     * A satisfied prerequisite has to come along, or `orderConvergence` reads
     * every section whose project succeeded as waiting on something that has
     * vanished from the ledger — and blocks all of them forever.
     */
    it('brings a satisfied prerequisite along with the rows that wait on it', async () => {
      const projectId = await makeProject(['First']);
      const parent = await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'project',
        draft: { name: 'A large effort' },
      });
      await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'section',
        draft: { name: 'First', order: 0 },
        requires: parent,
      });

      await createCreationStore(client).recordSatisfied({
        intentId: parent,
        externalId: 'made-project',
        at: NOW,
      });

      const outstanding = await createCreationStore(client).loadOutstanding();
      expect(outstanding.map((intent) => intent.state).sort()).toEqual(['pending', 'satisfied']);
      expect(outstanding.find((intent) => intent.id === parent)?.externalId).toBe('made-project');
    });

    it('leaves out a satisfied intent nothing waits on', async () => {
      const projectId = await makeProject();
      const alone = await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'project',
        draft: { name: 'A large effort' },
      });
      await createCreationStore(client).recordSatisfied({
        intentId: alone,
        externalId: 'made-project',
        at: NOW,
      });

      expect(await createCreationStore(client).loadOutstanding()).toHaveLength(0);
    });
  });

  describe('recording a creation that worked', () => {
    it('writes the ledger row, the entity’s column and the reference together', async () => {
      const projectId = await makeProject();
      const intentId = await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'project',
        draft: { name: 'A large effort' },
      });

      await createCreationStore(client).recordSatisfied({
        intentId,
        externalId: 'made-project',
        at: NOW,
      });

      const [intent] = await client<{ state: string; external_id: string; attempts: number }[]>`
        select state, external_id, attempts from creation_intent where id = ${intentId}::uuid`;
      const [project] = await client<{ external_project_id: string }[]>`
        select external_project_id from project where id = ${projectId}::uuid`;
      const refs = await client<{ prisme_kind: string }[]>`
        select prisme_kind from entity_external_ref
         where kind = 'project' and external_id = 'made-project'`;

      expect(intent).toMatchObject({ state: 'satisfied', external_id: 'made-project' });
      expect(intent?.attempts).toBe(1);
      expect(project?.external_project_id).toBe('made-project');
      expect(refs).toHaveLength(1);
    });

    /**
     * A section has no column of its own — prisme holds an ordered list of
     * names, not a row per section — so its binding lives only in
     * `entity_external_ref`. Writing it to the project's column would
     * overwrite the project's own reference with a section's.
     */
    it('binds a section without touching the project’s own reference', async () => {
      const projectId = await makeProject(['First']);
      await client`
        update project set external_project_id = 'existing-project' where id = ${projectId}::uuid`;

      const intentId = await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'section',
        draft: { name: 'First', order: 0 },
      });
      await createCreationStore(client).recordSatisfied({
        intentId,
        externalId: 'made-section',
        at: NOW,
      });

      const [project] = await client<{ external_project_id: string }[]>`
        select external_project_id from project where id = ${projectId}::uuid`;
      expect(project?.external_project_id).toBe('existing-project');

      const refs = await client<{ external_id: string }[]>`
        select external_id from entity_external_ref where kind = 'section'`;
      expect(refs[0]?.external_id).toBe('made-section');
    });

    /**
     * Guard 1, at the moment it matters most. If the object is already bound
     * to something else the transaction must fail **and the intent stay
     * unsatisfied**, so the ledger does not claim an object that is not its.
     */
    it('refuses to bind an object another entity already holds, leaving the intent pending', async () => {
      const first = await makeProject();
      const second = await makeProject();
      await client`
        insert into entity_external_ref (prisme_id, prisme_kind, kind, external_id)
        values (${first}, 'project', 'project', 'contested')`;

      const intentId = await makeIntent({
        entityKind: 'project',
        entityId: second,
        objectKind: 'project',
        draft: { name: 'Another effort' },
      });

      await expect(
        createCreationStore(client).recordSatisfied({
          intentId,
          externalId: 'contested',
          at: NOW,
        }),
      ).rejects.toThrow();

      const [intent] = await client<{ state: string }[]>`
        select state from creation_intent where id = ${intentId}::uuid`;
      expect(intent?.state).toBe('pending');
    });

    /**
     * The other half of the one-object-one-intent rule, and a second index
     * doing the same job from the other side: two intents cannot both claim
     * to have produced the same object.
     */
    it('refuses two intents claiming to have made the same object', async () => {
      const projectId = await makeProject(['First', 'Second']);
      const one = await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'section',
        ordinal: 0,
        draft: { name: 'First' },
      });
      const two = await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'section',
        ordinal: 1,
        draft: { name: 'Second' },
      });

      await createCreationStore(client).recordSatisfied({
        intentId: one,
        externalId: 'made-section',
        at: NOW,
      });
      await expect(
        createCreationStore(client).recordSatisfied({
          intentId: two,
          externalId: 'made-section',
          at: NOW,
        }),
      ).rejects.toThrow(/creation_intent_produced_once/);
    });
  });

  describe('recording a failure', () => {
    it('keeps the reason and counts the attempt', async () => {
      const projectId = await makeProject();
      const intentId = await makeIntent({
        entityKind: 'project',
        entityId: projectId,
        objectKind: 'project',
        draft: { name: 'A large effort' },
      });

      await createCreationStore(client).recordFailed({
        intentId,
        reason: 'task tool: create project: the tool refused the command with error code 43',
        at: NOW,
      });

      const [intent] = await client<{ state: string; last_error: string; attempts: number }[]>`
        select state, last_error, attempts from creation_intent where id = ${intentId}::uuid`;
      expect(intent?.state).toBe('failed');
      expect(intent?.attempts).toBe(1);
      expect(intent?.last_error).toContain('error code 43');
    });
  });

  describe('the entity references a section needs', () => {
    it('reads a linked project’s external id', async () => {
      const projectId = await makeProject(['First']);
      await client`
        update project set external_project_id = 'linked-project' where id = ${projectId}::uuid`;

      const refs = await createCreationStore(client).loadEntityRefs([projectId]);
      expect(refs.get(projectId)).toEqual({ externalProjectId: 'linked-project' });
    });

    it('reports an unlinked project as having none, rather than omitting it', async () => {
      const projectId = await makeProject(['First']);
      const refs = await createCreationStore(client).loadEntityRefs([projectId]);
      expect(refs.get(projectId)).toEqual({});
    });

    it('asks nothing of the database for an empty list', async () => {
      expect((await createCreationStore(client).loadEntityRefs([])).size).toBe(0);
    });
  });
});

/**
 * Where the migrations are, from a test running out of `src`. The same helper
 * as the sibling suites, and the same reason for being explicit.
 */
function migrationsDir(): string {
  return new URL('../../../../packages/db/migrations', import.meta.url).pathname;
}
