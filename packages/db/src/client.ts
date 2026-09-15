import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * The database client everything else uses.
 *
 * Two connection strings exist and they are not interchangeable
 * (docs/15-runtime.md §3, *Roles*):
 *
 *   - `DATABASE_URL`           application role — SELECT/INSERT/UPDATE/DELETE, **no DDL**
 *   - `MIGRATION_DATABASE_URL` migration role   — DDL, used only by the pre-rollout Job
 *
 * An application process is given the first and can therefore not alter the
 * schema even if some future code asks it to. That is the point of the split;
 * do not "temporarily" hand an app the migration role.
 */

export type Database = PostgresJsDatabase<Record<string, never>>;

export interface DatabaseHandle {
  readonly db: Database;
  /** The underlying driver. Needed by the migration runner and by `close`. */
  readonly client: postgres.Sql;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  readonly connectionString: string;
  /** Keep small: a single-instance PostgreSQL, a personal workload. */
  readonly maxConnections?: number;
  readonly connectTimeoutSeconds?: number;
  readonly statementTimeoutMs?: number;
  readonly applicationName?: string;
}

export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const client = postgres(options.connectionString, {
    max: options.maxConnections ?? 10,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    idle_timeout: 30,
    // A query with no upper bound holds a connection until someone notices.
    connection: {
      application_name: options.applicationName ?? 'prisme',
      statement_timeout: options.statementTimeoutMs ?? 15_000,
    },
    // prisme never interpolates a value into SQL. Prepared statements are the
    // default anyway; stating it here makes the intent unmissable.
    prepare: true,
    onnotice: () => {
      /* PostgreSQL notices are not application events. */
    },
  });

  return {
    db: drizzle(client),
    client,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
