import { isConnectorError } from '@prisme/connectors';
import { idempotencyKey, type TaskToolWriter } from '@prisme/connectors/write';
import type { Action, LastAppliedWrite, Operation, Plan } from '../reconcile/types.js';
import type { ReconcilerStore } from './ports.js';

/**
 * `apply` — the half that writes.
 *
 * Everything difficult was decided by the planner; this executes a decision
 * that has already been made, in the order it was made, and records what
 * happened. Four properties hold and each is load-bearing:
 *
 * 1. **The threshold is checked before anything runs** (ADR-0010, guard 3).
 *    During adoption it is `0`, so any create at all stops the pass.
 * 2. **The write freeze short-circuits the whole thing**, and the writer handed
 *    in when the freeze is on cannot reach an API anyway.
 * 3. **Actions are independent.** One failure is recorded and the rest proceed;
 *    the next pass re-plans and completes what is left (docs/16-sync.md §6).
 *    The single exception is a rejected credential, which stops the pass —
 *    retrying a bad token risks locking the integration out.
 * 4. **Bookkeeping follows the write, never precedes it.** `last_applied` is
 *    written after the tool has accepted the change, because a `last_applied`
 *    recording a write that did not happen turns the overwrite guard into a
 *    silent stomp on the next pass.
 */

export interface ApplyOptions {
  readonly writer: TaskToolWriter;
  readonly store: ReconcilerStore;
  /** Injected. The apply path has a clock; the planner does not. */
  readonly now: () => Date;
  /** Scopes idempotency keys to this pass — see `@prisme/connectors/write`. */
  readonly runId: string;
  readonly writeEnabled: boolean;
  readonly createThreshold: number;
}

export interface ApplyFailure {
  readonly action: Action;
  readonly reason: string;
}

export interface ApplyResult {
  /** Actions carried out in full. */
  readonly applied: number;
  /** Individual operations performed, outward and inward. */
  readonly operations: number;
  readonly conflicts: number;
  readonly failures: readonly ApplyFailure[];
  /** Set when the plan was not executed at all, with the reason a human needs. */
  readonly refused?: string | undefined;
  /** Set when the pass stopped part-way, with the reason. */
  readonly stopped?: string | undefined;
}

/** An error message safe to carry into a log line, a journal or a PR. */
function reasonOf(error: unknown): string {
  // Connector errors are built to carry no secret and no instance data. Anything
  // else — a driver error, a constraint violation — can quote a row, so only its
  // type crosses this line. The full object goes to the redacting logger.
  if (isConnectorError(error)) return error.message;
  return error instanceof Error ? `${error.name} while applying the action` : 'the action failed';
}

function stopsThePass(error: unknown): boolean {
  return isConnectorError(error) && error.failure === 'invalid_token';
}

