#!/usr/bin/env node
/**
 * prisme-api entrypoint.
 *
 * Boot order matters and is deliberate:
 *
 *   1. load and validate configuration — exit 78 with the variable named if it is wrong;
 *   2. build the logger, so everything after this point is structured and redacted;
 *   3. open the database pool — but run no migration. Migrations are a Job
 *      before rollout (docs/15-runtime.md §3); two replicas booting together
 *      would race on DDL;
 *   4. listen;
 *   5. on SIGTERM, stop routing, drain, close the pool, exit 0.
 */
import { serve } from '@hono/node-server';
import { loadConfigOrExit } from '@prisme/config';
import { createDatabase, checkReadiness, expectedSchemaVersion, loadMigrations } from '@prisme/db';
import { createLogger, createMetrics, currentRunContext, newRunId } from '@prisme/observability';
import { createApp } from './app.js';
import { createServices, SERVICE_DEFAULTS } from './services/index.js';
import { createPostgresStore } from './store/postgres.js';
import { createSyncRunner } from './sync/runner.js';

const config = loadConfigOrExit({ service: 'api' });
const logger = createLogger({ service: 'prisme-api', level: config.logLevel });
const metrics = createMetrics();

const schemaVersion = expectedSchemaVersion(loadMigrations());
const database = createDatabase({
  connectionString: config.databaseUrl as string,
  applicationName: 'prisme-api',
});

let shuttingDown = false;

/**
 * The service layer, built once at boot.
 *
 * `POST /sync` runs the reconciler **in this process**, behind the same
 * advisory lock the CronJob takes — the scheduled pass and the force-sync
 * button are one code path by construction (docs/16-sync.md §7).
 */
const services = createServices({
  store: createPostgresStore(database.client),
  runner: createSyncRunner({
    client: database.client,
    taskToolToken: config.tasktoolApiToken as string,
    writeEnabled: config.sync.writeEnabled,
    createThreshold: config.sync.createThreshold,
    baseUrl: config.baseUrl,
    runId: () => currentRunContext()?.runId ?? newRunId(),
    now: () => new Date(),
  }),
  config: {
    timezone: config.timezone,
    capacityWindowWeeks: config.capacity.windowWeeks,
    defaultTaskMinutes: config.capacity.defaultTaskMinutes,
    limits: SERVICE_DEFAULTS.limits,
    concurrentInitiatives: SERVICE_DEFAULTS.concurrentInitiatives,
    workingWeekdays: SERVICE_DEFAULTS.workingWeekdays,
    sync: {
      enabled: config.sync.enabled,
      writeEnabled: config.sync.writeEnabled,
      createThreshold: config.sync.createThreshold,
      windowStart: config.sync.windowStart,
      windowEnd: config.sync.windowEnd,
    },
  },
});

const app = createApp({
  config,
  logger,
  metrics,
  services,
  // No authorizer is installed until W14 lands, so every business route answers
  // 401. Deliberate: an instance that served data with nothing verifying who
  // asked would be a worse failure than one that serves none.
  isShuttingDown: () => shuttingDown,
  readiness: () => checkReadiness({ client: database.client, expected: schemaVersion }),
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  logger.info('listening', {
    port: info.port,
    schemaVersion,
    timezone: config.timezone,
    syncWriteEnabled: config.sync.writeEnabled,
  });
});

/**
 * Graceful shutdown.
 *
 * `/readyz` starts failing first so the load balancer stops sending new work,
 * then the listener closes, then the pool. The timer is the backstop: a request
 * that will not finish must not hold a rollout open forever.
 */
const SHUTDOWN_GRACE_MS = 10_000;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });

  const deadline = setTimeout(() => {
    logger.warn('shutdown deadline reached, exiting anyway');
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
  deadline.unref();

  server.close(() => {
    void database
      .close()
      .catch((error: unknown) => logger.error('closing the database pool failed', { error }))
      .finally(() => {
        logger.info('stopped');
        process.exit(0);
      });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal('unhandled rejection', { error: reason });
  process.exit(1);
});
