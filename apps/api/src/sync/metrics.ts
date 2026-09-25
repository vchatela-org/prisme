import type postgres from 'postgres';
import { readSyncRunState } from '@prisme/sync';
import type { Logger, Metrics } from '@prisme/observability';

/**
 * The reconciler's three gauges, republished from PostgreSQL on every scrape.
 *
 * ### Why this exists
 *
 * `docs/15-runtime.md` §5 specifies `prisme_sync_last_success_timestamp` and
 * `prisme_sync_drift_objects`, the second of which it calls "the one that
 * actually matters". Neither was observable in a deployment: the reconciler
 * runs as a **CronJob pod** — no Service, no ServiceMonitor, alive for seconds
 * — so Prometheus never scrapes the process that knows the answer. The API is
 * scraped and knew nothing.
 *
 * ADR-0018 is what makes the fix a small one: **all** prisme state is in
 * PostgreSQL, sync state included. The pass records its outcome in
 * `sync_run_state`, and this reads it back on the `/metrics` path. No
 * Pushgateway (explicitly undesirable — it would become a second, unreconciled
 * source of truth for state that is already in the database), no Service on the
 * CronJob, no second copy of the reconciler.
 *
 * ### Two properties this file is responsible for
 *
 * 1. **It degrades, it never fails.** A metrics endpoint that goes down with
 *    the database blinds you at exactly the moment you are looking. If the
 *    query fails or is slow, the process and registry metrics are still served
 *    and the three republished gauges simply carry no sample.
 * 2. **Absent is not zero.** With nothing recorded, the gauges are *removed*
 *    rather than set to zero, because a zero here is the defect: it made the
 *    staleness alert fire permanently and the drift alert unable to fire at
 *    all.
 */

export interface SyncMetricsOptions {
  readonly client: postgres.Sql;
  readonly metrics: Metrics;
  readonly logger?: Logger | undefined;
  /** Bound on the read. A scrape must not hang on a database that is not answering. */
  readonly timeoutMs?: number | undefined;
}

/**
 * Short on purpose.
 *
 * A scrape is every fifteen seconds in a normal deployment and Prometheus has
 * its own scrape timeout; a read of one row by primary key is either quick or
 * it is not happening, and waiting longer only means the exposition arrives
 * after nobody is listening.
 */
const DEFAULT_TIMEOUT_MS = 1_500;

/**
 * Refresh the republished gauges. **Never rejects.**
 *
 * The caller is an HTTP handler on the operational path, and callers of this
 * kind get a function that cannot make their endpoint fail. `/metrics` guards
 * it again anyway — the guarantee is worth stating in both places, because the
 * cost of being wrong is losing observability during an incident.
 */
export function createSyncMetricsRefresher(options: SyncMetricsOptions): () => Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function refresh(): Promise<void> {
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('timed out')), timeoutMs).unref?.();
      });

      const state = await Promise.race([readSyncRunState(options.client), timeout]);

      if (state.lastSuccessAt === undefined) {
        options.metrics.syncLastSuccessTimestamp.remove();
      } else {
        // Seconds since the epoch, which is what the gauge's help text and the
        // alert expression in docs/15-runtime.md §5 both mean by "timestamp".
        options.metrics.syncLastSuccessTimestamp.set(state.lastSuccessAt.getTime() / 1000);
      }

      if (state.drift === undefined) {
        options.metrics.syncDriftObjects.remove();
      } else {
        options.metrics.syncDriftObjects.set(state.drift.objects);
      }

      /*
       * The third gauge, and the reason it is a separate series: this one is
       * written only by a full pass, so it stands still across the fifteen
       * minutes in between and `min_over_time(...[48h]) > 0` means "every full
       * pass in the last two days", which is the alert in §5. Republishing it
       * from the stored row on every scrape is what supplies those samples —
       * the CronJob pod is never scraped, so without this the series would
       * exist only in the minutes after a full pass.
       */
      if (state.driftFull === undefined) {
        options.metrics.syncDriftFullObjects.remove();
      } else {
        options.metrics.syncDriftFullObjects.set(state.driftFull);
      }
    } catch (error) {
      /*
       * The gauges are left exactly as they were.
       *
       * Removing them on a failed read would turn a blip in the database into a
       * gap in the series, which reads as "the reconciler stopped" — a false
       * alarm about the wrong component. Holding the last known value is the
       * honest degradation: the value is stale, and Prometheus's own `up` and
       * the `/readyz` probe are what say the database is unreachable.
       *
       * No detail from the error reaches the response; a driver error can quote
       * a host or a connection string, and the logger redacts by deny-list
       * (docs/14-threat-model.md §5).
       */
      options.logger?.warn('the sync metrics could not be refreshed from the database', { error });
    }
  };
}
