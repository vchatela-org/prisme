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
import { createAuth } from './auth/index.js';
import { createServices, SERVICE_DEFAULTS } from './services/index.js';
import { createPostgresStore } from './store/postgres.js';
import { createExternalDirectory } from './sync/directory.js';
import { createSyncMetricsRefresher } from './sync/metrics.js';
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
    taskToolBaseUrl: config.tasktoolBaseUrl,
    writeEnabled: config.sync.writeEnabled,
    createThreshold: config.sync.createThreshold,
    baseUrl: config.baseUrl,
    runId: () => currentRunContext()?.runId ?? newRunId(),
    now: () => new Date(),
  }),
  directory: createExternalDirectory({
    docToolToken: config.doctoolApiToken as string,
    docToolBaseUrl: config.doctoolBaseUrl,
    taskToolToken: config.tasktoolApiToken as string,
    taskToolBaseUrl: config.tasktoolBaseUrl,
  }),
  config: {
    timezone: config.timezone,
    capacityWindowWeeks: config.capacity.windowWeeks,
    defaultTaskMinutes: config.capacity.defaultTaskMinutes,
    baseUrl: config.baseUrl,
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

/**
 * Authentication, built before the listener opens.
 *
 * `await` at module scope, deliberately: the key set is fetched and *checked*
 * here (W14), and a failure must stop the process rather than become a 401 on
 * every request. `loadConfigOrExit` has already refused to reach this line
 * without `AUTH_ISSUER_URL`, `AUTH_AUDIENCE`, `AUTH_ALLOWED_SUBJECTS` and
 * `TOKEN_PEPPER`, all of which are required for the `api` service.
 *
 * There is no branch here that skips it. ADR-0021 rule 9: local development
 * runs the same verifier against a locally issued key and a development issuer,
 * because a verification path that can be switched off is one that will ship
 * switched off.
 */
const auth = await createAuth({
  client: database.client,
  auth: config.auth as NonNullable<typeof config.auth>,
  baseUrl: config.baseUrl,
  tokenPepper: config.tokenPepper as string,
  logger,
  now: () => new Date(),
}).catch((error: unknown) => {
  // Exit 78 — EX_CONFIG, the same code `loadConfigOrExit` uses. This is a
  // configuration failure in every case that reaches here, and the message
  // says which one.
  logger.fatal('authentication could not be configured, refusing to start', { error });
  process.exit(78);
});

const app = createApp({
  config,
  logger,
  metrics,
  services,
  auth,
  authorizer: auth.authorizer,
  // W06's write tools consume this; nothing else invents its own.
  confirmations: auth.confirmations,
  isShuttingDown: () => shuttingDown,
  readiness: () => checkReadiness({ client: database.client, expected: schemaVersion }),
  /**
   * The reconciler's two gauges, republished on every scrape.
   *
   * The scheduled pass runs in a CronJob pod that Prometheus never scrapes, so
   * this process is the only one that can publish what the pass measured. It
   * reads the row the pass wrote (ADR-0018 — all state is in PostgreSQL) and it
   * cannot make `/metrics` fail: on a database that is not answering, the
   * endpoint still serves everything else.
   */
  refreshMetrics: createSyncMetricsRefresher({ client: database.client, metrics, logger }),
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  logger.info('listening', {
    port: info.port,
    schemaVersion,
    timezone: config.timezone,
    syncWriteEnabled: config.sync.writeEnabled,
    // Configuration, not credentials (docs/15-runtime.md §2) — and the two
    // values an operator debugging a 401 wants first.
    issuer: config.auth?.issuerUrl,
    jwksUrl: auth.jwksUrl,
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
