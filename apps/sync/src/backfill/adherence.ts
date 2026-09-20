import type { AdherencePeriod, AttributedCompletion, RitualRecord } from './types.js';
import { dayText, startOfMonth, startOfWeek } from './weeks.js';

/**
 * Reconstructing the adherence series for a habit.
 *
 * **prisme owns this series** (docs/10-model.md §9). Neither external tool
 * keeps it: the task tool knows a recurring task was ticked, the document tool
 * keeps the narrative, and neither can answer "how often, over the last year,
 * did this actually happen against how often it could have". That question is
 * the one that reveals a stated goal quietly sitting near zero, and it is the
 * whole reason a habit is measured by adherence rather than by completion.
 *
 * ### Opportunities
 *
 * An opportunity is a chance the cadence offered, counted over a **period**
 * rather than per tick, because `ritual_adherence` is keyed by period and the
 * KPI series buckets from that key:
 *
 * | Cadence | Period | Opportunities |
 * |---|---|---|
 * | `daily` | the week (Monday, UTC) | 7 — one per day |
 * | `weekly` | the week (Monday, UTC) | 1 |
 * | `monthly` | the month | 1 |
 *
 * A daily habit in a week is seven chances; a weekly one is one. Putting a
 * daily cadence on a *daily* period would make every row a 0 or a 100 and the
 * chart a barcode, which measures nothing anyone can read.
 *
 * ### Over-completion
 *
 * Doing a daily habit twice on Tuesday does not make the week 114% adhered, and
 * the table refuses it outright (`adherence_cannot_exceed_opportunity`). The
 * excess is clamped out of the stored row and **reported**, because a habit
 * whose completions regularly exceed its cadence is a cadence that is wrong,
 * and that is worth seeing rather than discarding.
 *
 * ### Partial periods
 *
 * The period containing the end of the backfilled range is not over. Its
 * opportunities are counted in full anyway, so the most recent week of a daily
 * habit reads low until the week ends. The alternative — prorating — makes
 * every historical row depend on when the backfill happened to run, which is
 * worse: a chart that changes shape because it was redrawn is a chart nobody
 * trusts. The run reports the partial period instead.
 */

const MS_PER_DAY = 86_400_000;

export interface AdherenceRange {
  readonly from: Date;
  /** Exclusive. */
  readonly to: Date;
}

interface Period {
  readonly start: Date;
  readonly opportunities: number;
}

function periodsFor(cadence: RitualRecord['cadence'], range: AdherenceRange): readonly Period[] {
  const periods: Period[] = [];

  if (cadence === 'monthly') {
    let cursor = startOfMonth(range.from);
    while (cursor.getTime() < range.to.getTime()) {
      periods.push({ start: cursor, opportunities: 1 });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    return periods;
  }

  const opportunities = cadence === 'daily' ? 7 : 1;
  let cursor = startOfWeek(range.from);
  while (cursor.getTime() < range.to.getTime()) {
    periods.push({ start: cursor, opportunities });
    cursor = new Date(cursor.getTime() + 7 * MS_PER_DAY);
  }
  return periods;
}

function periodStartFor(cadence: RitualRecord['cadence'], instant: Date): string {
  return dayText(cadence === 'monthly' ? startOfMonth(instant) : startOfWeek(instant));
}

/**
 * The full series for every ritual with a bound task, over the whole range.
 *
 * Every period in range is emitted, including the empty ones. That is the
 * opposite of `weeklyCapacity`'s rule, and deliberately: a week in which a
 * habit was *not* done is the observation, and leaving it out would turn a
 * missed month into a gap in the line rather than a flat zero. The range is
 * known here — it is what the backfill covered — so an absent period is
 * genuinely "did not happen" and not "was never looked at".
 */
export function reconstructAdherence(
  rituals: readonly RitualRecord[],
  completions: readonly AttributedCompletion[],
  range: AdherenceRange,
): readonly AdherencePeriod[] {
  const byRitual = new Map<string, Map<string, number>>();
  for (const completion of completions) {
    if (completion.ritualId === undefined) continue;
    if (completion.completedAt < range.from || completion.completedAt >= range.to) continue;

    const ritual = rituals.find((candidate) => candidate.id === completion.ritualId);
    if (ritual === undefined) continue;

    const key = periodStartFor(ritual.cadence, completion.completedAt);
    let periods = byRitual.get(ritual.id);
    if (periods === undefined) {
      periods = new Map<string, number>();
      byRitual.set(ritual.id, periods);
    }
    periods.set(key, (periods.get(key) ?? 0) + 1);
  }

  const series: AdherencePeriod[] = [];
  for (const ritual of rituals) {
    // A ritual with no bound task has no completions to reconstruct from, and
    // emitting a row of zeroes for it would read as "never done" rather than
    // "not measurable". It is reported as unmeasurable instead.
    if (ritual.externalTaskId === undefined) continue;

    const counted = byRitual.get(ritual.id) ?? new Map<string, number>();
    for (const period of periodsFor(ritual.cadence, range)) {
      const periodStart = dayText(period.start);
      const raw = counted.get(periodStart) ?? 0;
      series.push({
        ritualId: ritual.id,
        periodStart,
        opportunities: period.opportunities,
        completions: Math.min(raw, period.opportunities),
        excess: Math.max(0, raw - period.opportunities),
      });
    }
  }

  return series.sort(
    (left, right) =>
      left.ritualId.localeCompare(right.ritualId) ||
      left.periodStart.localeCompare(right.periodStart),
  );
}
