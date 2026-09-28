import type postgres from 'postgres';
import {
  createDocToolClient,
  createFetchTransport,
  createTaskToolClient,
} from '@prisme/connectors';
import {
  auditDocumentEntryWriter,
  auditTaskToolWriter,
  createDocToolEntryWriter,
  createFrozenDocumentEntryWriter,
  createFrozenWriter,
  createTaskToolWriter,
} from '@prisme/connectors/write';
import { RECONCILER_LOCK_ID, withAdvisoryLock } from '@prisme/db';
import {
  adopt,
  createAdoptionStore,
  createObjectivePageStore,
  createPostgresStore,
  readBindings,
  reconcile,
  reconcileObjectivePages,
  writeAuditOptions,
  type ObjectivePagesResult,
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
  /**
   * Told when an outward write could not be recorded in the audit (ADR-0031).
   * The write stands on its own result either way; this is the log line.
   */
  readonly onAuditRecordError?: ((error: unknown) => void) | undefined;
  /**
   * Told when the objectives store could not be read for the objective-pages
   * step (ADR-0034). The task-tool half has already run and its result stands,
   * as it does in the CronJob; this is the log line.
   */
  readonly onObjectivePagesError?: ((error: unknown) => void) | undefined;
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
      const runId = options.runId();

      const audit = writeAuditOptions(options.client, {
        origin: 'reconciler',
        runId,
        now: options.now,
        onRecordError: options.onAuditRecordError ?? (() => undefined),
      });

      const outcome = await withAdvisoryLock(options.client, RECONCILER_LOCK_ID, async () => {
        const reconciled = await reconcile({
          mode: request.mode,
          full: request.full,
          store: createPostgresStore(options.client),
          taskClient: createTaskToolClient({
            token: options.taskToolToken,
            baseUrl: options.taskToolBaseUrl,
            transport,
          }),
          // Audited exactly as the CronJob's is — the force-sync button is the
          // same code path, and so is its record (ADR-0031).
          writer: auditTaskToolWriter(
            options.writeEnabled
              ? createTaskToolWriter({
                  token: options.taskToolToken,
                  baseUrl: options.taskToolBaseUrl,
                  transport,
                })
              : createFrozenWriter(),
            audit,
          ),
          writeEnabled: options.writeEnabled,
          createThreshold: options.createThreshold,
          baseUrl: options.baseUrl,
          runId,
          now: options.now,
        });

        // The objectives' pages, as the CronJob's pass does them (ADR-0034):
        // same library, same lock, same mode, same freeze and audit.
        let objectivePages: ObjectivePagesResult | undefined;
        try {
          const docClient = createDocToolClient({
            token: options.docToolToken,
            baseUrl: options.docToolBaseUrl,
            bindings: await readBindings(options.client),
            transport,
          });
          objectivePages = await reconcileObjectivePages({
            mode: request.mode,
            store: createObjectivePageStore(options.client),
            docClient,
            writer: auditDocumentEntryWriter(
              options.writeEnabled
                ? createDocToolEntryWriter({ client: docClient })
                : createFrozenDocumentEntryWriter(),
              audit,
            ),
            writeEnabled: options.writeEnabled,
            runId,
            now: options.now,
          });
        } catch (error) {
          options.onObjectivePagesError?.(error);
        }

        return { reconciled, objectivePages };
      });

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

      const { reconciled: result, objectivePages: pages } = outcome.result;
      // A page write is one more change, counted beside the anchors' — only
      // the verdicts that write, so "changes pending" stays a count of writes.
      const counts =
        pages?.plan === undefined
          ? result.plan.counts
          : {
              ...result.plan.counts,
              objective_page_update: pages.plan.counts.update,
              objective_page_conflict: pages.plan.counts.conflict,
            };
      return {
        mode: request.mode,
        ran: true,
        full: result.full,
        startedAt,
        finishedAt,
        counts,
        applied:
          result.applied === undefined ? null : result.applied.applied + (pages?.applied ?? 0),
        conflicts:
          result.applied === undefined ? null : result.applied.conflicts + (pages?.conflicts ?? 0),
        refused: result.applied?.refused ?? result.applied?.stopped ?? pages?.stopped ?? null,
        failures: (result.applied?.failures.length ?? 0) + (pages?.failures.length ?? 0),
        drift: result.drift,
        report: pages === undefined ? result.report : `${result.report}\n\n${pages.report}`,
      };
    },
  };
}
