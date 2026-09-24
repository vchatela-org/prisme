import type { AttributionResult } from './attribute.js';
import type { ResumePlan } from './slices.js';
import type { AdherencePeriod, CapacityWeek, RitualRecord } from './types.js';
import type { UnreadReason } from '../unread.js';

/**
 * The backfill's output, rendered for a human.
 *
 * Same standing as `reconcile/format.ts` and `adoption/report.ts`: **this is a
 * user interface**. What it is for is narrower than either, and it is the one
 * thing the brief insists on — "the known limitation must be carried through,
 * not hidden". Capacity measured this way is *attention routed through tasks*,
 * not hours lived, and the number that says how much of it is guesswork is the
 * share attributed from the configured default. It is printed as a headline
 * rather than a footnote, because W09 has to label the chart with it and
 * nobody can label what they were never told.
 *
 * > **Never paste real output into this repository.** The unmapped locations
 * > below are real project ids from a real workspace, and a ritual's name is a
 * > real name (docs/17-privacy.md, apps/sync/CLAUDE.md).
 */

const LABEL_WIDTH = 18;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;
}

export interface BackfillReportInput {
  readonly plan: ResumePlan;
  readonly fetched: number;
  readonly attribution: AttributionResult;
  readonly weeks: readonly CapacityWeek[];
  readonly adherence: readonly AdherencePeriod[];
  readonly unmeasurableRituals: readonly RitualRecord[];
  readonly declaredDurationsKnown: number;
  readonly documentToolRead: boolean;
  /** The failure kind, when a read was attempted and did not happen. See `unread.ts`. */
  readonly documentToolUnread?: UnreadReason | undefined;
}

export function formatBackfillReport(
  input: BackfillReportInput,
  covered: { readonly from: Date; readonly to: Date },
): string {
  const lines: string[] = [];
  const { attribution } = input;

  const totals = { recorded: 0, declared: 0, default: 0 };
  let minutes = 0;
  for (const week of input.weeks) {
    minutes += week.minutes;
    totals.recorded += week.minutesBySource.recorded;
    totals.declared += week.minutesBySource.declared;
    totals.default += week.minutesBySource.default;
  }

  const placed = attribution.attributed.length;
  const unplaced = attribution.gaps.reduce((sum, gap) => sum + gap.completions, 0);

  lines.push(
    `range           ${covered.from.toISOString().slice(0, 10)} → ${covered.to
      .toISOString()
      .slice(0, 10)}   (${input.plan.reason})`,
  );
  lines.push(
    `task tool       ${plural(input.plan.slices.length, 'window', 'windows')} fetched   ${plural(
      input.fetched,
      'completion',
      'completions',
    )}`,
  );
  lines.push(
    `document tool   ${
      input.documentToolRead
        ? `processes read   ${plural(input.declaredDurationsKnown, 'declared duration', 'declared durations')}`
        : // The reason, when there is one: a store nobody bound and a read that
          // was refused are the same sentence here without it, and they call
          // for opposite responses (`unread.ts`). A tier that is off by
          // configuration reports no reason, because the caller already knows.
          `not read — the declared-duration tier is unavailable${
            input.documentToolUnread === undefined ? '' : ` (${input.documentToolUnread})`
          }`
    }`,
  );
  lines.push('');

  lines.push('Attribution — an unmapped project is a configuration gap, not noise:');
  lines.push(`  ${pad('placed', LABEL_WIDTH)}${String(placed)}`);
  lines.push(
    `  ${pad('unattributable', LABEL_WIDTH)}${String(unplaced)}  (${pct(unplaced, placed + unplaced)} of history)`,
  );
  if (attribution.danglingAreas > 0) {
    lines.push(
      `  ${pad('dangling area', LABEL_WIDTH)}${String(attribution.danglingAreas)}  mapped to an area that no longer exists`,
    );
  }
  if (attribution.gaps.length > 0) {
    lines.push('  locations to map, commonest first:');
    for (const gap of attribution.gaps.slice(0, 20)) {
      const where =
        gap.externalSectionId === undefined
          ? (gap.externalProjectId ?? 'no project')
          : `${gap.externalProjectId ?? 'no project'} / ${gap.externalSectionId}`;
      lines.push(`    ${pad(String(gap.completions), 8)}${where}`);
    }
    if (attribution.gaps.length > 20) {
      lines.push(`    …and ${String(attribution.gaps.length - 20)} more locations`);
    }
  }
  lines.push('');

  lines.push('How much of this is measured (docs/12-scoring.md §4):');
  lines.push(
    `  ${pad('recorded', LABEL_WIDTH)}${pad(String(totals.recorded), 10)}${pct(totals.recorded, minutes)}`,
  );
  lines.push(
    `  ${pad('declared', LABEL_WIDTH)}${pad(String(totals.declared), 10)}${pct(totals.declared, minutes)}`,
  );
  lines.push(
    `  ${pad('default', LABEL_WIDTH)}${pad(String(totals.default), 10)}${pct(totals.default, minutes)}`,
  );
  if (attribution.dayScaleDurations > 0) {
    lines.push(
      `  ${plural(attribution.dayScaleDurations, 'completion carried', 'completions carried')} a day-scale duration, ` +
        'which is a block-out rather than an effort and was not converted.',
    );
  }
  lines.push(
    `  ${pct(totals.default, minutes)} of the minutes above is the configured default rather than ` +
      'anything observed. Capacity measures attention routed through tasks, not hours lived: an area ' +
      'whose work rarely becomes a task reads as starved. The bias errs toward surfacing neglect, ' +
      'which is the safer direction — but it is a lens, not a verdict.',
  );
  lines.push('');

  lines.push('Materialised:');
  lines.push(`  ${pad('capacity weeks', LABEL_WIDTH)}${String(input.weeks.length)} rows`);
  lines.push(`  ${pad('ritual adherence', LABEL_WIDTH)}${String(input.adherence.length)} periods`);
  const excess = input.adherence.reduce((sum, period) => sum + period.excess, 0);
  if (excess > 0) {
    lines.push(
      `  ${plural(excess, 'completion was', 'completions were')} beyond what the cadence offered and ` +
        'was clamped out of the stored row. A habit that regularly overshoots has the wrong cadence.',
    );
  }
  if (input.unmeasurableRituals.length > 0) {
    lines.push(
      `  ${plural(input.unmeasurableRituals.length, 'ritual has', 'rituals have')} no bound task, so ` +
        'adherence cannot be reconstructed for them — they are absent from the series rather than zero:',
    );
    for (const ritual of input.unmeasurableRituals) lines.push(`    ${ritual.name}`);
  }
  lines.push('');

  lines.push(
    'This command wrote nothing outward and cannot: it holds no writer, and its store has no ' +
      'method that reaches one. Re-running over the same period is safe — a completion is keyed by ' +
      '(task, completed_at), so the same history cannot be counted twice.',
  );

  return lines.join('\n');
}
