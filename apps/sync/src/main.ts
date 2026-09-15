#!/usr/bin/env node
/**
 * prisme-sync entrypoint — the CronJob binary.
 *
 * W00 builds the **harness** and nothing else: configuration, logging with a
 * run ID, the sync window, the advisory lock that keeps a scheduled pass from
 * overlapping a manual one, the metrics, and an exit code the cluster can read.
 * The reconciler itself belongs to W04, and is deliberately absent — a stubbed
 * reconciler that "succeeds" is worse than none, because the CronJob goes green
 * and the drift metric stays at zero.
 *
 * This image is the same build as prisme-api (docs/15-runtime.md §1), so the
 * scheduled run and the force-sync button are provably one code path.
 *
 * It runs no migration. Ever.
 */
import { loadConfigOrExit } from '@prisme/config';
import { createDatabase, withAdvisoryLock, RECONCILER_LOCK_ID } from '@prisme/db';
import { createLogger, createMetrics, withNewRun } from '@prisme/observability';
import { shouldRunNow } from './window.js';

/** sysexits-ish: 0 done, 75 temporarily unavailable (lock held), 1 failed. */
const EXIT_OK = 0;
const EXIT_LOCKED = 75;
const EXIT_FAILED = 1;

const config = loadConfigOrExit({ service: 'sync' });
const logger = createLogger({ service: 'prisme-sync', level: config.logLevel });
const metrics = createMetrics({ collectDefaults: false });

async function main(): Promise<number> {
  const decision = shouldRunNow(
    {
      enabled: config.sync.enabled,
      windowStart: config.sync.windowStart,
      windowEnd: config.sync.windowEnd,
      timezone: config.timezone,
    },
    new Date(),
  );

  if (!decision.shouldRun) {
    // Not an error: a CronJob that fires outside the window should exit clean.
    logger.info('pass skipped', { reason: decision.reason });
    return EXIT_OK;
  }

  const database = createDatabase({
    connectionString: config.databaseUrl as string,
    maxConnections: 2,
    applicationName: 'prisme-sync',
  });

  try {
    const startedAt = Date.now();
    const outcome = await withAdvisoryLock(database.client, RECONCILER_LOCK_ID, () => {
      logger.info('pass started', { writeEnabled: config.sync.writeEnabled });

      // ── W04 attaches the reconciler here. ───────────────────────────────
      // It must stay level-triggered (ADR-0009) and must honour the write
      // freeze: `config.sync.writeEnabled` ships false, and `plan` runs before
      // `apply` on every write path.
      logger.warn('no reconciler is registered yet; this pass did nothing', {
        owner: 'W04',
      });
      return Promise.resolve({ actions: 0 });
    });

    if (!outcome.acquired) {
      logger.info('another pass holds the lock; skipping rather than queueing');
      return EXIT_LOCKED;
    }

    const durationSeconds = (Date.now() - startedAt) / 1000;
    metrics.syncDuration.observe(durationSeconds);
    metrics.syncLastSuccessTimestamp.set(Date.now() / 1000);
    logger.info('pass complete', { durationSeconds, actions: outcome.result?.actions ?? 0 });
    return EXIT_OK;
  } finally {
    await database.close();
  }
}

withNewRun('cron', () => main())
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    logger.fatal('pass failed', { error });
    process.exit(EXIT_FAILED);
  });
