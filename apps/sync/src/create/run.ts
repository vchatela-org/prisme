import { isConnectorError } from '@prisme/connectors';
import type { CreationWriter, DocumentCreationWriter } from '@prisme/connectors/write';
import type { PageKind } from '@prisme/connectors';
import { applyOutcome, orderConvergence } from './order.js';
import type { CreationStore } from './ports.js';
import { formatConvergePlan } from './report.js';
import type { ConvergePlan, Intent, Step, StepOutcome } from './types.js';

/**
 * One converge pass: drain the creation ledger.
 *
 * ## `plan` before `apply`, like everything else here
 *
 * `plan` reads the ledger and prints what would be created. It writes nothing
 * — not even an attempt count — so it is free to run at any time, including
 * under the write freeze, which is exactly when somebody wants to know what
 * is queued up behind it.
 *
 * ## One step at a time, each committed before the next
 *
 * This is the property the whole workstream turns on, and it is why there is
 * no `Promise.all` here. A project, three sections and a page are five writes
 * across two systems with no transaction between them. Doing them
 * concurrently would make "which ones happened" a question about interleaving;
 * doing them in sequence and **committing each outcome before starting the
 * next** makes a crash at any point leave a ledger that says precisely how far
 * it got.
 *
 * So: a failure does not abort the pass and does not roll anything back. It is
 * recorded, and the pass continues with whatever is still runnable — which is
 * how "a simulated failure partway through project creation leaves a
 * recoverable state, not orphans in one tool" is true rather than hoped.
 *
 * ## Re-planning between steps
 *
 * The plan is recomputed after each outcome rather than walked as a list. A
 * section becomes runnable the moment its project is satisfied, and a section
 * whose project just failed becomes blocked with a reason — both fall out of
 * asking again, and neither needs the ordering code to model the cascade.
 */

export interface ConvergeOptions {
  readonly mode: 'plan' | 'apply';
  readonly store: CreationStore;
  /** Frozen unless `SYNC_WRITE_ENABLED`; the freeze is the object, not a flag. */
  readonly writer: CreationWriter;
  /** The document tool's creating port. Frozen on the same terms. */
  readonly documents: DocumentCreationWriter;
  /**
   * The page kinds this instance has bound a store and a template for
   * (ADR-0025). Empty until a `bindings` run has named them, which is the
   * state the plan describes rather than fails on.
   */
  readonly addressablePageKinds: ReadonlySet<PageKind>;
  readonly writeEnabled: boolean;
  /**
   * The most creations one pass will attempt.
   *
   * A ledger that has somehow accumulated hundreds of intents is a bug
   * upstream, and draining it silently would turn that bug into hundreds of
   * objects in a real workspace before anybody read a log line. The cap stops
   * and says so — the same instinct as `SYNC_CREATE_THRESHOLD` (ADR-0010,
   * guard 3), applied to a queue rather than to a diff.
   */
  readonly maxPerPass: number;
  readonly now: () => Date;
}

export interface ConvergeResult {
  readonly plan: ConvergePlan;
  /** The plan, rendered. **Contains instance data**; print it, never commit it. */
  readonly report: string;
  readonly created: number;
  readonly failed: number;
  readonly outcomes: readonly StepOutcome[];
  /** Set when the pass stopped before draining what it could have. */
  readonly stopped?: string | undefined;
  /**
   * Set when the pass declined to attempt anything — today, only the write
   * freeze. A refusal is **not** a failure: it is the configured, expected
   * state of a deployment before docs/13-migration.md §5 step 8, and a caller
   * exits clean on it.
   */
  readonly refused?: string | undefined;
}

/**
 * The writer call for one resolved creation. Exhaustive by construction.
 *
 * Two writers, because a creation reaches one of two tools: `writer` is the
 * task tool's creating port and `documents` is the document tool's. Which one
 * a step needs is a property of the creation, so the switch decides — and the
 * absence of a `default` is what makes a fourth kind a compile error rather
 * than a step that silently does nothing.
 */
async function perform(
  writer: CreationWriter,
  documents: DocumentCreationWriter,
  step: Extract<Step, { kind: 'run' }>,
): Promise<string> {
  const key = step.intent.idempotencyKey;
  switch (step.creation.kind) {
    case 'project': {
      const { externalId } = await writer.createProject(step.creation.draft, key);
      return externalId;
    }
    case 'section': {
      const { externalId } = await writer.createSection(step.creation.draft, key);
      return externalId;
    }
    case 'task': {
      const { externalId } = await writer.createLooseTask(step.creation.draft, key);
      return externalId;
    }
    case 'page': {
      const { externalId } = await documents.createPage(step.creation.draft, key);
      return externalId;
    }
  }
}

