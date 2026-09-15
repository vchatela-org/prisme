import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import type postgres from 'postgres';

/**
 * Forward-only migrations, applied by a Job before rollout — never at start-up.
 *
 * Two replicas starting at once must not race on DDL, and a failed migration
 * must block the rollout rather than leave a half-migrated cluster serving
 * traffic (docs/15-runtime.md §3). There is no `down`: each migration has a
 * written-down reversal procedure that a human has run at least once, which is
 * worth more than an auto-generated rollback nobody has tried.
 *
 * The SQL executed here is a repository artifact, read from files this image
 * ships. It is never user input, never a request body, and never a value from
 * an external tool.
 */

/** One advisory lock for the whole runner. Two Jobs queue rather than collide. */
export const MIGRATION_LOCK_ID = 8_675_309;

export const BOOKKEEPING_TABLE = 'prisme_migration';

export interface Migration {
  /** Sort key. The numeric prefix of the filename, kept as a string. */
  readonly version: string;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string;
  readonly checksum: string;
}

export interface MigrationPlan {
  readonly pending: readonly Migration[];
  readonly skipped: readonly Migration[];
  /** Reasons the plan cannot run at all. Non-empty means refuse. */
  readonly problems: readonly string[];
}

const FILENAME = /^(\d{4,})[_-](.+)\.sql$/;

export function checksum(sql: string): string {
  // Normalize line endings so a checkout on another platform is not a drift alarm.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function parseMigrationFile(filename: string, sql: string): Migration {
  const match = FILENAME.exec(filename);
  if (!match) {
    throw new Error(
      `migration filename "${filename}" must look like 0001_description.sql — the numeric prefix is the apply order`,
    );
  }
  return {
    version: match[1] as string,
    name: (match[2] as string).replace(/[_-]+/g, ' '),
    filename,
    sql,
    checksum: checksum(sql),
  };
}

/** The directory this package ships migrations in. */
export function defaultMigrationsDir(): string {
  // dist/migrations.js → ../migrations
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

export function loadMigrations(dir: string = defaultMigrationsDir()): Migration[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const migrations = files.map((name) =>
    parseMigrationFile(name, readFileSync(join(dir, name), 'utf8')),
  );

  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(
        `two migrations share version ${migration.version}; apply order is ambiguous`,
      );
    }
    seen.add(migration.version);
  }

  return migrations.sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * Decide what to apply. Pure: no database, no clock.
 *
 * Three things make it refuse rather than guess, because each means the image
 * and the database disagree about history:
 *
 *   - a migration whose recorded checksum no longer matches the file (it was
 *     edited after it ran);
 *   - a migration recorded in the database that this image does not ship (the
 *     database is ahead of the binary — a rollback to an older image);
 *   - a gap: an unapplied migration older than one that is already applied.
 */
