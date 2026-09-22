import type { TaskToolClient } from '@prisme/connectors';
import type { TaskToolWriter } from '@prisme/connectors/write';
import { apply, type ApplyResult } from './apply/apply.js';
import type { ReconcilerStore } from './apply/ports.js';
import { formatPlan } from './reconcile/format.js';
import { DEFAULT_ANCHOR_LABEL, DEFAULT_STATUS_REQUEST_PREFIX } from './reconcile/labels.js';
import { plan } from './reconcile/plan.js';
import { changesOf, type Plan, type PlannerConfig } from './reconcile/types.js';

/**
 * One reconciler pass, end to end: read, plan, optionally apply, report.
 *
 * **Two entrypoints, one library** (docs/16-sync.md §7). The CronJob binary and
 * the API's `POST /sync` both call this function behind the same advisory lock,
 * so the scheduled run and the force-sync button are provably the same code
 * path rather than two implementations that drift.
 *
 * ### Why every pass reads the whole task tool
 *
 * docs/16-sync.md §2 describes an incremental read between daily full passes.
 * The planner is level-triggered (ADR-0009): it decides by comparing **full**
 * desired state against **full** observed state, and a partial observation is
 * not a smaller version of that — it is a different question. An anchor absent
 * from an incremental response has not changed; an anchor absent from a full
 * response has been deleted, and the two demand opposite responses.
 *
 * So the observed state is always a full fetch. It costs one request against a
 * personal-sized workspace, where the spec's concern — quota — does not bite at
 * a fifteen-minute cadence. The incremental read keeps its job, and it is the
 * one the spec cares most about: it is how **drift** is measured. Any object
 * the full view finds changed that the incremental stream never mentioned is an
 * object the incremental path would have missed, and that count is
 * `prisme_sync_drift_objects`. A `plan` makes no incremental call at all,
 * because advancing a cursor is a side effect and `plan` has none.
 */

export interface ReconcileOptions {
  readonly mode: 'plan' | 'apply';
  /** Force a full pass. The daily one is decided from the cursor. */
  readonly full?: boolean | undefined;
  readonly store: ReconcilerStore;
  readonly taskClient: TaskToolClient;
  readonly writer: TaskToolWriter;
  readonly writeEnabled: boolean;
  readonly createThreshold: number;
  readonly baseUrl: string;
  readonly runId: string;
  readonly now: () => Date;
  readonly anchorLabel?: string | undefined;
  readonly statusRequestPrefix?: string | undefined;
}

export interface ReconcileResult {
  readonly plan: Plan;
  /** The plan, rendered. **Contains instance data**; print it, never commit it. */
  readonly report: string;
  readonly applied?: ApplyResult | undefined;
  /** Objects the full view found changed that the incremental stream missed. */
  readonly drift: number;
  readonly full: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isFullPassDue(lastFullPassAt: Date | undefined, now: Date): boolean {
  if (lastFullPassAt === undefined) return true;
  return now.getTime() - lastFullPassAt.getTime() >= DAY_MS;
}

export async function reconcile(options: ReconcileOptions): Promise<ReconcileResult> {
  const startedAt = options.now();
  const [desired, lastApplied, cursor] = await Promise.all([
    options.store.loadDesired(),
    options.store.loadLastApplied(),
    options.store.loadCursor(),
  ]);

  const full = options.full === true || isFullPassDue(cursor.lastFullPassAt, startedAt);

  // The incremental read is a measurement, not the source of truth, and it
  // moves a cursor — so it happens only where side effects are allowed.
  const changed =
    options.mode === 'apply'
      ? new Set(
          (await options.taskClient.syncIncremental(cursor.taskToolToken)).changes
            .filter((change) => change.kind === 'task')
            .map((change) => change.task.externalId),
        )
      : undefined;

  const snapshot = await options.taskClient.fetchAll();

  const plannerConfig: PlannerConfig = {
    anchorLabel: options.anchorLabel ?? DEFAULT_ANCHOR_LABEL,
    statusRequestPrefix: options.statusRequestPrefix ?? DEFAULT_STATUS_REQUEST_PREFIX,
    baseUrl: options.baseUrl,
  };

  const result = plan(desired, { tasks: snapshot.tasks }, lastApplied, plannerConfig);

  const drift =
    changed === undefined
      ? 0
      : new Set(
          changesOf(result)
            .map((action) => action.externalId)
            .filter((id): id is string => id !== undefined && !changed.has(id)),
        ).size;

  const source = [
    `task tool       ${full ? 'full pass' : 'incremental'}   objects=${String(snapshot.tasks.length)}` +
      (changed === undefined ? '' : `   changed=${String(changed.size)}   drift=${String(drift)}`),
  ];

  if (options.mode === 'plan') {
    return {
      plan: result,
      report: formatPlan(result, {
        source,
        writeEnabled: options.writeEnabled,
        createThreshold: options.createThreshold,
        mode: 'plan',
      }),
      drift,
      full,
    };
  }

  const applied = await apply(result, {
    writer: options.writer,
    store: options.store,
    now: options.now,
    runId: options.runId,
    writeEnabled: options.writeEnabled,
    createThreshold: options.createThreshold,
  });

  // The cursor advances only on a pass that was allowed to write, and only
  // after the writes it covers were attempted. A token advanced past changes
  // nothing acted on is how an edit disappears silently (ADR-0018).
  if (applied.refused === undefined) {
    await options.store.saveCursor({
      ...cursor,
      taskToolToken: snapshot.token,
      ...(full ? { lastFullPassAt: startedAt } : {}),
    });
  }

  /*
   * Record the outcome where something scrapeable can find it.
   *
   * This lives in the library rather than in either entrypoint on purpose. The
   * CronJob pod is never scraped — no Service, seconds of life — so the two
   * metrics docs/15-runtime.md §5 specifies were invisible in production, and
   * the API republishes them from this row. Putting the write in `main.ts`
   * beside the in-process gauges would have left the force-sync path recording
   * nothing, which is precisely the "two implementations that drift" this
   * module exists to prevent.
   *
   * A `plan` never reaches this line: recording is a side effect and `plan` has
   * none. A refused pass does, because the drift it measured is still a real
   * measurement — `succeeded` is what tells the two apart.
   */
  await options.store.recordPassOutcome({
    at: options.now(),
    succeeded: applied.refused === undefined && applied.stopped === undefined,
    drift,
    full,
  });

  return {
    plan: result,
    report: formatPlan(result, {
      source,
      writeEnabled: options.writeEnabled,
      createThreshold: options.createThreshold,
      mode: 'apply',
    }),
    applied,
    drift,
    full,
  };
}
