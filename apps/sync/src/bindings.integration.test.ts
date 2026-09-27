// Imported rather than read off the global, for the same reason the sibling
// suites do it: the repository restricts the *global* `process` so that
// configuration goes through `@prisme/config`, and a test harness choosing its
// own database is not application configuration.
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDocToolClient, isConnectorError, type RoleBinding } from '@prisme/connectors';
import {
  describeWithDatabase,
  openTestDatabase,
  type SyncTestDatabase,
} from './test-support/database.js';
import { readBindings } from './bindings.js';

/**
 * The bindings, against a real PostgreSQL.
 *
 * The rows are written by the API (Settings → Notion); this suite inserts them
 * directly and asserts the property the sync side depends on: **that the
 * document tool becomes addressable**. An addressable document tool is a
 * `RoleBindings` a `DocToolClient` resolves a store through, and the chain runs
 * through this table — `readBindings`, then a client built on the result that
 * resolves a bound role and refuses an unbound one. W12's scan and W13's
 * declared-duration tier both depend on exactly that.
 *
 * The connection comes from `test-support/database.ts` — the shared helper,
 * which builds the application client through `createDatabase`. This suite
 * built its own bare client first, and the source-walk guard that refuses one
 * is what caught it.
 *
 * Fixture data only: every identifier here is invented.
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

/** Every role bound, with invented identifiers. */
const ALL_ROLES: readonly RoleBinding[] = [
  { role: 'objectives_db', externalId: 'binding-objectives-0001' },
  { role: 'takeaways_db', externalId: 'binding-takeaways-0002' },
  { role: 'media_db', externalId: 'binding-media-0003' },
  { role: 'areas_db', externalId: 'binding-areas-0004' },
  { role: 'processes_db', externalId: 'binding-processes-0005' },
  { role: 'reviews_db', externalId: 'binding-reviews-0006' },
  { role: 'initiative_pages_db', externalId: 'binding-initiative-pages-0007' },
  { role: 'project_pages_db', externalId: 'binding-project-pages-0009' },
  { role: 'capture_pages_db', externalId: 'binding-capture-pages-0012' },
];

async function bind(client: postgres.Sql, bindings: readonly RoleBinding[]): Promise<void> {
  for (const binding of bindings) {
    await client`
      insert into role_binding (role, external_id, tool)
      values (${binding.role}, ${binding.externalId}, 'doc')`;
  }
}

describeOrSkip('the role bindings against PostgreSQL', () => {
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

  it('binds nothing at all on an instance whose settings are empty', async () => {
    // The state every deployment starts in, and the state the connectors must
    // handle: an empty binding set, not an error. `resolve` throws
    // `unbound_role` per role, and both callers turn that into "not read".
    const bindings = await readBindings(client);
    expect(bindings.bound()).toEqual([]);
    expect(() => bindings.resolve('processes_db')).toThrow(/no binding for role processes_db/);
  });

  it('reads the stored bindings into a document tool that addresses stores', async () => {
    await bind(client, ALL_ROLES);

    const bindings = await readBindings(client);
    // Nine, not six: ADR-0025's and ADR-0028's page stores are role bindings
    // like any other, and a reader that skipped them would leave an instance
    // that bound them looking unbound. There is no template role any more —
    // a store's templates are the ones its database holds (ADR-0030).
    expect(bindings.bound()).toEqual([
      'areas_db',
      'capture_pages_db',
      'initiative_pages_db',
      'media_db',
      'objectives_db',
      'processes_db',
      'project_pages_db',
      'reviews_db',
      'takeaways_db',
    ]);

    // The identifier comes back exactly, which is the whole point: W12's scan
    // and W13's declared-duration tier both query a store by resolving one.
    expect(bindings.resolve('processes_db')).toBe('binding-processes-0005');
    // And so does the creating path, which is what makes a page addressable.
    expect(bindings.resolve('project_pages_db')).toBe('binding-project-pages-0009');
    // ADR-0028's store, through the same table.
    expect(bindings.resolve('capture_pages_db')).toBe('binding-capture-pages-0012');

    // And a client built on it is addressable — the thing that did not exist
    // before this module. No transport, so any request would fail; what is
    // asserted is that construction and resolution no longer do.
    const docClient = createDocToolClient({
      token: 'fixture-token',
      bindings,
      // A `Transport` is a function, not an object with `send` — this test
      // carried the pre-seam shape and nothing noticed until test files were
      // typechecked.
      transport: () => Promise.reject(new Error('never called')),
    });
    expect(typeof docClient.queryByRole).toBe('function');
  });

  it('ignores a row whose role the vocabulary no longer names', async () => {
    // Migration 0012 deletes ADR-0025's template bindings; a row that somehow
    // survived resolves to nothing rather than failing the pass that reads it.
    await client`
      insert into role_binding (role, external_id, tool)
      values ('project_page_template', 'binding-retired-0001', 'doc')`;
    await bind(client, [{ role: 'project_pages_db', externalId: 'binding-project-pages-0009' }]);

    const bindings = await readBindings(client);
    expect(bindings.bound()).toEqual(['project_pages_db']);
  });

  it('refuses a role that is not bound, which is how "not read" is reported', async () => {
    await bind(client, [{ role: 'areas_db', externalId: 'binding-areas-only-0001' }]);

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

  it('has one row per role, because two identifiers for one role is a refusal', async () => {
    await expect(
      client`insert into role_binding (role, external_id) values ('areas_db', 'one')`,
    ).resolves.toBeDefined();
    await expect(
      client`insert into role_binding (role, external_id) values ('areas_db', 'two')`,
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('refuses an empty identifier in the table', async () => {
    // Belt and braces: the API refuses it, and so does the schema, so a row
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
});