/**
 * The sentence recorded against a failed intent.
 *
 * A `ConnectorError`'s message is already redacted by construction — it names
 * the tool, the operation and an error *code*, never the tool's prose. Any
 * other throw is summarised rather than stringified: an arbitrary error's
 * message is the one channel by which a title could reach a column the UI
 * renders.
 */
function reasonOf(error: unknown): string {
  if (isConnectorError(error)) return error.message;
  return 'the creation failed for a reason prisme could not classify; see the run log';
}

export async function converge(options: ConvergeOptions): Promise<ConvergeResult> {
  let intents: readonly Intent[] = await options.store.loadOutstanding();
  const refsByEntity = await options.store.loadEntityRefs([
    ...new Set(intents.map((intent) => intent.entityId)),
  ]);

  const initial = orderConvergence({
    intents,
    refsByEntity,
    addressablePageKinds: options.addressablePageKinds,
  });

  /*
   * A frozen deployment does not *attempt* anything.
   *
   * The frozen writer would refuse each call, which is the structural
   * backstop and stays. But letting the pass run into it is wrong in a way
   * only a real frozen instance shows: every intent is recorded `failed`,
   * every attempt counter climbs, and the ledger a person reads says
   * "5 failed" about an instance that is behaving exactly as configured. The
   * next pass then does it again, so the count grows forever and the CronJob
   * is red every fifteen minutes.
   *
   * The write freeze is the expected state of a fresh deployment
   * (docs/13-migration.md §5 step 8), so it is a **refusal** rather than a
   * failure — the same distinction `apply` draws in `apply/apply.ts`, and the
   * reason its caller exits clean while frozen.
   */
  const frozen = options.mode === 'apply' && !options.writeEnabled;

  if (options.mode === 'plan' || frozen) {
    return {
      plan: initial,
      report: formatConvergePlan(initial, {
        mode: options.mode,
        writeEnabled: options.writeEnabled,
        maxPerPass: options.maxPerPass,
      }),
      created: 0,
      failed: 0,
      outcomes: [],
      ...(frozen
        ? { refused: 'the write freeze is on, so nothing was attempted (SYNC_WRITE_ENABLED=false)' }
        : {}),
    };
  }

  const outcomes: StepOutcome[] = [];
  /*
   * What this pass has already tried. A `failed` intent is not terminal — a
   * rate limit or a 5xx is worth another go — but the next pass is where that
   * happens, not three milliseconds later. Without this the loop re-plans,
   * sees the row still unsatisfied, and spends the whole cap retrying one
   * object with no backoff.
   */
  const attempted = new Set<string>();
  let created = 0;
  let failed = 0;
  let stopped: string | undefined;

  for (;;) {
    const plan = orderConvergence({
      intents,
      refsByEntity,
      attempted,
      addressablePageKinds: options.addressablePageKinds,
    });
    const next = plan.steps.find((step) => step.kind === 'run');
    if (next === undefined) break;

    if (created + failed >= options.maxPerPass) {
      stopped = `stopped at the per-pass cap of ${String(options.maxPerPass)} creations; run again to continue`;
      break;
    }

    attempted.add(next.intent.id);

    let externalId: string;
    try {
      externalId = await perform(options.writer, options.documents, next);
    } catch (error) {
      const reason = reasonOf(error);
      // Recorded before anything else happens. A failure the ledger does not
      // know about is a failure the next pass will repeat.
      await options.store.recordFailed({
        intentId: next.intent.id,
        reason,
        at: options.now(),
      });
      intents = applyOutcome(intents, next.intent.id, { ok: false });
      outcomes.push({ intentId: next.intent.id, ok: false, reason });
      failed += 1;
      continue;
    }

    /*
     * The write has happened. Recording it is the step that must not be
     * skipped: an object created and not recorded is the orphan, and the
     * *only* thing that saves it is the stored idempotency key — the next
     * pass sends the same command and the tool hands back the same object
     * rather than making a second.
     */
    await options.store.recordSatisfied({
      intentId: next.intent.id,
      externalId,
      at: options.now(),
    });
    intents = applyOutcome(intents, next.intent.id, { ok: true, externalId });
    outcomes.push({ intentId: next.intent.id, ok: true, externalId });
    created += 1;
  }

  // The closing plan is computed *without* `attempted`, so it reports what is
  // genuinely still outstanding rather than what this pass has left to do.
  const finalPlan = orderConvergence({
    intents,
    refsByEntity,
    addressablePageKinds: options.addressablePageKinds,
  });

  return {
    plan: finalPlan,
    report: formatConvergePlan(finalPlan, {
      mode: 'apply',
      writeEnabled: options.writeEnabled,
      maxPerPass: options.maxPerPass,
      created,
      failed,
    }),
    created,
    failed,
    outcomes,
    ...(stopped === undefined ? {} : { stopped }),
  };
}
