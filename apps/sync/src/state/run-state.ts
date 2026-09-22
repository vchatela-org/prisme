import type postgres from 'postgres';
import type { PassOutcome } from '../apply/ports.js';

/**
 * `sync_run_state` — the one row the reconciler writes and `/metrics` reads.
 *
 * ### The defect this closes
 *
 * `docs/15-runtime.md` §5 specifies `prisme_sync_last_success_timestamp` and
 * `prisme_sync_drift_objects`, and calls the second "the one that actually
 * matters". Neither was observable in a deployment. The reason was not a
 * missing `set()` — the CronJob sets both correctly — but topology: the
 * reconciler is a CronJob pod with no Service and a lifetime of seconds, so
 * Prometheus never scrapes it, and the gauges die with the process. The API,
 * which *is* scraped, had no idea what the last pass did.
 *
 * ADR-0018 already guarantees the way out: **all** prisme state is in
 * PostgreSQL, sync state included. So the pass writes its outcome here and the
 * API republishes it. Nothing needs a Pushgateway and the CronJob needs no
 * Service.
 *
 * ### Both halves live here
 *
 * The write is called from `apps/sync` and the read from `apps/api`, and they
 * are in one file on purpose: the shape of this table is a contract between two
 * processes, and a reader that drifts from its writer republishes a number that
 * no longer means what the gauge's help text says it does.
 *
 * Every statement is a tagged template, parameterised by the driver, and both
 * columns that cross this boundary are counts and timestamps — there is nothing
 * instance-identifying in this table to leak (docs/17-privacy.md).
 */

/** The client `@prisme/db` hands out. */
type Sql = postgres.Sql;

/**
 * What the last pass did, as far as anything has recorded it.
 *
 * Both fields are optional, and `undefined` is load-bearing rather than tidy:
 * "no pass has ever succeeded" and "the last pass succeeded at the epoch" are
 * different facts, and so are "nothing has measured drift" and "drift is zero".
 * Collapsing either into a number is the defect, not the fix — prom-client
 * renders a registered-but-never-set gauge as `0`, which turned
 * `min_over_time(prisme_sync_drift_objects[48h]) > 0` into an alert that can
 * never fire and looks like coverage.
 */
export interface SyncRunState {
  readonly lastSuccessAt?: Date | undefined;
  readonly drift?:
    | {
        readonly objects: number;
        readonly at: Date;
        readonly full: boolean;
      }
    | undefined;
}

interface RunStateRow {
  readonly last_success_at: Date | string | null;
  readonly last_drift_objects: number | string | null;
  readonly last_drift_at: Date | string | null;
  readonly last_drift_full: boolean | null;
}

/**
 * A timestamp, read back.
 *
 * The same accommodation as `state/postgres.ts`: Drizzle replaces the shared
 * client's `timestamptz` parser, so a column the driver would hand back as a
 * `Date` arrives here as PostgreSQL's text form. Accepting both keeps this file
 * correct whichever client it is handed.
 */
function instant(value: Date | string | null): Date | undefined {
  if (value === null) return undefined;
  if (value instanceof Date) return value;
  // `2026-09-22 09:05:00+00` — a space for the separator, a two-digit offset.
  const at = new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(at.getTime())) {
    throw new Error('a timestamp column did not parse; the database schema and this code disagree');
  }
  return at;
}

/**
 * Record what a pass did.
 *
 * The drift measurement is written on every apply pass, including a refused
 * one: the incremental stream was still compared against the full view, and
 * that comparison is valid whether or not the plan was allowed to execute.
 * `last_success_at` is the column that distinguishes them, and it only moves
 * forward — a refused pass must not erase the memory of the last good one.
 */
export async function recordPassOutcome(client: Sql, outcome: PassOutcome): Promise<void> {
  const at = outcome.at.toISOString();
  const success = outcome.succeeded ? at : null;

  await client`
    insert into sync_run_state
      (id, last_success_at, last_drift_objects, last_drift_at, last_drift_full, updated_at)
    values ('singleton', ${success}::timestamptz, ${outcome.drift}, ${at}::timestamptz,
            ${outcome.full}, now())
    on conflict (id) do update set
      last_success_at = coalesce(excluded.last_success_at, sync_run_state.last_success_at),
      last_drift_objects = excluded.last_drift_objects,
      last_drift_at = excluded.last_drift_at,
      last_drift_full = excluded.last_drift_full,
      updated_at = now()`;
}

/**
 * What the last pass did. An empty object when no pass has ever recorded one.
 *
 * This is on the `/metrics` path, so it is a single indexed-by-primary-key read
 * of one row and it stays that way. A scrape happens every fifteen seconds in a
 * normal deployment; anything expensive here is a load source that only shows up
 * under monitoring.
 */
export async function readSyncRunState(client: Sql): Promise<SyncRunState> {
  const rows = await client<RunStateRow[]>`
    select last_success_at, last_drift_objects, last_drift_at, last_drift_full
    from sync_run_state
    where id = 'singleton'`;

  const row = rows[0];
  if (row === undefined) return {};

  const lastSuccessAt = instant(row.last_success_at);
  const driftAt = instant(row.last_drift_at);

  return {
    ...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
    ...(row.last_drift_objects === null || driftAt === undefined
      ? {}
      : {
          drift: {
            // `integer` comes back as a number, but the driver's type for a
            // numeric column is wider than that and a string here would publish
            // `NaN` to a gauge silently.
            objects: Number(row.last_drift_objects),
            at: driftAt,
            full: row.last_drift_full ?? false,
          },
        }),
  };
}
