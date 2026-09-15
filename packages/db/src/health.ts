import type postgres from 'postgres';
import { currentSchemaVersion, expectedSchemaVersion } from './migrations.js';

/**
 * Readiness, and only readiness.
 *
 * `/healthz` never calls anything in this file. A liveness probe that fails
 * when PostgreSQL blinks restarts a healthy process and turns a brief outage
 * into a crash loop (docs/15-runtime.md §1). Readiness is where a dependency
 * belongs: an unready pod is taken out of the service, not killed.
 */

export type ReadinessState = 'ready' | 'not-ready';

export interface ReadinessReport {
  readonly state: ReadinessState;
  readonly database: 'reachable' | 'unreachable';
  /** What the database says it is at. */
  readonly schemaVersion: string | null;
  /** What this binary was built against. */
  readonly expectedSchemaVersion: string;
  /** Present when not ready. Safe to return over HTTP: never contains a value or a credential. */
  readonly reason?: string;
  readonly checkedInMs: number;
}

export interface CheckReadinessOptions {
  readonly client: postgres.Sql;
  readonly expected?: string;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export async function checkReadiness(options: CheckReadinessOptions): Promise<ReadinessReport> {
  const now = options.now ?? (() => Date.now());
  const expected = options.expected ?? expectedSchemaVersion();
  const startedAt = now();

  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error('timed out')), options.timeoutMs ?? 2000).unref?.();
  });

  try {
    const version = await Promise.race([
      (async () => {
        await options.client`select 1`;
        return currentSchemaVersion(options.client);
      })(),
      timeout,
    ]);

    if (version !== expected) {
      return {
        state: 'not-ready',
        database: 'reachable',
        schemaVersion: version === '' ? null : version,
        expectedSchemaVersion: expected,
        reason:
          version === ''
            ? 'no migration has been applied; the pre-rollout migration Job has not run'
            : 'schema version does not match this image',
        checkedInMs: now() - startedAt,
      };
    }

    return {
      state: 'ready',
      database: 'reachable',
      schemaVersion: version,
      expectedSchemaVersion: expected,
      checkedInMs: now() - startedAt,
    };
  } catch {
    // Deliberately no error detail: an upstream message can carry a host, a
    // user name or a connection string (docs/14-threat-model.md §5).
    return {
      state: 'not-ready',
      database: 'unreachable',
      schemaVersion: null,
      expectedSchemaVersion: expected,
      reason: 'database is not reachable',
      checkedInMs: now() - startedAt,
    };
  }
}
