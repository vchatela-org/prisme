import type postgres from 'postgres';
import {
  createDocToolClient,
  createFetchTransport,
  createTaskToolClient,
} from '@prisme/connectors';
import { createFrozenWriter, createTaskToolWriter } from '@prisme/connectors/write';
import { RECONCILER_LOCK_ID, withAdvisoryLock } from '@prisme/db';
import {
  adopt,
  createAdoptionStore,
  createPostgresStore,
  readBindings,
  reconcile,
} from '@prisme/sync';
import type { SyncRunRequest, SyncRunResult, SyncRunner } from './port.js';

/**
 * `POST /sync`, wired to the real reconciler.
 *
 * **Two entrypoints, one library.** This calls the same `reconcile` the
 * CronJob's `prisme-sync` binary calls, behind the same advisory lock, so the
 * scheduled pass and the force-sync button are provably the same code path
 * rather than two implementations that drift (docs/16-sync.md §7).
 *
 * Three properties are inherited rather than re-implemented, and that is the
 * point of importing the library instead of reproducing it:
 *
 *   - **The write freeze is structural.** With `SYNC_WRITE_ENABLED` false the
 *     writer handed to `apply` is a frozen one that cannot reach an API at all
 *     — not a branch somebody can forget to take.
 *   - **The lock is non-blocking.** A pass that finds the lock held returns
 *     `ran: false` immediately. Queueing would build a line of passes, each
 *     deciding from state that went stale while it waited (ADR-0009).
 *   - **The create threshold still applies.** Guard 3 refuses a plan that would
 *     create more than the configured number of objects (ADR-0010), and it
 *     refuses it here exactly as it refuses it in the CronJob.
 *
 * The rendered report is returned to the caller and **never logged**: it
 * carries real titles.
 */

export interface SyncRunnerOptions {
  readonly client: postgres.Sql;
  readonly taskToolToken: string;
  /**
   * The task tool's **API host**, from `TASKTOOL_BASE_URL`. Absent means the
   * connector's own vendor default, which is every deployment that has not
   * overridden one — see `TASKTOOL_BASE_URL` in `@prisme/config`.
   *
   * It reaches the *writer* as well as the reader: both build request URLs, and
   * a deployment that redirected one but not the other would read from the
   * instance it meant to write to and write to the vendor's.
   */
  readonly taskToolBaseUrl: string | undefined;
  /** The document tool, for the adoption scan. */
  readonly docToolToken: string;
  readonly docToolBaseUrl: string | undefined;
  /** `DOCTOOL_TAKEAWAY_TYPE_PROPERTY`, when the instance names one. */
  readonly takeawayTypeProperty: string | undefined;
  readonly writeEnabled: boolean;
  readonly createThreshold: number;
  readonly baseUrl: string;
  readonly runId: () => string;
  readonly now: () => Date;
}

const NO_COUNTS: Readonly<Record<string, number>> = {};

export function createSyncRunner(options: SyncRunnerOptions): SyncRunner {
  return {
    async scanAdoption() {
      const transport = createFetchTransport();
      // The same lock as a pass, and for the reason `prisme-sync adopt` gives:
      // a pass binding things underneath the scan would produce a queue
      // proposing work that was decided while the scan looked elsewhere.
      const outcome = await withAdvisoryLock(options.client, RECONCILER_LOCK_ID, async () =>
        adopt({
          store: createAdoptionStore(options.client),
          taskClient: createTaskToolClient({
            token: options.taskToolToken,
            baseUrl: options.taskToolBaseUrl,
            transport,
          }),
          docClient: createDocToolClient({
            token: options.docToolToken,
            baseUrl: options.docToolBaseUrl,
            bindings: await readBindings(options.client),
            transport,
          }),
          now: options.now,
          persist: true,
          ...(options.takeawayTypeProperty === undefined
            ? {}
            : { takeawayTypeProperty: options.takeawayTypeProperty }),
        }),
      );
      if (!outcome.acquired || outcome.result === undefined) {
        return { ran: false, queued: 0, certain: 0 };
      }
      // Counts only. The rendered report carries real titles, and this answer
      // goes to a browser.
      return {
        ran: true,
        queued: outcome.result.scan.queue.length,
        certain: outcome.result.scan.autoLinkable.length,
      };
    },

    async run(request: SyncRunRequest): Promise<SyncRunResult> {
      const startedAt = options.now();
      const transport = createFetchTransport();

      const outcome = await withAdvisoryLock(options.client, RECONCILER_LOCK_ID, () =>
        reconcile({
          mode: request.mode,
          full: request.full,
          store: createPostgresStore(options.client),
          taskClient: createTaskToolClient({
            token: options.taskToolToken,
            baseUrl: options.taskToolBaseUrl,
            transport,
          }),
          writer: options.writeEnabled
            ? createTaskToolWriter({
                token: options.taskToolToken,
                baseUrl: options.taskToolBaseUrl,
                transport,
              })
            : createFrozenWriter(),
          writeEnabled: options.writeEnabled,
          createThreshold: options.createThreshold,
          baseUrl: options.baseUrl,
          runId: options.runId(),
          now: options.now,
        }),
      );

      const finishedAt = options.now();

      if (!outcome.acquired || outcome.result === undefined) {
        return {
          mode: request.mode,
          ran: false,
          full: false,
          startedAt,
          finishedAt,
          counts: NO_COUNTS,
          applied: null,
          conflicts: null,
          refused: null,
          failures: 0,
          drift: 0,
          report: null,
        };
      }

      const result = outcome.result;
      return {
        mode: request.mode,
        ran: true,
        full: result.full,
        startedAt,
        finishedAt,
        counts: result.plan.counts,
        applied: result.applied?.applied ?? null,
        conflicts: result.applied?.conflicts ?? null,
        refused: result.applied?.refused ?? result.applied?.stopped ?? null,
        failures: result.applied?.failures.length ?? 0,
        drift: result.drift,
        report: result.report,
      };
    },
  };
}
