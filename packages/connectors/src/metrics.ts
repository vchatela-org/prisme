import type { ExternalTool } from './errors.js';

/**
 * The instrumentation port.
 *
 * `prisme_external_requests_total{tool,status}` is declared in
 * `@prisme/observability` (docs/15-runtime.md §5) and incremented from here —
 * but this package takes a **port** rather than the registry, so that
 * `@prisme/connectors` has no `prom-client` dependency and a test can assert
 * what was recorded by pushing samples into an array.
 *
 * `durationSeconds` has no metric behind it yet. The W03 brief asks for latency
 * histograms; docs/15-runtime.md §5 does not list one, and adding it means
 * editing `@prisme/observability` and that spec table, neither of which is in
 * this workstream's tree. The sample carries the number so the adapter can
 * observe it the moment the histogram exists — see the journal entry's
 * follow-ups.
 */

export interface ExternalRequestSample {
  readonly tool: ExternalTool;
  /** The HTTP status as a label value, or `error` when the transport itself failed. */
  readonly status: string;
  readonly durationSeconds: number;
  /** 1 for the first try. Lets a dashboard separate "slow" from "retried four times". */
  readonly attempt: number;
}

export interface ConnectorMetrics {
  recordRequest(sample: ExternalRequestSample): void;
}

/** Records nothing. The default, so instrumentation is never a reason a client cannot be built. */
export const noopMetrics: ConnectorMetrics = {
  recordRequest: () => undefined,
};
