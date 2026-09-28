import { docIdKey, isConnectorError, type DocToolClient } from '@prisme/connectors';
import { idempotencyKey, type DocumentEntryWriter } from '@prisme/connectors/write';
import type { SyncEvent } from '../apply/ports.js';
import { withWriteSubject } from '../audit/subject.js';
import type { ConflictRecord, LastAppliedIndex, LastAppliedWrite } from '../reconcile/types.js';
import {
  formatObjectivePagePlan,
  observedDatesOf,
  planObjectivePages,
  type LinkedObjective,
  type ObjectivePagePlan,
} from './plan.js';

/**
 * One objective-pages pass, end to end: read, plan, optionally apply, report
 * (ADR-0034).
 *
 * It runs inside the reconciler's pass, under its lock, after the task-tool
 * half — so `prisme-sync plan` shows it and `prisme-sync apply` performs it,
 * and a period changed in prisme reaches the page within one pass.
 *
 * **Every pass reads the whole objectives store**, for the reason `../run.ts`
 * gives for the task tool: the planner is level-triggered, and a page absent
 * from a partial read has not changed while one absent from a full read is not
 * the store's. One query, paged, against a store of a person's objectives.
 * Nothing is read at all when there is nothing to reconcile — no store bound,
 * no date column chosen, or no objective linked to a page.
 */

export interface ObjectivePageStore {
  /** The objectives store's date column, when the store is bound and one is chosen. */
  loadDateColumn(): Promise<string | undefined>;
  /** Every objective with a linked page, whatever its status. */
  loadLinkedObjectives(): Promise<readonly LinkedObjective[]>;
  loadLastApplied(): Promise<LastAppliedIndex>;
  recordLastApplied(writes: readonly LastAppliedWrite[], at: Date): Promise<void>;
  recordConflict(conflict: ConflictRecord, at: Date): Promise<void>;
  recordEvent(event: SyncEvent): Promise<void>;
}

export interface ObjectivePagesOptions {
  readonly mode: 'plan' | 'apply';
  readonly store: ObjectivePageStore;
  readonly docClient: Pick<DocToolClient, 'queryByRole'>;
  /** Frozen when the write freeze is on, audited always — built by the caller (ADR-0031). */
  readonly writer: DocumentEntryWriter;
  readonly writeEnabled: boolean;
  readonly runId: string;
  readonly now: () => Date;
}

export interface ObjectivePageFailure {
  readonly objectiveId: string;
  readonly reason: string;
}

export interface ObjectivePagesResult {
  /** Why nothing was read, when nothing was. */
  readonly skipped?: string | undefined;
  readonly plan?: ObjectivePagePlan | undefined;
  /** The plan, rendered. **Contains instance data**; print it, never commit it. */
  readonly report: string;
  readonly applied: number;
  readonly conflicts: number;
  readonly failures: readonly ObjectivePageFailure[];
  /** Set when nothing was attempted, with the reason a human needs. */
  readonly refused?: string | undefined;
  /** Set when the pass stopped part-way — a rejected token. */
  readonly stopped?: string | undefined;
}

const NONE = { applied: 0, conflicts: 0, failures: [] } as const;

/** Safe to log: a connector's message is built without instance data; anything else is named by type. */
function reasonOf(error: unknown): string {
  if (isConnectorError(error)) return error.message;
  return error instanceof Error ? `${error.name} while writing the page` : 'the write failed';
}

export async function reconcileObjectivePages(
  options: ObjectivePagesOptions,
): Promise<ObjectivePagesResult> {
  const dateColumn = await options.store.loadDateColumn();
  if (dateColumn === undefined) {
    const skipped =
      'the objectives store is unbound or has no date column chosen on Settings → Notion';
    return { ...NONE, skipped, report: `objective pages   skipped: ${skipped}` };
  }

  const objectives = await options.store.loadLinkedObjectives();
  if (objectives.length === 0) {
    const skipped = 'no objective is linked to a page';
    return { ...NONE, skipped, report: `objective pages   skipped: ${skipped}` };
  }

  const [records, lastApplied] = await Promise.all([
    options.docClient.queryByRole('objectives_db'),
    options.store.loadLastApplied(),
  ]);

  const entries = records.map((record) => ({
    pageId: record.externalId,
    archived: record.archived,
    dates: observedDatesOf(record.properties.get(dateColumn)),
  }));

  const plan = planObjectivePages(objectives, entries, lastApplied, { pageKey: docIdKey });
  const report = formatObjectivePagePlan(plan);
  const writes = plan.actions.filter((action) => action.write !== undefined);

  if (options.mode === 'plan' || writes.length === 0) return { ...NONE, plan, report };

  if (!options.writeEnabled) {
    return {
      ...NONE,
      plan,
      report,
      refused: 'SYNC_WRITE_ENABLED is false: no outward write was attempted',
    };
  }

  let applied = 0;
  let conflicts = 0;
  const failures: ObjectivePageFailure[] = [];

  for (const action of writes) {
    const write = action.write;
    /* c8 ignore next -- filtered above */
    if (write === undefined) continue;
    try {
      const key = idempotencyKey({
        runId: options.runId,
        operation: 'update_page',
        subject: write.pageId,
        payload: write,
      });
      await withWriteSubject({ entityKind: 'objective', entityId: action.objectiveId }, () =>
        options.writer.setObjectivePageDates(
          {
            pageId: write.pageId,
            property: dateColumn,
            startsOn: write.startsOn,
            endsOn: write.endsOn,
          },
          key,
        ),
      );

      const at = options.now();
      await options.store.recordLastApplied(action.lastApplied, at);
      if (action.conflict !== undefined) {
        await options.store.recordConflict(action.conflict, at);
        conflicts += 1;
      }
      await options.store.recordEvent({
        kind: 'sync_action',
        entityKind: 'objective',
        entityId: action.objectiveId,
        after: { tag: action.verdict, detail: action.detail },
        occurredAt: at,
      });
      applied += 1;
    } catch (error) {
      // A rejected token fails every later call the same way, and retrying a
      // bad credential risks a lockout.
      if (isConnectorError(error) && error.failure === 'invalid_token') {
        return { plan, report, applied, conflicts, failures, stopped: reasonOf(error) };
      }
      failures.push({ objectiveId: action.objectiveId, reason: reasonOf(error) });
    }
  }

  return { plan, report, applied, conflicts, failures };
}
