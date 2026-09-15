#!/usr/bin/env node
/**
 * The migration entrypoint.
 *
 * This is a **standalone binary run as a Job before rollout**. It is not
 * imported by any application, and nothing calls `runMigrations` at start-up:
 * two replicas booting together would race on DDL, and the failure is
 * intermittent and awful to debug (docs/15-runtime.md §3).
 *
 *   node dist/bin/migrate.js            apply everything pending
 *   node dist/bin/migrate.js --status   report without changing anything
 *   node dist/bin/migrate.js --dry-run  same, and exit non-zero if work is pending
 *
 * It uses `MIGRATION_DATABASE_URL` — the DDL role. The application role cannot
 * run this even if someone tries.
 */
import { loadConfigOrExit } from '@prisme/config';
import { createLogger, withNewRun } from '@prisme/observability';
import { createDatabase } from '../client.js';
import {
  currentSchemaVersion,
  expectedSchemaVersion,
  loadMigrations,
  runMigrations,
} from '../migrations.js';

const args = new Set(process.argv.slice(2));
const statusOnly = args.has('--status');
const dryRun = args.has('--dry-run');

const config = loadConfigOrExit({ service: 'migrate' });
const log = createLogger({ service: 'prisme-migrate', level: config.logLevel });

async function main(): Promise<number> {
  const migrations = loadMigrations();
  const handle = createDatabase({
    connectionString: config.migrationDatabaseUrl as string,
    maxConnections: 1,
    applicationName: 'prisme-migrate',
    // DDL on a table with data can legitimately take a while; the guard is the
    // Job's own deadline, not a statement timeout that aborts half way.
    statementTimeoutMs: 0,
  });

  try {
    if (statusOnly) {
      const current = await currentSchemaVersion(handle.client).catch(() => '');
      const expected = expectedSchemaVersion(migrations);
      log.info('schema status', {
        current: current === '' ? null : current,
        expected,
        upToDate: current === expected,
      });
      return current === expected ? 0 : 1;
    }

    const result = await runMigrations({
      client: handle.client,
      migrations,
      dryRun,
      onEvent: (event) => log.info(event.message, event.fields),
    });

    log.info('migration complete', {
      applied: result.applied.length,
      pending: result.pending.length,
      alreadyApplied: result.skipped,
      schemaVersion: result.schemaVersion,
      dryRun,
    });

    // A dry run is a question, and "work is pending" is a non-zero answer, so a
    // pre-rollout check can branch on it.
    if (dryRun) return result.pending.length === 0 ? 0 : 1;
    return 0;
  } finally {
    await handle.close();
  }
}

withNewRun('migrate', () => main())
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    log.fatal('migration failed', { error });
    process.exit(1);
  });
