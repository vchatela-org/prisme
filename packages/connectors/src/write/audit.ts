import type { WriteAuditOperation, WriteAuditOutcome, WriteAuditTool } from '@prisme/domain';
import { isConnectorError, type ConnectorFailure } from '../errors.js';
import type { CreationWriter, DocumentCreationWriter } from './create/types.js';
import type { DocumentEntryWriter } from './entry.js';
import type { IdempotencyKey, TaskToolWriter } from './types.js';

/**
 * The audit of outward writes (ADR-0031) — the writers, wrapped.
 *
 * Each of the four writer ports is decorated **where it is constructed**, so
 * an audited writer is the only kind a pass holds. That is the same move the
 * write freeze makes (`./frozen.ts`): a record a call site has to remember to
 * make is a record some call site forgets, and a write path added later would
 * start out unaudited. Here the object in hand records every call it is given,
 * so there is nothing to remember.
 *
 * ## What a record says
 *
 * One call, one record: which tool, which operation, what prisme asked for in
 * its own vocabulary (the draft, the patch, the location), which external
 * object it touched, how long it took, and whether it worked. A failure is
 * recorded as faithfully as a success — the calls that did not work are most
 * of what an audit is read for.
 *
 * ## The write outranks its record
 *
 * A record is written **after** the call returns, and a record that cannot be
 * written does not fail the call. The ordering is forced by what follows a
 * write: the reconciler binds a created anchor and stores `last_applied`, and
 * the creation ledger stores the id it was handed. Failing a write that the
 * tool has already accepted, because a row about it could not be inserted,
 * would skip exactly that bookkeeping — and the next pass would repeat the
 * write, which for a create is the duplicate ADR-0010 exists to prevent. So a
 * sink failure is handed to `onRecordError` and the write's own result
 * stands. The cost is stated in ADR-0031: a process that dies between the call
 * and the insert leaves a write with no record here, and the event log and the
 * creation ledger are where it can still be seen.
 *
 * ## Instance data
 *
 * `request` carries titles, contents and descriptions, and `externalId` names
 * an object in a real workspace. Both go to prisme's own database and to the
 * owner's browser, and never to a log line — `onRecordError` is handed the
 * error, not the record. The `error` recorded for a failed call is a
 * `ConnectorError`'s message, which is redacted by construction; any other
 * throw is summarised, because an arbitrary message is how a title reaches a
 * column.
 */

export interface WriteAttempt {
  readonly tool: WriteAuditTool;
  readonly operation: WriteAuditOperation;
  /**
   * The object written to: the target of an update or a move, or what a create
   * made. Absent when a create failed — there is nothing to name.
   */
  readonly externalId?: string | undefined;
  /** What prisme asked for, in its own vocabulary. **Instance data.** */
  readonly request: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: IdempotencyKey;
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly outcome: WriteAuditOutcome;
  /** A connector failure kind, or `unclassified` for anything else that threw. */
  readonly failure?: ConnectorFailure | 'unclassified' | undefined;
  /** Safe to render: a connector message, or a fixed sentence. */
  readonly error?: string | undefined;
}

export interface WriteAuditSink {
  record(attempt: WriteAttempt): Promise<void>;
}

export interface AuditOptions {
  readonly sink: WriteAuditSink;
  /** Injected, like every clock on the write path. */
  readonly now: () => Date;
  /**
   * Told when a record could not be written. The write it describes has
   * already succeeded or failed on its own terms and that result stands.
   */
  readonly onRecordError: (error: unknown) => void;
}

const UNCLASSIFIED = 'the call failed for a reason prisme could not classify; see the run log';

function failureOf(error: unknown): Pick<WriteAttempt, 'failure' | 'error'> {
  if (isConnectorError(error)) return { failure: error.failure, error: error.message };
  return { failure: 'unclassified', error: UNCLASSIFIED };
}

/**
 * One audited call. `target` is the object's id when it is known before the
 * call (an update, a move); `made` reads it off the result when the call is
 * what makes it (a create).
 */
