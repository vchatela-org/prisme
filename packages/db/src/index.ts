export { createDatabase } from './client.js';
export type { Database, DatabaseHandle, CreateDatabaseOptions } from './client.js';

export { withTransaction } from './tx.js';
export type { Transaction, TransactionOptions } from './tx.js';

export {
  loadMigrations,
  parseMigrationFile,
  planMigrations,
  runMigrations,
  currentSchemaVersion,
  expectedSchemaVersion,
  defaultMigrationsDir,
  checksum,
  MIGRATION_LOCK_ID,
  BOOKKEEPING_TABLE,
} from './migrations.js';
export type {
  Migration,
  AppliedMigration,
  MigrationPlan,
  RunMigrationsOptions,
  RunMigrationsResult,
} from './migrations.js';

export { withAdvisoryLock, RECONCILER_LOCK_ID } from './lock.js';
export type { AdvisoryLockResult } from './lock.js';

export { checkReadiness } from './health.js';
export type { ReadinessReport, ReadinessState, CheckReadinessOptions } from './health.js';
