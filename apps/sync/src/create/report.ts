import type { ConvergePlan } from './types.js';

/**
 * The converge pass's output, rendered for a human.
 *
 * Same standing as `reconcile/format.ts`: **this is a user interface.** It is
 * what somebody reads before the first `prisme-sync create --apply` against a
 * real workspace, and the question it has to answer in one screen is "how many
 * objects is this about to add, and to where".
 *
 * > **Never paste real output into this repository.** A section's name and a
 * > capture's content are instance data (docs/17-privacy.md,
 * > apps/sync/CLAUDE.md).
 *
 * The blocked lines are as important as the runnable ones, and are printed
 * with their reason rather than counted. A plan that shows only what it will
 * do is not a preview of a pass in which most things are waiting on something.
 */

const KIND_WIDTH = 9;
const ENTITY_WIDTH = 12;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export interface ConvergeReportOptions {
  readonly mode: 'plan' | 'apply';
  readonly writeEnabled: boolean;
  readonly maxPerPass: number;
  readonly created?: number | undefined;
  readonly failed?: number | undefined;
}

export function formatConvergePlan(plan: ConvergePlan, options: ConvergeReportOptions): string {
  const lines: string[] = [];

  lines.push(`creation ledger   mode=${options.mode}   cap=${String(options.maxPerPass)}`);
  if (!options.writeEnabled) {
    // The expected state of a fresh deployment, said plainly rather than as a
    // warning: an operator reading "0 created" needs to know whether that is
    // an empty queue or a closed door. Under `apply` it also says that
    // nothing was *attempted* — a frozen pass records no failures, so an
    // empty failure count here means the door was shut rather than that
    // every write worked.
    lines.push(
      options.mode === 'apply'
        ? 'write freeze      ON — nothing was attempted (SYNC_WRITE_ENABLED=false)'
        : 'write freeze      ON — nothing will be created (SYNC_WRITE_ENABLED=false)',
    );
  }
  lines.push('');

  if (plan.steps.length === 0) {
    lines.push('nothing outstanding. Every creation prisme intended has been confirmed.');
    return lines.join('\n');
  }

  for (const step of plan.steps) {
    const kind = pad(step.intent.objectKind, KIND_WIDTH);
    const entity = pad(step.intent.entityKind, ENTITY_WIDTH);
    if (step.kind === 'run') {
      lines.push(`create   ${kind} ${entity} attempt ${String(step.intent.attempts + 1)}`);
    } else {
      lines.push(`blocked  ${kind} ${entity} ${step.reason}`);
    }
  }

  lines.push('');
  lines.push(
    `${String(plan.runnable)} runnable, ${String(plan.blocked)} blocked` +
      (options.created === undefined
        ? ''
        : `   ·   ${String(options.created)} created, ${String(options.failed ?? 0)} failed`),
  );

  return lines.join('\n');
}
