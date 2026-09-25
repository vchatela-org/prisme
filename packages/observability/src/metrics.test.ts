import { describe, expect, it } from 'vitest';
import { createMetrics } from './metrics.js';

/**
 * The registry, and the one property of it that turned out to be load-bearing:
 * **a gauge nobody has set must publish no sample at all**.
 *
 * prom-client renders a registered, never-set, unlabelled `Gauge` as `0`. Both
 * alerts docs/15-runtime.md §5 asks for were written against that zero and both
 * were useless, as measured on a live cluster:
 *
 *   - `time() - prisme_sync_last_success_timestamp > threshold` fires
 *     permanently, so it gets muted;
 *   - `min_over_time(prisme_sync_drift_objects[48h]) > 0` is `0 > 0` and can
 *     never fire — which looks exactly like coverage and is not.
 */

/** The exposition line for a metric, if it has one. Help and type lines excluded. */
function sampleOf(exposition: string, name: string): string | undefined {
  return exposition
    .split('\n')
    .find((line) => line === name || line.startsWith(`${name} `) || line.startsWith(`${name}{`));
}

describe('the sync gauges', () => {
  it('publish no sample until something sets one', async () => {
    const metrics = createMetrics({ collectDefaults: false });

    const body = await metrics.registry.metrics();

    // Declared — the name, its help and its type are all there, which is what
    // makes a dashboard referencing it valid before the first pass.
    expect(body).toContain('# TYPE prisme_sync_last_success_timestamp gauge');
    expect(body).toContain('# TYPE prisme_sync_drift_objects gauge');
    expect(body).toContain('# TYPE prisme_sync_drift_full_objects gauge');

    // And carrying no value, because nothing has measured one.
    expect(sampleOf(body, 'prisme_sync_last_success_timestamp')).toBeUndefined();
    expect(sampleOf(body, 'prisme_sync_drift_objects')).toBeUndefined();
    expect(sampleOf(body, 'prisme_sync_drift_full_objects')).toBeUndefined();
  });

  it('publish the value once one is set, including zero', async () => {
    const metrics = createMetrics({ collectDefaults: false });

    metrics.syncDriftObjects.set(0);
    metrics.syncLastSuccessTimestamp.set(1_758_531_600);

    const body = await metrics.registry.metrics();

    // A measured zero is the healthy state and must be published: the drift
    // alert reads "above 0 on two consecutive passes", and it can only tell a
    // measured zero from silence if a measured zero is a sample.
    expect(sampleOf(body, 'prisme_sync_drift_objects')).toBe('prisme_sync_drift_objects 0');
    expect(sampleOf(body, 'prisme_sync_last_success_timestamp')).toBe(
      'prisme_sync_last_success_timestamp 1758531600',
    );
  });

  it('leaves the counters at zero, where zero is the truth', async () => {
    // Nothing is removed here, and nothing should be: a process that has
    // applied no action has applied zero of them, which is a fact rather than
    // an absence of one.
    const metrics = createMetrics({ collectDefaults: false });
    metrics.syncConflicts.inc(0);

    const body = await metrics.registry.metrics();

    expect(sampleOf(body, 'prisme_sync_conflicts_total')).toBe('prisme_sync_conflicts_total 0');
  });
});
