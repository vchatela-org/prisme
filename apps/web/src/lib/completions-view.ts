import type { AreaCompletion, AreaCompletions } from './contracts';

/**
 * How the area screen says what its observed share was made of.
 *
 * The list comes from `/areas/{key}/completions`, which answers over the same
 * window and from the same record as `/balance` — so nothing here counts,
 * windows or attributes anything. It words what the API measured, and says
 * plainly when the list and the balance row it explains disagree.
 */

/** "45 min", "1 h 20 min", "2 h". */
export function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/**
 * Where a row's minutes came from, in the reader's words.
 *
 * The tier matters more than the number: a default estimate is the same for
 * every task, so an area with many small ones reads as having received more
 * time than it did — and that, not the work, is often why a share looks high.
 */
export function sourceLabel(row: Pick<AreaCompletion, 'minutesSource'>): string {
  switch (row.minutesSource) {
    case 'recorded':
      return 'recorded';
    case 'declared':
      return 'from its process';
    case 'default':
      return 'default estimate';
    case null:
      return 'volume only';
  }
}

/**
 * The one line above the list: how many, how much time, and how much of that
 * time is the configured default rather than a measurement.
 */
export function completionsSummary(
  totals: AreaCompletions['totals'],
  kind: 'area' | 'run' | 'signals',
): string {
  const count = `${String(totals.completions)} ${totals.completions === 1 ? 'completion' : 'completions'}`;

  if (kind === 'signals') {
    return `${count}. Signals are counted as volume, so none of them adds time to the comparison.`;
  }

  if (totals.minutes === 0) return `${count}, and no time attributed to them.`;

  const estimated = totals.minutesBySource.default;
  const share = Math.round((estimated / totals.minutes) * 100);
  const estimate =
    estimated === 0
      ? 'none of it the default estimate.'
      : share === 100
        ? 'all of it the default estimate rather than a recorded duration.'
        : `${String(share)}% of it the default estimate rather than a recorded duration.`;

  return `${count}, ${minutesLabel(totals.minutes)} of attributed time — ${estimate}`;
}

/**
 * The sentence for a list that does not add up to the balance row above it,
 * or `null` when it does.
 *
 * They disagree for one ordinary reason: the itemised record is written by the
 * daily sync, so weeks materialised before it existed are counted and not yet
 * listed. Said, rather than left for the reader to notice and distrust both —
 * and without promising the daily sync closes it, because that sync re-reads
 * only the trailing window: a past year's weeks are itemised by a backfill.
 */
export function itemisationGap(listed: number, counted: number): string | null {
  if (listed === counted) return null;
  if (listed < counted) {
    return `The balance counted ${String(counted)} here and ${String(listed)} are listed. The rest were measured before completions were itemised: the daily sync itemises the recent weeks, and a backfill over the older ones itemises those.`;
  }
  return `${String(listed)} are listed and the balance counted ${String(counted)} — the two were built by different sync runs, and the next daily sync brings them back together.`;
}