export function planMigrations(
  shipped: readonly Migration[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  const appliedByVersion = new Map(applied.map((entry) => [entry.version, entry]));
  const shippedVersions = new Set(shipped.map((entry) => entry.version));

  const problems: string[] = [];
  const pending: Migration[] = [];
  const skipped: Migration[] = [];

  for (const entry of applied) {
    if (!shippedVersions.has(entry.version)) {
      problems.push(
        `migration ${entry.version} (${entry.name}) is applied in the database but not shipped by this image — the database is ahead of the binary`,
      );
    }
  }

  let highestApplied = '';
  for (const entry of applied) {
    if (entry.version > highestApplied) highestApplied = entry.version;
  }

  for (const migration of shipped) {
    const record = appliedByVersion.get(migration.version);
    if (record === undefined) {
      if (highestApplied !== '' && migration.version < highestApplied) {
        problems.push(
          `migration ${migration.version} (${migration.name}) has never been applied, but a later one has — migrations are forward-only and must not be back-filled`,
        );
      }
      pending.push(migration);
      continue;
    }
    if (record.checksum !== migration.checksum) {
      problems.push(
        `migration ${migration.version} (${migration.name}) was changed after it was applied — its checksum no longer matches. Write a new migration instead of editing an applied one`,
      );
      continue;
    }
    skipped.push(migration);
  }

  return { pending, skipped, problems };
}

/** The version `/readyz` compares against, i.e. the newest migration this image ships. */
export function expectedSchemaVersion(shipped: readonly Migration[] = loadMigrations()): string {
  return shipped.length === 0 ? '' : (shipped[shipped.length - 1] as Migration).version;
}

export interface RunMigrationsResult {
  readonly applied: readonly { version: string; name: string; durationMs: number }[];
  /** Versions the plan selected. Equals `applied` unless this was a dry run. */
  readonly pending: readonly string[];
  readonly skipped: number;
  readonly schemaVersion: string;
}

export interface RunMigrationsOptions {
  readonly client: postgres.Sql;
  readonly migrations?: readonly Migration[];
  readonly onEvent?: (event: { message: string; fields?: Record<string, unknown> }) => void;
  /** Report what would happen and change nothing. */
  readonly dryRun?: boolean;
}

async function ensureBookkeeping(client: postgres.Sql): Promise<void> {
  await client`
    create table if not exists prisme_migration (
      version      text primary key,
      name         text        not null,
      checksum     text        not null,
      applied_at   timestamptz not null default now(),
      duration_ms  integer     not null
    )
  `;
}

async function readApplied(client: postgres.Sql): Promise<AppliedMigration[]> {
  const rows = await client<{ version: string; name: string; checksum: string }[]>`
    select version, name, checksum from prisme_migration order by version
  `;
  return rows.map((row) => ({ version: row.version, name: row.name, checksum: row.checksum }));
}

/**
 * Apply every pending migration, in order, each in its own transaction.
 *
 * Idempotent: running it twice applies nothing the second time. That is a
 * property of the bookkeeping table, not of the SQL — a migration is free to be
 * non-idempotent on its own.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<RunMigrationsResult> {
  const { client } = options;
  const shipped = options.migrations ?? loadMigrations();
  const emit = options.onEvent ?? (() => undefined);

  // Serialize concurrent runners. A pre-rollout Job should be alone, but an
  // operator running the entrypoint by hand at the same moment should queue,
  // not collide.
  await client`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
  try {
    await ensureBookkeeping(client);
    const applied = await readApplied(client);
    const plan = planMigrations(shipped, applied);

    if (plan.problems.length > 0) {
      throw new Error(
        'refusing to migrate:\n' + plan.problems.map((problem) => `  - ${problem}`).join('\n'),
      );
    }

    emit({
      message: 'migration plan',
      fields: {
        pending: plan.pending.map((migration) => migration.version),
        alreadyApplied: plan.skipped.length,
        dryRun: options.dryRun === true,
      },
    });

    const results: { version: string; name: string; durationMs: number }[] = [];

    if (options.dryRun !== true) {
      for (const migration of plan.pending) {
        const startedAt = Date.now();
        await client.begin(async (tx) => {
          // Repository artifact, not input. See the note at the top of this file.
          await tx.unsafe(migration.sql);
          const durationMs = Date.now() - startedAt;
          await tx`
            insert into prisme_migration (version, name, checksum, duration_ms)
            values (${migration.version}, ${migration.name}, ${migration.checksum}, ${durationMs})
          `;
        });
        const durationMs = Date.now() - startedAt;
        results.push({ version: migration.version, name: migration.name, durationMs });
        emit({
          message: 'migration applied',
          fields: { version: migration.version, name: migration.name, durationMs },
        });
      }
    }

    return {
      applied: results,
      pending: plan.pending.map((migration) => migration.version),
      skipped: plan.skipped.length,
      schemaVersion: expectedSchemaVersion(shipped),
    };
  } finally {
    await client`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
  }
}

/** The newest version recorded in the database, or `''` when nothing has run. */
export async function currentSchemaVersion(client: postgres.Sql): Promise<string> {
  const rows = await client<{ version: string }[]>`
    select version from prisme_migration order by version desc limit 1
  `;
  return rows[0]?.version ?? '';
}
