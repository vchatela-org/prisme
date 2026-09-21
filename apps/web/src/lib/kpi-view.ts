/**
 * Shaping the KPI payload into things a chart can draw.
 *
 * Every function here is pure, takes its data as an argument and is tested
 * without a browser — the same arrangement W08 used, for the same reason: the
 * decisions a dashboard makes are the part worth testing, and a screen that
 * makes them inline can only be tested by rendering it.
 *
 * ## What this file is allowed to do
 *
 * Sum, divide, order, label. Nothing more. The share of a bucket is a
 * normalisation of a series the API already shaped — in particular the rule
 * that **Signals contribute volume and no time** (ADR-0014) is applied inside
 * the `/kpi` handler, so signals minutes arrive as zero and nothing here has
 * to know the rule. That is the difference between arithmetic and a second
 * implementation of `computeCapacity`.
 *
 * What it must never do: compute a balance factor, a score or a date. Those
 * are `packages/domain`'s and arrive already computed
 * (`apps/web/CLAUDE.md` non-negotiable 1).
 *
 * ## Why an empty bucket is a gap and not a zero
 *
 * A month in which nothing was completed is a month with **no measurement**,
 * not a month in which every area got 0%. Returning zero would draw six lines
 * collapsing to the floor and then jumping back, which reads as a catastrophe
 * rather than as a holiday. `null` breaks the line instead, which is what
 * `<LineChart>` renders a gap as.
 */

export interface BucketPoint {
  readonly periodStart: string;
  readonly value: number;
}

export interface AreaSeries {
  readonly areaKey: string;
  readonly kind: 'area' | 'run' | 'signals';
  readonly points: readonly BucketPoint[];
}

/** The bucket labels of a payload, taken from the first series that has any. */
export function labelsOf(series: readonly AreaSeries[]): readonly string[] {
  return series.find((entry) => entry.points.length > 0)?.points.map((p) => p.periodStart) ?? [];
}

/**
 * The attributed minutes in each bucket, summed across every area.
 *
 * This is the denominator of the observed share. Signals are already zero in
 * this series, and Run is already included — both by the API's own decision,
 * which is why neither appears as a condition here.
 */
export function totalMinutesPerBucket(minutes: readonly AreaSeries[]): readonly number[] {
  const labels = labelsOf(minutes);
  return labels.map((_, index) =>
    minutes.reduce((total, series) => total + (series.points[index]?.value ?? 0), 0),
  );
}

/**
 * One area's observed share of each bucket, as a percentage.
 *
 * `null` where the bucket recorded no minutes at all — see the note above.
 */
export function observedShareSeries(
  areaKey: string,
  minutes: readonly AreaSeries[],
): readonly (number | null)[] {
  const totals = totalMinutesPerBucket(minutes);
  const own = minutes.find((series) => series.areaKey === areaKey);

  return totals.map((total, index) => {
    if (total === 0) return null;
    return ((own?.points[index]?.value ?? 0) / total) * 100;
  });
}

/**
 * How many of the buckets on screen carry any measurement at all.
 *
 * The footnote uses this: a chart drawn from two months of history is not
 * wrong, but a reader should not have to count the points to notice.
 */
export function measuredBuckets(minutes: readonly AreaSeries[]): number {
  return totalMinutesPerBucket(minutes).filter((total) => total > 0).length;
}

/**
 * A bucket label as a reader reads it — `2026-11` for a month, `4 Nov` for a
 * week. Ordinals and locale-dependent month names are avoided on purpose: the
 * axis has to be scannable, not prose.
 */