export async function apply(plan: Plan, options: ApplyOptions): Promise<ApplyResult> {
  const empty: ApplyResult = { applied: 0, operations: 0, conflicts: 0, failures: [] };

  if (plan.counts.create > options.createThreshold) {
    return {
      ...empty,
      refused:
        `the plan creates ${String(plan.counts.create)} objects and SYNC_CREATE_THRESHOLD is ` +
        `${String(options.createThreshold)}; nothing was applied`,
    };
  }

  if (!options.writeEnabled) {
    return { ...empty, refused: 'SYNC_WRITE_ENABLED is false: no outward write was attempted' };
  }

  let applied = 0;
  let operations = 0;
  let conflicts = 0;
  const failures: ApplyFailure[] = [];
  let stopped: string | undefined;

  for (const action of plan.actions) {
    if (stopped !== undefined) break;
    if (action.tag === 'skip' || action.operations.length === 0) continue;

    try {
      const at = options.now();
      // A create does not know its own external id until the tool answers, so
      // the bookkeeping it asks for is resolved against what came back.
      let createdId: string | undefined;

      for (const operation of action.operations) {
        createdId = (await run(operation, action, createdId)) ?? createdId;
        operations += 1;
      }

      const writes = resolve(action.lastApplied, createdId);
      if (writes.length > 0) await options.store.recordLastApplied(writes, at);

      if (action.conflict !== undefined) {
        await options.store.recordConflict(action.conflict, at);
        conflicts += 1;
      }

      await options.store.recordEvent({
        kind: 'sync_action',
        entityKind: action.subject,
        entityId: action.initiativeId ?? action.externalId ?? createdId ?? 'unknown',
        ...(action.before === undefined ? {} : { before: action.before }),
        after: { tag: action.tag, detail: action.detail },
        occurredAt: at,
      });

      applied += 1;
    } catch (error) {
      if (stopsThePass(error)) {
        stopped = reasonOf(error);
        break;
      }
      failures.push({ action, reason: reasonOf(error) });
    }
  }

  return {
    applied,
    operations,
    conflicts,
    failures,
    ...(stopped === undefined ? {} : { stopped }),
  };

  /** Performs one operation, returning a newly created external id when there is one. */
  async function run(
    operation: Operation,
    action: Action,
    createdId: string | undefined,
  ): Promise<string | undefined> {
    const at = options.now();
    const key = (subject: string, payload?: unknown): string =>
      idempotencyKey({ runId: options.runId, operation: operation.type, subject, payload });

    switch (operation.type) {
      case 'create_anchor': {
        const created = await options.writer.createTask(
          operation.draft,
          key(operation.initiativeId, operation.draft),
        );
        await options.store.bindExternalRef({
          initiativeId: operation.initiativeId,
          externalId: created.externalId,
          at,
        });
        return created.externalId;
      }

      case 'update_task': {
        await options.writer.updateTask(
          operation.externalId,
          operation.patch,
          key(operation.externalId, operation.patch),
        );
        return undefined;
      }

      case 'move_task': {
        await options.writer.moveTask(
          operation.externalId,
          operation.location,
          key(operation.externalId, operation.location),
        );
        return undefined;
      }

      case 'bind_ref': {
        await options.store.bindExternalRef({
          initiativeId: operation.initiativeId,
          externalId: operation.externalId,
          // A decision the adoption queue already took, executed here.
          link: { matchRule: 'manual', confidence: 'certain', decidedBy: 'human' },
          at,
        });
        return undefined;
      }

      case 'adopt_deadline': {
        await options.store.adoptDeadline({
          initiativeId: operation.initiativeId,
          deadline: operation.deadline,
          at,
        });
        return undefined;
      }

      case 'capture_initiative': {
        const initiativeId = await options.store.captureInitiative({
          externalId: operation.externalId,
          title: operation.title,
          areaKey: operation.areaKey,
          ...(operation.deadline === undefined ? {} : { deadline: operation.deadline }),
          at,
        });
        await options.store.bindExternalRef({
          initiativeId,
          externalId: operation.externalId,
          // The human put the label on the task; that is the decision.
          link: { matchRule: 'manual', confidence: 'certain', decidedBy: 'human' },
          at,
        });
        await options.store.recordEvent({
          kind: 'adoption_decision',
          entityKind: 'initiative',
          entityId: initiativeId,
          after: { decision: 'adopt', via: 'anchor label' },
          occurredAt: at,
        });
        return undefined;
      }

      case 'set_status': {
        await options.store.setStatus({
          initiativeId: operation.initiativeId,
          from: operation.from,
          to: operation.to,
          at,
        });
        await options.store.recordEvent({
          kind: 'status_changed',
          entityKind: 'initiative',
          entityId: operation.initiativeId,
          field: 'status',
          before: operation.from,
          after: operation.to,
          occurredAt: at,
        });
        return undefined;
      }

      case 'record_rollup': {
        await options.store.recordRollup({
          initiativeId: operation.initiativeId,
          areaKey: operation.areaKey,
          rollup: operation.rollup,
          anchorTask: operation.anchorTask,
          subtree: operation.subtree,
          at,
        });
        return undefined;
      }

      /* c8 ignore next 3 -- the union is closed; this is the compiler's proof, not a branch */
      default: {
        void action;
        void createdId;
        return undefined;
      }
    }
  }
}

/** Fills in the external id a create only learns after the fact. */
function resolve(
  writes: readonly LastAppliedWrite[],
  createdId: string | undefined,
): readonly LastAppliedWrite[] {
  return writes
    .map((write) =>
      write.entityId === '' && createdId !== undefined ? { ...write, entityId: createdId } : write,
    )
    .filter((write) => write.entityId !== '');
}
