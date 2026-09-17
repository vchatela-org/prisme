#!/usr/bin/env node
/**
 * prisme-sync — the CronJob binary and the command line.
 *
 * ```
 *   prisme-sync plan     read everything, decide nothing, print the diff
 *   prisme-sync apply    the same plan, executed
 *   prisme-sync          apply, which is what the CronJob runs
 * ```
 *
 * `plan` has no side effects and is free to run at any time, including outside
 * the sync window: it is a human asking a question. `apply` honours the window
 * (docs/16-sync.md §2) and the advisory lock, so a scheduled pass and a manual
 * one cannot overlap.
 *
 * This image is the same build as prisme-api (docs/15-runtime.md §1), and the
 * force-sync button calls `reconcile` in process — the same function this file
 * calls, which is the point.
 *
 * It runs no migration. Ever.
 */
import { createFetchTransport, createTaskToolClient } from '@prisme/connectors';
import { createFrozenWriter, createTaskToolWriter } from '@prisme/connectors/write';
import { loadConfigOrExit } from '@prisme/config';
import { createDatabase, withAdvisoryLock, RECONCILER_LOCK_ID } from '@prisme/db';
import { createLogger, createMetrics, currentRunContext, withNewRun } from '@prisme/observability';
import { createPostgresStore } from './state/postgres.js';
import { reconcile } from './run.js';
import { shouldRunNow } from './window.js';

/** sysexits-ish: 0 done, 75 temporarily unavailable (lock held), 1 failed. */
const EXIT_OK = 0;
const EXIT_LOCKED = 75;
const EXIT_FAILED = 1;

const config = loadConfigOrExit({ service: 'sync' });
const logger = createLogger({ service: 'prisme-sync', level: config.logLevel });
const metrics = createMetrics({ collectDefaults: false });

function modeFrom(argv: readonly string[]): 'plan' | 'apply' | undefined {
  const [command] = argv.slice(2);
  if (command === undefined || command === 'apply') return 'apply';
  if (command === 'plan') return 'plan';
  return undefined;
}

async function main(): Promise<number> {
  const mode = modeFrom(process.argv);
  if (mode === undefined) {
    process.stderr.write('usage: prisme-sync [plan|apply]\n');
    return EXIT_FAILED;
  }

  if (mode === 'apply') {
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
      // Not an error: a CronJob that fires outside the window exits clean.
      logger.info('pass skipped', { reason: decision.reason });
      return EXIT_OK;
    }
  }

  const database = createDatabase({
    connectionString: config.databaseUrl as string,
    maxConnections: 2,
    applicationName: 'prisme-sync',
  });

  const transport = createFetchTransport();
  const connectorMetrics = {
    recordRequest: (sample: { tool: string; status: string }) => {
      metrics.externalRequests.inc({ tool: sample.tool, status: sample.status });
    },
  };

  try {
    const startedAt = Date.now();
    const outcome = await withAdvisoryLock(database.client, RECONCILER_LOCK_ID, async () => {
      logger.info('pass started', { mode, writeEnabled: config.sync.writeEnabled });

      return reconcile({
        mode,
        store: createPostgresStore(database.client),
        taskClient: createTaskToolClient({
          token: config.tasktoolApiToken as string,
          transport,
          metrics: connectorMetrics,
        }),
        // The freeze is structural rather than a branch: with the write freeze
        // on, the object `apply` holds cannot reach an API at all.
        writer: config.sync.writeEnabled
          ? createTaskToolWriter({
              token: config.tasktoolApiToken as string,
              transport,
              metrics: connectorMetrics,
            })
          : createFrozenWriter(),
        writeEnabled: config.sync.writeEnabled,
        createThreshold: config.sync.createThreshold,
        baseUrl: config.baseUrl,
        runId: currentRunContext()?.runId ?? 'run',
        now: () => new Date(),
      });
    });

    if (!outcome.acquired) {
      logger.info('another pass holds the lock; skipping rather than queueing');
      return EXIT_LOCKED;
    }

    const result = outcome.result;
    /* c8 ignore next -- the lock was acquired, so a result exists */
    if (result === undefined) return EXIT_FAILED;

    // The plan is a user interface and goes to stdout as written. It carries
    // real titles at runtime; it must never be pasted into this repository.

    process.stdout.write(`${result.report}\n`);

    for (const [tag, count] of Object.entries(result.plan.counts)) {
      if (count > 0) metrics.syncActions.inc({ type: tag }, count);
    }
    metrics.syncConflicts.inc(result.applied?.conflicts ?? 0);
    metrics.syncDriftObjects.set(result.drift);

    const durationSeconds = (Date.now() - startedAt) / 1000;
    metrics.syncDuration.observe(durationSeconds);

    const failures = result.applied?.failures ?? [];
    for (const failure of failures) {
      logger.error('action failed', { reason: failure.reason, tag: failure.action.tag });
    }

    if (result.applied?.stopped !== undefined) {
      logger.fatal('pass stopped', { reason: result.applied.stopped });
      return EXIT_FAILED;
    }

    if (result.applied?.refused !== undefined) {
      logger.warn('plan refused', { reason: result.applied.refused });
      // The write freeze is the configured, expected state of a fresh
      // deployment; a plan over the create threshold is a surprise.
      return config.sync.writeEnabled ? EXIT_FAILED : EXIT_OK;
    }

    metrics.syncLastSuccessTimestamp.set(Date.now() / 1000);
    logger.info('pass complete', {
      mode,
      durationSeconds,
      full: result.full,
      counts: result.plan.counts,
      applied: result.applied?.applied ?? 0,
      drift: result.drift,
    });

    return failures.length > 0 ? EXIT_FAILED : EXIT_OK;
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
