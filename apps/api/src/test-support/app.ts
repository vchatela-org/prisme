import type { Hono } from 'hono';
import type postgres from 'postgres';
import { createLogger, createMetrics } from '@prisme/observability';
import type { Config } from '@prisme/config';
import { createApp } from '../app.js';
import { createConfirmationService, type ConfirmationService } from '../auth/confirmation.js';
import { createPostgresAuthStore } from '../auth/postgres.js';
import { ApiError } from '../http/errors.js';
import type { Authorizer, Identity } from '../http/authorize.js';
import { SCOPE_NAMES, type Scope } from '../http/scopes.js';
import { createServices, SERVICE_DEFAULTS, type Services } from '../services/index.js';
import { createPostgresStore } from '../store/postgres.js';
import type { SyncRunner, SyncRunResult } from '../sync/port.js';

/**
 * An application, wired for a test.
 *
 * The only things faked are the two that reach outside the process: the
 * authorizer, which W14 has not written yet, and the reconciler, which would
 * otherwise need the external tools. Everything between them — the router, the
 * schemas, the services, the SQL — is the code that ships.
 */

export function identityWith(scopes: readonly Scope[]): Identity {
  return { kind: 'human', subject: 'fixture-subject', scopes };
}

/** Every scope. For tests about behaviour rather than about authorization. */
export const FULL_IDENTITY: Identity = identityWith(SCOPE_NAMES);

export function authorizerFor(identity: Identity | undefined): Authorizer {
  return {
    authorize: () =>
      Promise.resolve(
        identity === undefined
          ? { ok: false, error: new ApiError('unauthenticated', 'no credential was presented') }
          : { ok: true, identity },
      ),
  };
}

export const NO_SYNC_RESULT: SyncRunResult = {
  mode: 'plan',
  ran: true,
  full: false,
  startedAt: new Date('2026-09-17T09:00:00.000Z'),
  finishedAt: new Date('2026-09-17T09:00:01.000Z'),
  counts: {},
  applied: null,
  conflicts: null,
  refused: null,
  failures: 0,
  drift: 0,
  report: 'nothing to do',
};

export function stubRunner(result: SyncRunResult = NO_SYNC_RESULT): SyncRunner {
  return {
    run: (request) => Promise.resolve({ ...result, mode: request.mode }),
    scanAdoption: () => Promise.resolve({ ran: true, queued: 0, certain: 0 }),
  };
}

const TEST_CONFIG = {
  service: 'api',
  port: 3000,
  logLevel: 'fatal',
  timezone: 'UTC',
  baseUrl: 'https://prisme.invalid',
  sync: {
    enabled: true,
    writeEnabled: false,
    createThreshold: 0,
    windowStart: 7,
    windowEnd: 22,
  },
  capacity: { defaultTaskMinutes: 25, windowWeeks: 4 },
  scoringActiveMethod: 'wsjf-balanced',
} as unknown as Config;

export interface TestAppOptions {
  readonly client: postgres.Sql;
  readonly identity?: Identity | undefined;
  readonly runner?: SyncRunner | undefined;
  /** Pinned, so a ranking computed in a test is the same ranking tomorrow. */
  readonly now?: Date | undefined;
  /**
   * Defaults to the **real** confirmation service on the test database (W06).
   *
   * Deliberately not a stub. Single use, atomic consumption and expiry are
   * properties of the `UPDATE … RETURNING` in `auth/postgres.ts`, and a fake
   * that returns "yes" would assert nothing about the control W06 depends on.
   * Pass `null` to build an instance that has none, which is the one case worth
   * faking: it must make every write tool refuse.
   */
  readonly confirmations?: ConfirmationService | null | undefined;
}

export interface TestApp {
  readonly app: Hono;
  readonly services: Services;
  request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

export const PINNED_NOW = new Date('2026-09-17T09:00:00.000Z');

export function createTestApp(options: TestAppOptions): TestApp {
  const services = createServices({
    store: createPostgresStore(options.client),
    runner: options.runner ?? stubRunner(),
    config: {
      timezone: 'UTC',
      capacityWindowWeeks: 4,
      defaultTaskMinutes: 25,
      baseUrl: 'http://prisme.example',
      limits: SERVICE_DEFAULTS.limits,
      concurrentInitiatives: SERVICE_DEFAULTS.concurrentInitiatives,
      workingWeekdays: SERVICE_DEFAULTS.workingWeekdays,
      sync: {
        enabled: true,
        writeEnabled: false,
        createThreshold: 0,
        windowStart: 7,
        windowEnd: 22,
      },
    },
  });

  const now = (): Date => options.now ?? PINNED_NOW;

  const confirmations =
    options.confirmations === null
      ? undefined
      : (options.confirmations ??
        createConfirmationService({ store: createPostgresAuthStore(options.client), now }));

  const app = createApp({
    config: TEST_CONFIG,
    logger: createLogger({ service: 'prisme-api-test', level: 'fatal' }),
    metrics: createMetrics({ collectDefaults: false }),
    readiness: () => Promise.resolve({ state: 'ready', checks: [] } as never),
    isShuttingDown: () => false,
    services,
    authorizer: authorizerFor(options.identity ?? FULL_IDENTITY),
    confirmations,
    now,
  });

  return {
    app,
    services,
    async request(method: string, path: string, body?: unknown) {
      const response = await app.request(path, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      };
    },
  };
}
