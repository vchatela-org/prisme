#!/usr/bin/env node
/**
 * prisme-sync — the CronJob binary and the command line.
 *
 * ```
 *   prisme-sync plan          read everything, decide nothing, print the diff
 *   prisme-sync apply         the same plan, executed
 *   prisme-sync               apply, which is what the CronJob runs
 *   prisme-sync adopt --plan  the adoption scan: candidates, coverage, create audit
 *   prisme-sync backfill --from <date>
 *                             completion history → per-area capacity actuals
 *   prisme-sync create --plan | --apply
 *                             drain the creation ledger: what the UI asked to
 *                             exist outward, and does not yet
 * ```
 *
 * `apply` also drains the ledger before it reconciles, in the same lock. The
 * order matters: a project created this pass has to have its external id
 * before the anchors that live in it are planned, or the reconciler places
 * them by the area mapping and the next pass moves them.
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
import {
  createFrozenCreationWriter,
  createFrozenWriter,
  createTaskToolCreationWriter,
  createTaskToolWriter,
} from '@prisme/connectors/write';
import { loadConfigOrExit } from '@prisme/config';
import { createDatabase, withAdvisoryLock, RECONCILER_LOCK_ID } from '@prisme/db';
import { createLogger, createMetrics, currentRunContext, withNewRun } from '@prisme/observability';
import { adopt } from './adoption/run.js';
import { createAdoptionStore } from './adoption/store.js';
import { backfillFrom } from './backfill/cli.js';
import { backfill } from './backfill/run.js';
import { createBackfillStore } from './backfill/store.js';
import { createMode, DEFAULT_MAX_PER_PASS } from './create/cli.js';
import { converge } from './create/run.js';
import { createCreationStore } from './create/store.js';
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

function modeFrom(
  argv: readonly string[],
): 'plan' | 'apply' | 'adopt' | 'backfill' | 'create' | undefined {
  const [command] = argv.slice(2);
  if (command === undefined || command === 'apply') return 'apply';
  if (command === 'plan') return 'plan';
  if (command === 'adopt') return 'adopt';
  if (command === 'backfill') return 'backfill';
  if (command === 'create') return 'create';
  return undefined;
}

/** The creating writer, or the one that cannot reach an API. */
function creationWriter(
  transport: ReturnType<typeof createFetchTransport>,
  metrics: {
    recordRequest: (sample: { tool: string; status: string }) => void;
  },
) {
  return config.sync.writeEnabled
    ? createTaskToolCreationWriter({
        token: config.tasktoolApiToken as string,
        transport,
        metrics,
      })
    : createFrozenCreationWriter();
}

/**
 * `adopt` accepts `--plan` and refuses anything else.
 *
 * The flag is redundant — this command has no other mode and cannot have one —
 * and it is required anyway, because a bare `prisme-sync adopt` reads like a
 * verb that does something. Somebody typing it at three in the morning against
 * a live workspace should have had to say the word `plan` first.
 */
function adoptIsPlanOnly(argv: readonly string[]): boolean {
  const flags = argv.slice(3);
  return flags.length === 1 && flags[0] === '--plan';
}