function audited(options: AuditOptions) {
  return async <T>(
    call: {
      readonly tool: WriteAuditTool;
      readonly operation: WriteAuditOperation;
      readonly request: Readonly<Record<string, unknown>>;
      readonly key: IdempotencyKey;
      readonly target?: string | undefined;
      readonly made?: ((result: T) => string) | undefined;
    },
    perform: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = options.now();
    const record = async (attempt: WriteAttempt): Promise<void> => {
      try {
        await options.sink.record(attempt);
      } catch (error) {
        options.onRecordError(error);
      }
    };
    const base = {
      tool: call.tool,
      operation: call.operation,
      request: call.request,
      idempotencyKey: call.key,
      startedAt,
    };
    const elapsed = (): number => Math.max(0, options.now().getTime() - startedAt.getTime());

    let result: T;
    try {
      result = await perform();
    } catch (error) {
      await record({
        ...base,
        externalId: call.target,
        durationMs: elapsed(),
        outcome: 'failed',
        ...failureOf(error),
      });
      throw error;
    }

    await record({
      ...base,
      externalId: call.made === undefined ? call.target : call.made(result),
      durationMs: elapsed(),
      outcome: 'succeeded',
    });
    return result;
  };
}

const idOf = (result: { readonly externalId: string }): string => result.externalId;

/** The reconciler's writer, audited. */
export function auditTaskToolWriter(writer: TaskToolWriter, options: AuditOptions): TaskToolWriter {
  const call = audited(options);
  return {
    createTask: (draft, key) =>
      call(
        { tool: 'task', operation: 'create_anchor', request: { ...draft }, key, made: idOf },
        () => writer.createTask(draft, key),
      ),
    updateTask: (externalId, patch, key) =>
      call(
        { tool: 'task', operation: 'update_task', request: { ...patch }, key, target: externalId },
        () => writer.updateTask(externalId, patch, key),
      ),
    moveTask: (externalId, location, key) =>
      call(
        { tool: 'task', operation: 'move_task', request: { ...location }, key, target: externalId },
        () => writer.moveTask(externalId, location, key),
      ),
  };
}

/** The creation ledger's task-tool writer, audited. */
export function auditCreationWriter(writer: CreationWriter, options: AuditOptions): CreationWriter {
  const call = audited(options);
  return {
    createProject: (draft, key) =>
      call(
        { tool: 'task', operation: 'create_project', request: { ...draft }, key, made: idOf },
        () => writer.createProject(draft, key),
      ),
    createSection: (draft, key) =>
      call(
        { tool: 'task', operation: 'create_section', request: { ...draft }, key, made: idOf },
        () => writer.createSection(draft, key),
      ),
    createLooseTask: (draft, key) =>
      call(
        { tool: 'task', operation: 'create_capture_task', request: { ...draft }, key, made: idOf },
        () => writer.createLooseTask(draft, key),
      ),
  };
}

/**
 * The document tool's creating writer, audited.
 *
 * A `succeeded` record here means "the page exists now", which is not quite
 * "prisme made it": `createPage` is level-triggered and returns a live entry
 * with the same title when one is already there (ADR-0030 rule 6). The record
 * names the page either way, which is what an audit needs to find it.
 */
export function auditDocumentCreationWriter(
  writer: DocumentCreationWriter,
  options: AuditOptions,
): DocumentCreationWriter {
  const call = audited(options);
  return {
    createPage: (draft, key) =>
      call(
        { tool: 'document', operation: 'create_page', request: { ...draft }, key, made: idOf },
        () => writer.createPage(draft, key),
      ),
  };
}

/**
 * The document tool's editing writer, audited (ADR-0034).
 *
 * The request is recorded in prisme's vocabulary — the dates — and not the
 * column's name, which is the workspace's and adds nothing a person reading the
 * audit needs: the record already names the page.
 */
export function auditDocumentEntryWriter(
  writer: DocumentEntryWriter,
  options: AuditOptions,
): DocumentEntryWriter {
  const call = audited(options);
  return {
    setObjectivePageDates: (write, key) =>
      call(
        {
          tool: 'document',
          operation: 'update_page',
          request: { startsOn: write.startsOn, endsOn: write.endsOn },
          key,
          target: write.pageId,
        },
        () => writer.setObjectivePageDates(write, key),
      ),
  };
}
