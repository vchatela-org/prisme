import type { Action, Plan } from './types.js';

/**
 * The plan, rendered for a human.
 *
 * **This output is a user interface** (apps/sync/CLAUDE.md). A person reads it
 * before the first `apply` and before every risky one after that; if it is hard
 * to read it will not be read, and then the gate is decorative.
 *
 * So: one line per decision, columns that line up, the difficult things first,
 * and a summary that answers the only question that matters at the bottom of a
 * long plan — *how many things is this about to create?*
 *
 * The rendering is pure and takes every number it prints. Nothing here reaches
 * for a clock, and nothing here decides anything.
 *
 * > **Never paste real output into this repository.** Every title below is
 * > instance data at runtime (docs/17-privacy.md).
 */

export interface PlanReport {
  /** Lines describing where the state came from. Printed above the actions. */
  readonly source?: readonly string[] | undefined;
  readonly writeEnabled: boolean;
  readonly createThreshold: number;
  /** `apply` prints the same plan with its outcome; `plan` prints the invitation. */
  readonly mode: 'plan' | 'apply';
}

// One wider than the longest tag (`conflict`), so the column after it never
// runs into it. Caught by reading real output, not by a unit test.
const TAG_WIDTH = 9;
const SUBJECT_WIDTH = 11;
const TITLE_WIDTH = 44;

/** The order a reader wants: what must be decided, then what will change. */
const TAG_ORDER = ['conflict', 'review', 'create', 'adopt', 'update', 'skip'] as const;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** One column stays inside its width, so the columns after it still line up. */
function clip(text: string, width: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= width ? pad(single, width) : `${single.slice(0, width - 1)}…`;
}

function line(action: Action): string {
  return `  ${pad(action.tag, TAG_WIDTH)}${pad(action.subject, SUBJECT_WIDTH)}${clip(action.title, TITLE_WIDTH)}  ${action.detail}`;
}

function summarise(plan: Plan): string {
  const { counts } = plan;
  const parts = [
    `${String(counts.create)} to create`,
    `${String(counts.adopt)} to adopt`,
    `${String(counts.update)} to update`,
    `${String(counts.review)} to review`,
    `${String(counts.conflict)} ${counts.conflict === 1 ? 'conflict' : 'conflicts'}`,
    `${String(counts.skip)} unchanged`,
  ];
  return `Plan: ${parts.join(', ')}.`;
}

export function formatPlan(plan: Plan, report: PlanReport): string {
  const lines: string[] = [];

  for (const source of report.source ?? []) lines.push(source);
  if ((report.source ?? []).length > 0) lines.push('');

  const shown = TAG_ORDER.filter((tag) => tag !== 'skip').flatMap((tag) =>
    plan.actions.filter((action) => action.tag === tag),
  );

  if (shown.length === 0) {
    lines.push('  nothing to do: every object matches what prisme intends');
  } else {
    for (const action of shown) lines.push(line(action));
  }

  lines.push('');
  lines.push(summarise(plan));

  if (plan.counts.create > report.createThreshold) {
    lines.push(
      `Refused: ${String(plan.counts.create)} creates exceeds SYNC_CREATE_THRESHOLD=${String(report.createThreshold)}. ` +
        'Nothing was applied — read the create lines above; during adoption any create at all is a bug (ADR-0010, guard 3).',
    );
    return lines.join('\n');
  }

  if (!report.writeEnabled) {
    lines.push(
      'Write freeze is on (SYNC_WRITE_ENABLED=false): apply would change nothing outward.',
    );
    return lines.join('\n');
  }

  if (report.mode === 'plan') lines.push('Run `prisme-sync apply` to execute.');
  return lines.join('\n');
}
