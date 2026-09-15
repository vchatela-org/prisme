import type postgres from 'postgres';

/**
 * PostgreSQL advisory locks.
 *
 * docs/15-runtime.md §4: the scheduled reconciler run and the on-demand
 * `POST /sync` are the same code path, and the advisory lock is what stops a
 * manual run from overlapping a scheduled one. It lives in the database rather
 * than in a file or a Kubernetes lease because that is where all state lives
 * (ADR-0018) and because any replica can then take over.
 */

/** Distinct from `MIGRATION_LOCK_ID`. Two different things must not share a lock. */
export const RECONCILER_LOCK_ID = 5_150_001;

export interface AdvisoryLockResult<T> {
  readonly acquired: boolean;
  readonly result: T | undefined;
}

/**
 * Run `fn` while holding `lockId`, or return `{ acquired: false }` immediately.
 *
 * Non-blocking on purpose. A reconciler pass that waits for the previous one
 * builds a queue of passes, and by the time it drains every one of them is
 * working from stale state. Skipping is correct: the next scheduled pass sees
 * the world as it is then, which is what level-triggered means (ADR-0009).
 */
export async function withAdvisoryLock<T>(
  client: postgres.Sql,
  lockId: number,
  fn: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  const rows = await client<
    { locked: boolean }[]
  >`select pg_try_advisory_lock(${lockId}) as locked`;
  if (rows[0]?.locked !== true) return { acquired: false, result: undefined };

  try {
    return { acquired: true, result: await fn() };
  } finally {
    await client`select pg_advisory_unlock(${lockId})`;
  }
}