async function main(): Promise<number> {
  const mode = modeFrom(process.argv);
  if (mode === undefined) {
    process.stderr.write(
      'usage: prisme-sync [plan|apply|adopt --plan|backfill --from YYYY-MM-DD|create --plan|--apply]\n',
    );
    return EXIT_FAILED;
  }

  const convergeMode = mode === 'create' ? createMode(process.argv) : undefined;
  if (mode === 'create' && convergeMode === undefined) {
    process.stderr.write(
      'usage: prisme-sync create --plan | --apply\n' +
        'The mode is required: `create` on its own reads like a verb that does something,\n' +
        'and what it would do is add objects to a real workspace.\n',
    );
    return EXIT_FAILED;
  }

  const backfillStart = mode === 'backfill' ? backfillFrom(process.argv) : undefined;
  if (mode === 'backfill' && backfillStart === undefined) {
    process.stderr.write(
      'usage: prisme-sync backfill --from YYYY-MM-DD\n' +
        'The start date is required: no default is right. A short one reports a measured\n' +
        'balance factor built on a fortnight, and a long one pages years off a rate-limited API.\n',
    );
    return EXIT_FAILED;
  }

  if (mode === 'adopt' && !adoptIsPlanOnly(process.argv)) {
    process.stderr.write(
      'usage: prisme-sync adopt --plan\n' +
        'Adoption is plan-only: it proposes, and a human decides in the queue at /adoption.\n',
    );
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
    if (mode === 'adopt') {
      // The same advisory lock as a reconciler pass, and for a reason beyond
      // tidiness: the scan reads what is unbound, and a pass binding things
      // underneath it would produce a queue proposing work that was decided
      // while the scan was looking elsewhere.
      const outcome = await withAdvisoryLock(database.client, RECONCILER_LOCK_ID, async () => {
        logger.info('adoption scan started');
        return adopt({
          store: createAdoptionStore(database.client),
          taskClient: createTaskToolClient({
            token: config.tasktoolApiToken as string,
            transport,
            metrics: connectorMetrics,
          }),
          // No document-tool client: nothing in this repository loads the role
          // bindings yet, so the stores are not addressable. The scan runs on
          // the task tool alone and says so in its header rather than pretending
          // it read everything — see the W12 journal entry's follow-ups.
          now: () => new Date(),
          persist: true,
        });
      });

      if (!outcome.acquired) {
        logger.info('a reconciler pass holds the lock; skipping rather than queueing');
        return EXIT_LOCKED;
      }
      /* c8 ignore next -- the lock was acquired, so a result exists */
      if (outcome.result === undefined) return EXIT_FAILED;

      // Instance data. Printed to a terminal, never pasted into the repository.
      process.stdout.write(`${outcome.result.report}\n`);

      logger.info('adoption scan complete', {
        queue: outcome.result.scan.queue.length,
        certain: outcome.result.scan.autoLinkable.length,
        manual: outcome.result.coverage.queue.manualRemainder,
        linkCoveragePct: outcome.result.coverage.linkCoveragePct,
        wouldCreate: outcome.result.coverage.wouldCreate.length,
      });

      // A create risk is not a failure of this command — it is the finding the
      // command exists to produce, and it exits clean so that reading it is a
      // decision rather than a broken pipeline.
      return EXIT_OK;
    }

    if (mode === 'backfill') {
      // The same advisory lock as every other pass. Not for correctness — the
      // backfill's writes are idempotent by primary key and a concurrent
      // reconciler pass could not corrupt them — but because a multi-year
      // backfill holds a rate-limited API open for minutes, and a reconciler
      // pass queued behind it is a pass that runs late rather than one that
      // fights it for quota.
      const outcome = await withAdvisoryLock(database.client, RECONCILER_LOCK_ID, async () => {
        logger.info('backfill started');
        return backfill({
          store: createBackfillStore(database.client),
          taskClient: createTaskToolClient({
            token: config.tasktoolApiToken as string,
            transport,
            metrics: connectorMetrics,
          }),
          // No document-tool client, for the reason W12 recorded: nothing in
          // this repository loads the role bindings, so the processes store is
          // not addressable and the declared-duration tier is unavailable. The
          // report says so rather than passing estimates off as measurements.
          from: backfillStart as Date,
          now: () => new Date(),
          defaultMinutes: config.capacity.defaultTaskMinutes,
          onSlice: (progress) => {
            logger.info('window fetched', {
              window: progress.index,
              of: progress.total,
              completions: progress.fetched,
            });
          },
        });
      });

      if (!outcome.acquired) {
        logger.info('another pass holds the lock; skipping rather than queueing');
        return EXIT_LOCKED;
      }
      /* c8 ignore next -- the lock was acquired, so a result exists */
      if (outcome.result === undefined) return EXIT_FAILED;

      // Instance data — unmapped project ids and ritual names. Printed to a
      // terminal, never pasted into the repository.
      process.stdout.write(`${outcome.result.report}\n`);

      logger.info('backfill complete', {
        fetched: outcome.result.fetched,
        attributed: outcome.result.attribution.attributed.length,
        unattributableLocations: outcome.result.attribution.gaps.length,
        weeks: outcome.result.weeks.length,
        adherencePeriods: outcome.result.adherence.length,
      });

      // An unmapped project is a finding, not a failure: the command exits
      // clean so that acting on it is a decision rather than a broken pipeline.
      return EXIT_OK;
    }

    if (mode === 'create') {
      // The same advisory lock as a reconciler pass, and for a real reason
      // rather than tidiness: this pass creates the projects and sections a
      // reconciler pass then places anchors into. The two running together
      // would have the reconciler decide a location from a project that is
      // being made underneath it.
      const outcome = await withAdvisoryLock(database.client, RECONCILER_LOCK_ID, async () => {
        logger.info('converge started', {
          mode: convergeMode,
          writeEnabled: config.sync.writeEnabled,
        });
        return converge({
          mode: convergeMode as 'plan' | 'apply',
          store: createCreationStore(database.client),
          writer: creationWriter(transport, connectorMetrics),
          writeEnabled: config.sync.writeEnabled,
          maxPerPass: DEFAULT_MAX_PER_PASS,
          now: () => new Date(),
        });
      });

      if (!outcome.acquired) {
        logger.info('another pass holds the lock; skipping rather than queueing');
        return EXIT_LOCKED;
      }
      /* c8 ignore next -- the lock was acquired, so a result exists */
      if (outcome.result === undefined) return EXIT_FAILED;

      // Instance data — section names and capture content. Printed to a
      // terminal, never pasted into the repository.
      process.stdout.write(`${outcome.result.report}\n`);

      logger.info('converge complete', {
        created: outcome.result.created,
        failed: outcome.result.failed,
        blocked: outcome.result.plan.blocked,
      });

      if (outcome.result.stopped !== undefined) {
        logger.warn('converge stopped', { reason: outcome.result.stopped });
      }

      if (outcome.result.refused !== undefined) {
        // The write freeze is the configured, expected state of a fresh
        // deployment, so it exits clean. Same judgement as a reconciler pass
        // refused for the same reason.
        logger.info('converge refused', { reason: outcome.result.refused });
        return EXIT_OK;
      }

      // A blocked intent is a finding, not a failure of the command. A
      // *failed* one is: something was attempted against a real workspace and
      // did not work, and a green pipeline would hide it.
      return outcome.result.failed > 0 ? EXIT_FAILED : EXIT_OK;
    }

    const startedAt = Date.now();
    const outcome = await withAdvisoryLock(database.client, RECONCILER_LOCK_ID, async () => {
      logger.info('pass started', { mode, writeEnabled: config.sync.writeEnabled });

      /*
       * Drain the creation ledger first, in this same lock.
       *
       * The order is load-bearing: a project created this pass must have its
       * external id before the reconciler plans the anchors that live in it,
       * or they are placed by the area mapping and the next pass moves them —
       * which a person sees as prisme putting their work in the wrong place
       * and then correcting itself fifteen minutes later.
       *
       * A `plan` converges nothing, because `plan` has no side effects.
       */
      if (mode === 'apply') {
        const drained = await converge({
          mode: 'apply',
          store: createCreationStore(database.client),
          writer: creationWriter(transport, connectorMetrics),
          writeEnabled: config.sync.writeEnabled,
          maxPerPass: DEFAULT_MAX_PER_PASS,
          now: () => new Date(),
        });
        if (drained.created > 0 || drained.failed > 0) {
          logger.info('creation ledger drained', {
            created: drained.created,
            failed: drained.failed,
            blocked: drained.plan.blocked,
          });
        }
      }

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
