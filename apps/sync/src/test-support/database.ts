// Imported rather than read off the global, for the same reason
// `apps/api/src/test-support/database.ts` does it: the repository restricts the
// *global* `process` so that configuration goes through `@prisme/config`, and a
// test harness choosing its own database is not application configuration.
import process from 'node:process';
import postgres from 'postgres';
import { createDatabase, loadMigrations, runMigrations } from '@prisme/db';

/**
 * A real PostgreSQL, for the sync integration suites.
 *
 * Three suites (`adoption/store`, `backfill/store`, `create/store`) each built
 * their own connection, and each built it as `postgres(url, …)` — a **bare
 * driver client**, where `main.ts` builds the application's through
 * `createDatabase` and gets a Drizzle-wrapped one back. The difference is not
 * cosmetic: Drizzle replaces the shared client's serializers, so a `jsonb`
 * object handed to a tagged template reaches the socket writer as an object
 * rather than as text.
 *
 * Two production defects were found the hard way and were **invisible here**
 * for exactly that reason — W04's `timestamptz` and W15's `sql.json()`. Both
 * were fixed at the call site; neither fixed the class. A suite that builds
 * its own client is a suite testing a different client, so this module builds
 * the application's, once, and the three suites share it.
 *
 * It does not share the `truncate` table list, which stays per-suite on
 * purpose: `apps/api/src/test-support/database.ts` records why (`cascade`
 * would silently empty a table nobody listed), and a list this module owned
 * would be a fourth thing to keep in step rather than one fewer.
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

/** The connection migrations run on — the migration role, which owns the schema. */
export function testMigrationDatabaseUrl(): string {
  return envUrl('PRISME_TEST_MIGRATION_DATABASE_URL') ?? (testDatabaseUrl() as string);
}

/**
 * Whether the database-backed suites run.
 *
 * **In CI it is never a choice.** If `CI` is set and no database is configured
 * this throws rather than skipping, because a suite that skips itself has
 * stopped running while still reporting green.
 */
export const describeWithDatabase: 'run' | 'skip' = (() => {
  if (testDatabaseUrl() !== undefined) return 'run';
  if (process.env['CI'] !== undefined && process.env['CI'] !== '') {
    throw new Error(
      'PRISME_TEST_DATABASE_URL is unset in CI: this suite would skip silently, ' +
        'which reports green for tests that did not run',
    );
  }
  return 'skip';
})();

export interface SyncTestDatabase {
  /** The application's client, built exactly as `main.ts` builds it. */
  readonly client: postgres.Sql;
  /** The schema owner, for migrations and for `truncate`. */
  readonly owner: postgres.Sql;
  /** Empty the given tables, children first. The caller supplies the list. */
  truncate(tables: readonly string[]): Promise<void>;
  close(): Promise<void>;
}

/** Where the migrations are, from a suite running out of `src`. */
function migrationsDir(): string {
  return new URL('../../../../packages/db/migrations', import.meta.url).pathname;
}

export async function openTestDatabase(): Promise<SyncTestDatabase> {
  const url = testDatabaseUrl();
  if (url === undefined) {
    throw new Error('PRISME_TEST_DATABASE_URL is not set; the caller should have skipped');
  }

  // bare-client-ok: DDL and `truncate` only, never a tagged-template write, so
  // the serializers the application depends on do not apply to it. The
  // append-only tables refuse a `DELETE`, and a reset needs a privilege the
  // application role does not have.
  const owner = postgres(testMigrationDatabaseUrl(), { max: 1, onnotice: () => undefined });
  await runMigrations({ client: owner, migrations: loadMigrations(migrationsDir()) });

  const handle = createDatabase({
    connectionString: url,
    maxConnections: 2,
    applicationName: 'prisme-sync-test',
  });

  return {
    client: handle.client,
    owner,
    async truncate(tables: readonly string[]): Promise<void> {
      // One statement listing every table, so foreign keys are satisfied
      // without `cascade`.
      await owner.unsafe(`truncate table ${tables.join(', ')}`);
    },
    async close(): Promise<void> {
      await handle.close();
      await owner.end({ timeout: 5 });
    },
  };
}