export function bucketLabel(periodStart: string, bucket: 'week' | 'month'): string {
  const [year, month, day] = periodStart.split('-');
  if (year === undefined || month === undefined || day === undefined) return periodStart;

  if (bucket === 'month') {
    return `${MONTHS[Number(month) - 1] ?? month} ${year.slice(2)}`;
  }
  return `${String(Number(day))} ${MONTHS[Number(month) - 1] ?? month}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Areas before lanes, and each group by declared share descending.
 *
 * Alphabetical would be arbitrary; by observed share would re-order the screen
 * every week, which makes a dashboard impossible to learn. The declared share
 * is a decision that holds for a year, so the rows hold still for a year too.
 */
export function orderAreas<T extends { areaKey: string; kind: 'area' | 'run' | 'signals' }>(
  areas: readonly T[],
  targetPct: (areaKey: string) => number | null,
): readonly T[] {
  const rank = (kind: T['kind']): number => (kind === 'area' ? 0 : kind === 'run' ? 1 : 2);

  return [...areas].sort((a, b) => {
    if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
    const byTarget = (targetPct(b.areaKey) ?? -1) - (targetPct(a.areaKey) ?? -1);
    if (byTarget !== 0) return byTarget;
    return a.areaKey.localeCompare(b.areaKey);
  });
}

/**
 * The share of attributed minutes that rests on an estimate rather than on a
 * recorded duration, over the balance window.
 *
 * Scope item 5 of the brief: where a metric rests on estimated durations, say
 * so **on the chart**. This is the number that sentence quotes, and it is
 * measured rather than asserted — `/balance` reports minutes by source per
 * area, and an instance whose task tool records durations properly will see
 * this fall towards zero on its own.
 */
export function estimatedMinutesPct(
  areas: ReadonlyArray<{
    minutesBySource: { recorded: number; declared: number; default: number };
  }>,
): number | null {
  let recorded = 0;
  let estimated = 0;

  for (const area of areas) {
    recorded += area.minutesBySource.recorded;
    estimated += area.minutesBySource.declared + area.minutesBySource.default;
  }

  const total = recorded + estimated;
  if (total === 0) return null;
  return (estimated / total) * 100;
}

/**
 * The sentence that goes under any chart drawn from attributed minutes.
 *
 * It says the two things a reader has to know to read the chart honestly: that
 * durations are part estimate, and that this measures attention routed through
 * tasks rather than hours lived (`docs/12-scoring.md` §4). Both are stated
 * where the number is, not in a footnote nobody reaches.
 */
export function minutesCaveat(estimatedPct: number | null): string {
  const estimate =
    estimatedPct === null
      ? 'Durations are recorded where the task tool has one and estimated otherwise.'
      : `${estimatedPct.toFixed(0)}% of these minutes are estimated rather than recorded.`;

  return `${estimate} This measures attention routed through tasks, not hours lived — an area whose work rarely becomes a task reads as starved.`;
}

/**
 * The sentence that goes under a share-over-time chart specifically.
 *
 * The share here is per calendar bucket; the balance factor the scoring method
 * reads is a rolling four-week window ending today. They are close and they
 * are not the same number, and a reader who spots the difference should find
 * it explained rather than have to disbelieve one of the two.
 */
export const WINDOW_CAVEAT =
  'Calendar buckets, not the rolling four-week window the balance factor is measured over — the two will not match exactly.';

/**
 * Which record the API measured the observed side from (W13).
 *
 * `observedThrough` is optional because only the balance reports it: the KPI's
 * range is explicit, so "covered through" would restate the request rather than
 * tell the reader anything.
 */
export type ObservedCoverage = {
  readonly observedSource: 'capacity_week' | 'task_mirror';
  readonly observedThrough?: string | null;
};

/**
 * The sentence that says **which record** a reading came from.
 *
 * The two disagree, and not marginally. `capacity_week` is the backfill's
 * materialised history: every completion the tool holds, attributed through
 * `area_mapping`. `task_mirror` is the anchor subtree — work completed under an
 * initiative prisme already knew about, which excludes everything outside an
 * anchor and everything completed before prisme existed. A reader comparing
 * this month with last month is comparing two numbers, and a number whose
 * source is unstated is a number that cannot be compared with anything.
 *
 * Said under the chart rather than in a footnote, for the same reason
 * `minutesCaveat` is: it is what a reader needs to interpret what they see.
 * The uncovered case says what to do about it, because "prisme cannot see it"
 * is only useful alongside "here is how to make it visible".
 */
export function observedSourceCaveat(coverage: ObservedCoverage): string {
  if (coverage.observedSource === 'task_mirror') {
    return 'Measured from the mirrored anchor subtrees only, because no completion history has been imported: work outside an anchor, and everything completed before prisme existed, is not in these numbers. `prisme-sync backfill` fetches it.';
  }

  const through = coverage.observedThrough ?? null;
  return through === null
    ? 'Measured from the imported completion history.'
    : `Measured from the imported completion history, covered through ${through}.`;
}

/**
 * The most starved area, or a count when the answer is not one area.
 *
 * ## Why this is not just `max(balanceFactor)`
 *
 * The balance factor is `clamp(target / actual, 0.5, 2)`, so **every area more
 * than twice under its share reports exactly 2.00**. On a real window that is
 * routinely three of six areas, and picking the first of them puts a name on a
 * tile that the data does not single out — the reader then goes and looks at
 * an area that is no worse off than two others.
 *
 * The clamp is correct where it is: it stops one neglected area dominating
 * every score (docs/10-model.md §3). It just means "which is worst" stops
 * being a question this number can answer past the ceiling, and the tile says
 * so rather than guessing.
 */
export function mostStarved(
  areas: ReadonlyArray<{ areaKey: string; name: string; balanceFactor: number }>,
  clampCeiling = 2,
): { readonly label: string; readonly tied: number } {
  if (areas.length === 0) return { label: '—', tied: 0 };

  const worst = Math.max(...areas.map((area) => area.balanceFactor));
  const atWorst = areas.filter((area) => area.balanceFactor === worst);

  if (atWorst.length === 1) return { label: atWorst[0]?.name ?? '—', tied: 1 };

  // Several areas tie. If they tie *at the ceiling* the clamp is what hid the
  // difference; if they tie below it they genuinely are equally starved. The
  // reader is told the count either way, because naming one would be a guess.
  return {
    label:
      worst >= clampCeiling
        ? `${String(atWorst.length)} at the clamp`
        : `${String(atWorst.length)} tied`,
    tied: atWorst.length,
  };
}

export interface AgingBucket {
  readonly label: string;
  readonly count: number;
}

/**
 * The aging of work in progress, bucketed by how long each item has sat.
 *
 * ## What this actually measures, and why the label matters
 *
 * Not "how long has this been in flight" — prisme does not record when an
 * initiative *entered* the now set, so that number does not exist to be shown.
 * What it measures is **days since anything moved underneath it**, which is
 * the same signal W08's Focus screen calls staleness. The two names would
 * describe different things, so this one says "untouched" wherever it appears
 * rather than borrowing the industry term for something it is not.
 *
 * The day counts are computed by `./focus-view.ts` from the same rollup Focus
 * reads, so the two screens cannot disagree about how old something is.
 */
export function agingBuckets(idleDays: readonly (number | null)[]): readonly AgingBucket[] {
  const buckets = [
    { label: 'Under a week', match: (days: number) => days < 7 },
    { label: 'One to two weeks', match: (days: number) => days >= 7 && days < 14 },
    { label: 'Two to four weeks', match: (days: number) => days >= 14 && days < 30 },
    { label: 'Over a month', match: (days: number) => days >= 30 },
  ];

  const known = idleDays.filter((days): days is number => days !== null);
  const rows: AgingBucket[] = buckets.map((bucket) => ({
    label: bucket.label,
    count: known.filter((days) => bucket.match(days)).length,
  }));

  // An item whose age cannot be established is its own row rather than being
  // folded into "under a week", which would make a dashboard quietly optimistic.
  const unknown = idleDays.length - known.length;
  if (unknown > 0) rows.push({ label: 'Age unknown', count: unknown });

  return rows;
}

/**
 * `n` months before a calendar date, as the first of that month.
 *
 * Integer month arithmetic through `Date.UTC`, whose month overflow is the
 * behaviour wanted here: month `-1` rolls into the previous December on its
 * own, so a twenty-four month window ending in January needs no special case.
 * The result is always the first of a month, because that is what a monthly
 * bucket's label is.
 */
export function monthsBefore(date: string, months: number): string {
  const [year, month] = date.split('-').map(Number);
  if (year === undefined || month === undefined || Number.isNaN(year) || Number.isNaN(month)) {
    throw new Error(`A range end must be a calendar date, got ${JSON.stringify(date)}`);
  }
  return new Date(Date.UTC(year, month - 1 - months, 1)).toISOString().slice(0, 10);
}
