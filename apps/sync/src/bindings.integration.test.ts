// Imported rather than read off the global, for the same reason the sibling
// suites do it: the repository restricts the *global* `process` so that
// configuration goes through `@prisme/config`, and a test harness choosing its
// own database is not application configuration.
import process from 'node:process';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from '@prisme/db';
import { createDocToolClient, createRoleBindings, isConnectorError } from '@prisme/connectors';
import { parseBindingsFile, readBindings, saveBindings } from './bindings.js';

/**
 * The bindings, against a real PostgreSQL.
 *
 * The unit tests cover parsing a file. What they cannot cover is the property
 * the gap is really about: **that the document tool becomes addressable**. A
 * parsed file is an array of pairs; an addressable document tool is a
 * `RoleBindings` a `DocToolClient` resolves a store through, and the chain
 * between them runs through this table.
 *
 * So the assertions here are about the chain, not about rows: a round trip
 * through `saveBindings` and `readBindings`, and then a client built on the
 * result that resolves a bound role and refuses an unbound one. W12's scan and
 * W13's declared-duration tier both depend on exactly that, and both were
 * unreachable for want of it.
 *
 * Fixture data only: `fixtures/bindings.json`'s identifiers are invented.
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

const FIXTURE = new URL('../../../fixtures/bindings.json', import.meta.url).pathname;

describeOrSkip('the role bindings against PostgreSQL', () => {
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
  });

  it('binds nothing at all on an instance that has never run the loader', async () => {
    // The state every deployment starts in, and the state the connectors must
    // handle: an empty binding set, not an error. `resolve` throws
    // `unbound_role` per role, and both callers turn that into "not read".
    const bindings = await readBindings(client);
    expect(bindings.bound()).toEqual([]);
    expect(() => bindings.resolve('processes_db')).toThrow(/no binding for role processes_db/);
  });

  it('round-trips a seed file into a document tool that addresses stores', async () => {
    const loaded = parseBindingsFile(readFileSync(FIXTURE, 'utf8'), FIXTURE);
    await saveBindings(client, loaded.bindings);

    const bindings = await readBindings(client);
    expect(bindings.bound()).toEqual([
      'areas_db',
      'media_db',
      'objectives_db',
      'processes_db',
      'reviews_db',
      'takeaways_db',
    ]);

    // The identifier comes back exactly, which is the whole point: W12's scan
    // and W13's declared-duration tier both query a store by resolving one.
    expect(bindings.resolve('processes_db')).toBe('binding-processes-0005');

    // And a client built on it is addressable — the thing that did not exist
    // before this module. No transport, so any request would fail; what is
    // asserted is that construction and resolution no longer do.
    const docClient = createDocToolClient({
      token: 'fixture-token',
      bindings,
      transport: { send: () => Promise.reject(new Error('never called')) },
    });
    expect(typeof docClient.queryByRole).toBe('function');
  });

  it('refuses a role that is not bound, which is how "not read" is reported', async () => {
    await saveBindings(client, [{ role: 'areas_db', externalId: 'binding-areas-only-0001' }]);

    const bindings = await readBindings(client);
    expect(bindings.has('areas_db')).toBe(true);
    expect(bindings.has('processes_db')).toBe(false);

    let thrown: unknown;
    try {
      bindings.resolve('processes_db');
    } catch (error) {
      thrown = error;
    }
    expect(isConnectorError(thrown)).toBe(true);
    // The message names the role and never an identifier that *is* bound.
    expect((thrown as Error).message).toContain('processes_db');
    expect((thrown as Error).message).not.toContain('binding-areas-only-0001');
  });

  it('replaces rather than merges, so removing a role from the file unbinds it', async () => {
    // A merge would leave a role bound to a store the file no longer mentions,
    // and the operator would have no way to unbind one short of truncating the
    // table by hand.
    await saveBindings(client, [
      { role: 'areas_db', externalId: 'binding-areas-0001' },
      { role: 'processes_db', externalId: 'binding-processes-0001' },
    ]);
    expect((await readBindings(client)).bound()).toEqual(['areas_db', 'processes_db']);

    await saveBindings(client, [{ role: 'areas_db', externalId: 'binding-areas-0002' }]);
    const after = await readBindings(client);
    expect(after.bound()).toEqual(['areas_db']);
    expect(after.resolve('areas_db')).toBe('binding-areas-0002');
  });

  it('has one row per role, because two identifiers for one role is a refusal', async () => {
    await expect(
      client`insert into role_binding (role, external_id) values ('areas_db', 'one')`,
    ).resolves.toBeDefined();
    await expect(
      client`insert into role_binding (role, external_id) values ('areas_db', 'two')`,
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('refuses an empty identifier in the table as well as in the file', async () => {
    // Belt and braces: the loader refuses it, and so does the schema, so a row
    // inserted by hand cannot bind a role to nothing.
    await expect(
      client`insert into role_binding (role, external_id) values ('areas_db', '   ')`,
    ).rejects.toThrow(/role_binding_external_id_check|check/i);
  });

  it('ignores a row whose role the code no longer knows', async () => {
    // The vocabulary lives in `ROLE_KEYS` and this table has no CHECK on it, on
    // purpose (a migration per addition would couple the two). A stale row is
    // therefore possible and must be inert rather than fatal.
    await client`insert into role_binding (role, external_id) values ('retired_db', 'old-id')`;
    await client`insert into role_binding (role, external_id) values ('areas_db', 'binding-areas-0003')`;

    const bindings = await readBindings(client);
    expect(bindings.bound()).toEqual(['areas_db']);
  });

  it('builds the same resolver `createRoleBindings` builds, without a client', async () => {
    // The loader's parsed pairs are exactly what the connector's own factory
    // takes, which is what lets `saveBindings` store them and `readBindings`
    // rebuild them with nothing lost in between.
    const loaded = parseBindingsFile(readFileSync(FIXTURE, 'utf8'), FIXTURE);
    const direct = createRoleBindings(loaded.bindings);
    await saveBindings(client, loaded.bindings);

    expect((await readBindings(client)).bound()).toEqual(direct.bound());
    for (const role of direct.bound()) {
      expect((await readBindings(client)).resolve(role)).toBe(direct.resolve(role));
    }
  });
});

/** `packages/db/migrations`, from this file. */
function migrationsDir(): string {
  // Three levels, not the sibling suites' four: this file sits in `src/`, not in a
  // subdirectory of it.
  return new URL('../../../packages/db/migrations', import.meta.url).pathname;
}
