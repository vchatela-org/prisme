import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * The metrics registry, and every metric named in docs/15-runtime.md §5.
 *
 * They are declared here rather than where they are used so that the names and
 * labels exist exactly once. A metric invented at a call site is a metric the
 * dashboard does not know about, and a relabelled one silently breaks an alert.
 *
 * W03, W04 and W05 increment these; W00 only defines them.
 */

export interface Metrics {
  readonly registry: Registry;
  /** Seconds since the epoch of the last reconciler pass that finished cleanly. */
  readonly syncLastSuccessTimestamp: Gauge<string>;
  readonly syncDuration: Histogram<string>;
  readonly syncActions: Counter<'type'>;
  readonly syncConflicts: Counter<string>;
  /**
   * Objects the daily full pass found to differ from the incremental view.
   * The one that actually matters: persistent non-zero means incremental sync
   * is broken while appearing healthy.
   */
  readonly syncDriftObjects: Gauge<string>;
  /**
   * The drift the last **full** pass measured, carried across the incremental
   * passes in between.
   *
   * The same fact as `syncDriftObjects` on a full pass and a different one
   * every fifteen minutes otherwise, which is the whole reason it exists: only
   * this series stands still long enough for
   * `min_over_time(prisme_sync_drift_full_objects[48h]) > 0` to mean "two
   * consecutive daily full passes", the alert docs/15-runtime.md §5 specifies.
   */
  readonly syncDriftFullObjects: Gauge<string>;
  readonly externalRequests: Counter<'tool' | 'status'>;
  readonly authFailures: Counter<'reason'>;
}

export interface MetricsOptions {
  /** Node process metrics — heap, event-loop lag, handles. On by default. */
  readonly collectDefaults?: boolean;
  readonly prefix?: string;
}

export function createMetrics(options: MetricsOptions = {}): Metrics {
  const registry = new Registry();
  if (options.collectDefaults !== false) {
    collectDefaultMetrics({ register: registry, prefix: options.prefix ?? '' });
  }

  const metrics: Metrics = {
    registry,
    syncLastSuccessTimestamp: new Gauge({
      name: 'prisme_sync_last_success_timestamp',
      help: 'Unix timestamp of the last reconciler pass that completed without error.',
      registers: [registry],
    }),
    syncDuration: new Histogram({
      name: 'prisme_sync_duration_seconds',
      help: 'Duration of a reconciler pass.',
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
      registers: [registry],
    }),
    syncActions: new Counter({
      name: 'prisme_sync_actions_total',
      help: 'Actions the reconciler applied, by type.',
      labelNames: ['type'] as const,
      registers: [registry],
    }),
    syncConflicts: new Counter({
      name: 'prisme_sync_conflicts_total',
      help: 'Conflicts recorded in the ledger.',
      registers: [registry],
    }),
    syncDriftObjects: new Gauge({
      name: 'prisme_sync_drift_objects',
      help: 'Objects the daily full pass found to differ from the incremental view.',
      registers: [registry],
    }),
    syncDriftFullObjects: new Gauge({
      name: 'prisme_sync_drift_full_objects',
      help: 'Objects the last full pass found to differ from the incremental view, held until the next one.',
      registers: [registry],
    }),
    externalRequests: new Counter({
      name: 'prisme_external_requests_total',
      help: 'Requests to an external tool, by tool and HTTP status.',
      labelNames: ['tool', 'status'] as const,
      registers: [registry],
    }),
    authFailures: new Counter({
      name: 'prisme_auth_failures_total',
      help: 'Rejected authentication attempts, by reason.',
      labelNames: ['reason'] as const,
      registers: [registry],
    }),
  };

  /*
   * The three sync gauges start **unset**, not at zero.
   *
   * prom-client renders a registered, never-set, unlabelled `Gauge` as a sample
   * with the value `0`. For a counter that is right; for these three it is a lie
   * with operational consequences, and both were measured against a live
   * cluster:
   *
   *   - `time() - prisme_sync_last_success_timestamp > threshold` is true
   *     against a zero, so the staleness alert fires permanently and is muted.
   *   - `min_over_time(prisme_sync_drift_objects[48h]) > 0` is `0 > 0` against a
   *     zero, so the alert on "the one that actually matters"
   *     (docs/15-runtime.md §5) can never fire — and an alert that cannot fire
   *     looks exactly like coverage.
   *
   * `remove()` on an unlabelled gauge drops its single timeseries, so the
   * exposition carries the `HELP` and `TYPE` lines and no sample until
   * something sets a value. Prometheus then has *no data* rather than wrong
   * data, an expression over it yields no result instead of a false one, and
   * `absent()` is available to alert on the difference deliberately.
   *
   * Every other metric here is a counter or a histogram, where zero is the
   * truth on a process that has not done the thing yet.
   */
  metrics.syncLastSuccessTimestamp.remove();
  metrics.syncDriftObjects.remove();
  metrics.syncDriftFullObjects.remove();

  return metrics;
}
