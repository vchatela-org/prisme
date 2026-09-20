import type { AreaKey, DurationSource } from '@prisme/domain';
import type { AttributedCompletion, CapacityWeek } from './types.js';

/**
 * Weeks, and the per-area rows the dashboard reads instead of aggregating
 * years on every load.
 *
 * Pure, and the arithmetic is deliberately the same as the KPI series':
 * **Monday, in UTC**. Two bucketings of the same completions that disagree
 * about where a week starts produce two different answers to the same question,
 * and the one nobody is looking at is the one that is wrong.
 *
 * A materialised row must equal what `computeCapacity` would say over the same
 * window. That is not asserted by convention — the attribution step applies the
 * same Signals rule and the same preference order, so the only way the two can
 * diverge is the bucketing, which is why it lives in one function here.
 */

const MS_PER_DAY = 86_400_000;

/** The Monday of the week an instant falls in, in UTC. */
export function startOfWeek(instant: Date): Date {
  const day = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  // getUTCDay: 0 is Sunday, so Sunday steps back six days rather than none.
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * MS_PER_DAY);
}

export function startOfMonth(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
}

export function dayText(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

interface Bucket {
  completions: number;
  minutes: number;
  bySource: Record<DurationSource, number>;
}

/**
 * Per-area rows for every week any of these completions falls in.
 *
 * Weeks with no completion at all are absent rather than zero: the range a
 * backfill covers is known from the cursor, and inventing rows for the weeks
 * inside it would mean a week that was never fetched is indistinguishable from
 * a week in which nothing was done.
 */
export function weeklyCapacity(
  completions: readonly AttributedCompletion[],
): readonly CapacityWeek[] {
  const buckets = new Map<string, Map<AreaKey, Bucket>>();

  for (const completion of completions) {
    const week = dayText(startOfWeek(completion.completedAt));
    let areas = buckets.get(week);
    if (areas === undefined) {
      areas = new Map<AreaKey, Bucket>();
      buckets.set(week, areas);
    }

    let bucket = areas.get(completion.areaKey);
    if (bucket === undefined) {
      bucket = { completions: 0, minutes: 0, bySource: { recorded: 0, declared: 0, default: 0 } };
      areas.set(completion.areaKey, bucket);
    }

    bucket.completions += 1;
    bucket.minutes += completion.minutes;
    bucket.bySource[completion.source] += completion.minutes;
  }

  const rows: CapacityWeek[] = [];
  for (const [weekStart, areas] of buckets) {
    for (const [areaKey, bucket] of areas) {
      rows.push({
        weekStart,
        areaKey,
        completions: bucket.completions,
        minutes: bucket.minutes,
        minutesBySource: bucket.bySource,
      });
    }
  }

  // Sorted explicitly. Map iteration order is insertion order, which is the
  // order the task tool happened to answer in — deterministic output must not
  // depend on that.
  return rows.sort(
    (left, right) =>
      left.weekStart.localeCompare(right.weekStart) || left.areaKey.localeCompare(right.areaKey),
  );
}
