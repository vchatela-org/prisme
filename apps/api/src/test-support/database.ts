// Imported rather than read off the global, so this file needs no lint
// exception: the repository restricts the *global* `process` to keep
// configuration going through `@prisme/config`, and a test harness choosing its
// own database is not application configuration.
import process from 'node:process';
import postgres from 'postgres';
import { loadMigrations, runMigrations } from '@prisme/db';

/**
 * A real PostgreSQL, for the integration tests.
 *
 * The brief asks for integration tests **against a real PostgreSQL instance
 * seeded from `fixtures/`**, and it asks for that rather than a fake because
 * the interesting failures in this layer are the ones a fake cannot have: a
 * `numeric` arriving as a string, a `date` arriving as a local midnight, a
 * `count(*) over ()` that pages wrong, a constraint the application layer
 * thought it had already checked. W04 found two bugs this way that nothing in a
 * type checker or a unit test could see, and that is the precedent.
 *
 * ### When no database is available
 *
 * The suite **skips loudly** rather than passing quietly. A developer without a
 * database gets a named skip; CI always has one, because the `test` job runs a
 * `postgres` service — so a skip in CI would mean the service is gone, and the
 * job's own step asserts the URL is set before the suite runs.
 *
 * Migrations run here rather than being assumed: the schema a test runs against
 * is the schema in `packages/db/migrations`, applied from scratch, every run.
 */

function envUrl(name: string): string | undefined {
  const url = process.env[name];
  return url === undefined || url.trim() === '' ? undefined : url;
}

/**
 * The connection the **application role** uses — DML only, no DDL.
 *
 * `undefined` when this machine has no test database.
 */
export function testDatabaseUrl(): string | undefined {
  return envUrl('PRISME_TEST_DATABASE_URL');
}

/**
 * The connection migrations run on — the **migration role**, which owns the
 * schema (docs/15-runtime.md §3).
 *
 * Falling back to the application connection is for a plain CI service with one
 * role, where the split cannot be exercised. Where both exist, the tests run as
 * the role the application actually has: a query the deployed role could not
 * make is a query that must not pass here either.
 */
export function testMigrationDatabaseUrl(): string {
  return envUrl('PRISME_TEST_MIGRATION_DATABASE_URL') ?? (testDatabaseUrl() as string);
}

/**
 * Whether the database-backed suites run.
 *
 * **In CI it is never a choice.** A suite that skips itself is a suite that has
 * stopped running while still reporting green, which is the failure mode the
 * workstream protocol cares most about — so if `CI` is set and no database is
 * configured, this throws rather than skipping. A developer without a database
 * gets a named skip; the pipeline gets an error.
 */
export const describeWithDatabase: 'run' | 'skip' = (() => {
  if (testDatabaseUrl() !== undefined) return 'run';
  if (process.env['CI'] !== undefined && process.env['CI'] !== '') {
    throw new Error(
      'PRISME_TEST_DATABASE_URL is unset in CI: the integration suite would skip silently, ' +
        'which reports green for tests that did not run',
    );
  }
  return 'skip';
})();

export interface TestDatabase {
  readonly client: postgres.Sql;
  /** Empty every table, leaving the schema. Between tests, not between suites. */
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Tables emptied between tests, children first.
 *
 * `truncate … cascade` would be shorter and would also silently drop rows from
 * a table nobody listed — which is exactly the kind of convenience that hides a
 * new table from the reset and leaves one suite's rows in the next one's view.
 */
const TABLES = [
  'confirmation_token',
  // W13's three (migration 0006). `capacity_week` references `area`, so
  // omitting it does not merely leave stale rows — it makes `truncate` refuse
  // the whole statement, which is the no-`cascade` rule above doing its job:
  // adding a table to the schema is adding it here.
  'capacity_week',
  'completion_history',
  'backfill_cursor',
  'adoption_candidate',
  // Append-only, with a trigger refusing DELETE — the same reason `event_log`
  // is on this list and the same reason `truncate` is what resets it.
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

export async function openTestDatabase(): Promise<TestDatabase> {
  const url = testDatabaseUrl();
  if (url === undefined) {
    throw new Error('PRISME_TEST_DATABASE_URL is not set; the caller should have skipped');
  }

  // DDL as the role that owns the schema. The connection is kept, because the
  // reset needs it too — see below.
  const owner = postgres(testMigrationDatabaseUrl(), { max: 1, onnotice: () => undefined });
  await runMigrations({ client: owner, migrations: loadMigrations(migrationsDir()) });

  const client = postgres(url, { max: 4, onnotice: () => undefined });

  return {
    client,
    async truncate(): Promise<void> {
      /*
       * `truncate`, as the schema owner — and both halves of that are the
       * database telling the truth about itself.
       *
       * `delete` is refused: `event_log`, `initiative_score` and
       * `key_result_measurement` carry append-only triggers, and a row
       * recording that something happened cannot be unrecorded. `truncate`
       * bypasses row triggers, which is what a reset needs and what an
       * application must never be able to do — so it needs a privilege the
       * application role does not have.
       *
       * The first time this ran it failed with "event_log is append-only;
       * DELETE is refused", which is the guard working exactly as written.
       *
       * One statement listing every table, so foreign keys are satisfied
       * without `cascade` — `cascade` would silently empty a table nobody
       * listed, which is how a new table quietly escapes the reset.
       */
      await owner`truncate ${owner(TABLES as unknown as string[])} restart identity`;

      /*
       * `write_switch` is reset rather than truncated (W14).
       *
       * It is a singleton whose row the migration inserts, and reading it is
       * how the authorizer learns whether writes are frozen. Truncating it
       * would leave the table empty, `readWriteSwitch` would throw, and every
       * subsequent suite would fail somewhere far from the cause — so the reset
       * restores the released state instead of removing the row.
       */
      await owner`
        UPDATE write_switch
           SET engaged = false, mode = 'outward', changed_at = NULL,
               changed_by = NULL, reason = NULL
         WHERE id = 'singleton'`;
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
      await owner.end({ timeout: 5 });
    },
  };
}

/**
 * Where the migrations are, from a test running out of `src`.
 *
 * `defaultMigrationsDir()` resolves relative to the *compiled* `@prisme/db`, and
 * a Vitest run imports the built package — so it already points at
 * `packages/db/migrations`. Being explicit costs nothing and survives a change
 * to how the package is built.
 */
function migrationsDir(): string {
  return new URL('../../../../packages/db/migrations', import.meta.url).pathname;
}
