import type { CoverageReport } from './coverage.js';
import type { ScanResult } from './queue.js';
import type { Candidate } from './types.js';

/**
 * The adoption plan, rendered for a human.
 *
 * Same standing as `reconcile/format.ts`: **this output is a user interface**.
 * It is the thing a person reads before deciding that a model of years of their
 * own work is right, and the definition of done says "a plan a human agrees
 * with" — which is not something they can do to a wall of JSON.
 *
 * So the shape is: what a machine may do on its own, then what a human has to
 * decide, then what was left alone, then the two numbers that gate the first
 * outward write — link coverage, and how many entities would produce a
 * `create`.
 *
 * > **Never paste real output into this repository.** Every title below is a
 * > real title at runtime (docs/17-privacy.md, apps/sync/CLAUDE.md).
 */

const RULE_WIDTH = 17;
const KIND_WIDTH = 12;
const TITLE_WIDTH = 44;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function clip(text: string, width: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= width ? pad(single, width) : `${single.slice(0, width - 1)}…`;
}

function line(candidate: Candidate): string {
  const proposal = candidate.proposal;
  const rule = proposal === undefined ? 'manual' : proposal.rule;
  const score =
    proposal?.similarity === undefined ? '' : ` (${proposal.similarity.toFixed(3)} similar)`;
  const detail =
    proposal === undefined
      ? candidate.classification.reason
      : `→ ${proposal.prismeId}${score} · ${proposal.confidence}`;
  return `  ${pad(rule, RULE_WIDTH)}${pad(candidate.classification.kind, KIND_WIDTH)}${clip(candidate.object.title, TITLE_WIDTH)}  ${detail}`;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

export interface AdoptionReportOptions {
  /** Lines describing where the state came from. Printed first. */
  readonly source?: readonly string[] | undefined;
  /** `plan` is the only mode there is today — see `formatAdoptionPlan`. */
  readonly mode: 'plan';
}

export function formatAdoptionPlan(
  result: ScanResult,
  report: CoverageReport,
  options: AdoptionReportOptions,
): string {
  const lines: string[] = [];

  for (const source of options.source ?? []) lines.push(source);
  if ((options.source ?? []).length > 0) lines.push('');

  lines.push('Certain — an existing mapping; safe to link without asking (rule 1):');
  if (result.autoLinkable.length === 0) {
    lines.push('  none');
  } else {
    for (const candidate of result.autoLinkable) lines.push(line(candidate));
  }

  lines.push('');
  lines.push('Proposals — nothing here is applied without a human (rules 2–4):');
  const proposals = result.queue.filter(
    (candidate) => candidate.proposal !== undefined && candidate.proposal.confidence !== 'certain',
  );
  if (proposals.length === 0) {
    lines.push('  none');
  } else {
    for (const candidate of proposals) lines.push(line(candidate));
  }

  lines.push('');
  lines.push('Manual — no rule fired; these need a person (rule 5):');
  const manual = result.queue.filter((candidate) => candidate.proposal === undefined);
  if (manual.length === 0) {
    lines.push('  none');
  } else {
    for (const candidate of manual) lines.push(line(candidate));
  }

  lines.push('');
  lines.push('Left where they are — counted, never queued:');
  const left = Object.entries(report.leftInPlace).filter(([, count]) => count > 0);
  if (left.length === 0) {
    lines.push('  none');
  } else {
    for (const [kind, count] of left) {
      lines.push(`  ${pad(kind, KIND_WIDTH)}${String(count)}`);
    }
  }

  lines.push('');
  lines.push(
    `Queue: ${plural(result.queue.length, 'candidate', 'candidates')} — ` +
      `${String(result.autoLinkable.length)} certain, ` +
      `${String(report.queue.manualRemainder)} needing a person. ` +
      `${plural(result.alreadyLinked, 'object is', 'objects are')} already linked, ` +
      `${String(result.ignored)} ignored.`,
  );
  lines.push(
    `Link coverage: ${report.linkCoveragePct.toFixed(1)}% — ` +
      `${String(report.entities.bound)} of ${String(report.entities.total)} entities bound ` +
      `(${String(report.entities.adopted)} adopted, ${String(report.entities.createdInPrisme)} created in prisme).`,
  );

  if (report.adoptedWithoutRef.length > 0) {
    lines.push(
      `Adopted but unbound: ${String(report.adoptedWithoutRef.length)}. ` +
        'An adoption that lost its subject — it produces no create, and it will also never do anything.',
    );
  }

  if (report.wouldCreate.length === 0) {
    lines.push('Would create: 0. Nothing here creates an external object (ADR-0010, guard 2).');
  } else {
    lines.push(
      `Would create: ${String(report.wouldCreate.length)}. During adoption the threshold is 0, ` +
        'so a reconciler pass would refuse this plan — read each line and decide whether the entity ' +
        'should have been adopted rather than created:',
    );
    for (const risk of report.wouldCreate) {
      lines.push(`  ${pad(risk.kind, KIND_WIDTH)}${risk.prismeId}  ${risk.because}`);
    }
  }

  lines.push('');
  lines.push(
    'This command wrote nothing outward and never can: adoption links, it does not create ' +
      '(docs/13-migration.md §1). Decisions are made in the queue at /adoption.',
  );

  return lines.join('\n');
}
