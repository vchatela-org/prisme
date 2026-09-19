import {
  BalanceMeter,
  Button,
  Card,
  ChartTable,
  EmptyState,
  LineChart,
  Section,
  StatRow,
  StatTile,
} from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { areaDetailListSchema, areaWeightsSchema, balanceSchema, kpiSchema } from '@/lib/contracts';
import {
  bucketLabel,
  estimatedMinutesPct,
  labelsOf,
  measuredBuckets,
  minutesCaveat,
  monthsBefore,
  observedShareSeries,
  orderAreas,
  WINDOW_CAVEAT,
} from '@/lib/kpi-view';
import { declaredSeries, yearsSpanned, type WeightsByYear } from '@/lib/weight-year';
import { reviewTarget, type WeightEntry } from '@/lib/year-review';
import { WeightForm } from './weight-form';

export const metadata = {
  title: 'Year Review · prisme',
  description: 'Declared against observed for the year ending, then the allocation for the next.',
};

/** Three years of monthly buckets: enough to see a habit, short enough to read. */
const HISTORY_MONTHS = 36;

/**
 * The Year Review — the one surface that writes a weight.
 *
 * ## Why the evidence comes before the form
 *
 * ADR-0007's whole argument is that the yearly decision should be made
 * *against evidence rather than memory*. The page is therefore ordered as the
 * decision is: what was declared last year, what actually happened, what the
 * objectives did, and only then the boxes. Putting the form first would make
 * this a settings screen, and a settings screen gets filled in from memory in
 * forty seconds.
 *
 * ## Which year it writes
 *
 * The year with no weights of its own — the current one if the gate is
 * holding right now, otherwise the next one. Never a year already decided:
 * mid-year rationalisation is structurally impossible and this screen is where
 * that would otherwise leak in (`../../../../lib/year-review.ts`).
 *
 * ## The charts read history at its own weights
 *
 * Every declared line here is resolved per bucket from the weights in force
 * at that time. A three-year chart crosses two boundaries, and rendering it at
 * today's weights would move every target line under work that already
 * happened.
 */
export default async function YearReviewPage() {
  const currentYear = new Date().getUTCFullYear();

  // Whether the year under way was decided *for itself* — not whether it has
  // weights, which it does as soon as any earlier year has any.
  const thisYear = await apiFetch({
    path: '/areas/weights',
    query: { year: String(currentYear) },
    schema: areaWeightsSchema,
  });

  if (!thisYear.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header year={currentYear} />
        <ApiFailureState failure={thisYear} surface="the year weights" />
      </div>
    );
  }

  const target = reviewTarget(currentYear, (year) =>
    year === currentYear ? !thisYear.data.stale && thisYear.data.sourceYear === year : false,
  );

  const to = `${String(target.reviewing)}-12-31`;
  const from = monthsBefore(to, HISTORY_MONTHS);

  const [areas, closing, previous, kpi] = await Promise.all([
    apiFetch({ path: '/areas', schema: areaDetailListSchema }),
    // 52 weeks: the year ending, not the rolling four-week window the daily
    // screens read. A year is reviewed against a year.
    apiFetch({
      path: '/balance',
      query: { year: String(target.reviewing), weeks: '52' },
      schema: balanceSchema,
    }),
    apiFetch({
      path: '/areas/weights',
      query: { year: String(target.reviewing) },
      schema: areaWeightsSchema,
    }),
    apiFetch({ path: '/kpi', query: { from, to, bucket: 'month' }, schema: kpiSchema }),
  ]);

  if (!closing.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header year={target.year} />
        <ApiFailureState failure={closing} surface="last year's balance" />
      </div>
    );
  }

  const byYear: WeightsByYear = new Map(
    (
      await Promise.all(
        yearsSpanned(from, to).map(async (spanYear) => {
          const result = await apiFetch({
            path: '/areas/weights',
            query: { year: String(spanYear) },
            schema: areaWeightsSchema,
          });
          if (!result.ok) return null;
          return [
            spanYear,
            {
              year: result.data.year,
              sourceYear: result.data.sourceYear,
              stale: result.data.stale,
              weights: new Map(result.data.weights.map((w) => [w.areaKey, w.weightPct])),
            },
          ] as const;
        }),
      )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );

  const rankableKeys = new Set(
    (areas.ok ? areas.data.items : []).filter((area) => area.rankable).map((area) => area.key),
  );

  const previousWeight = (key: string): number | null =>
    previous.ok
      ? (previous.data.weights.find((weight) => weight.areaKey === key)?.weightPct ?? null)
      : null;

  const ranked = orderAreas(
    closing.data.areas.filter((row) => rankableKeys.has(row.areaKey)),
    (key) => previousWeight(key),
  );

  /**
   * The form starts from last year's allocation, not from blank and not from
   * what happened. Blank makes six decisions from nothing; pre-filling with
   * the observed share would be the rationalisation the ADR is about, written
   * into the default.
   */
  const entries: readonly WeightEntry[] = ranked.map((row) => ({
    areaKey: row.areaKey,
    name: row.name,
    weightPct: previousWeight(row.areaKey) ?? 0,
    previousPct: previousWeight(row.areaKey),
    observedPct: row.actualSharePct,
  }));

  const labels = kpi.ok ? labelsOf(kpi.data.minutes) : [];
  const monthLabels = labels.map((label) => bucketLabel(label, 'month'));
  const measured = kpi.ok ? measuredBuckets(kpi.data.minutes) : 0;
  const estimated = estimatedMinutesPct(closing.data.areas);

  const attainment = kpi.ok ? kpi.data.objectiveAttainment : [];

  return (
    <div className="flex flex-col gap-8">
      <Header year={target.year} reviewing={target.reviewing} />

      <Card
        className={
          target.stance === 'overdue' ? 'border-status-warning p-4 text-sm' : 'p-4 text-sm'
        }
      >
        {target.stance === 'overdue' ? (
          <p className="text-ink">
            <span className="font-medium">{target.year} has no weights of its own.</span> Every
            balance factor in prisme is currently computed from{' '}
            {String(thisYear.data.sourceYear ?? target.year - 1)}
            &rsquo;s allocation and is marked stale. This review is unlocked until that is settled —
            it does not close on its own.
          </p>
        ) : (
          <p className="text-ink">
            <span className="font-medium">{currentYear} is allocated and cannot be changed.</span> A
            weight is fixed for a whole calendar year (ADR-0007) — the rigidity is the mechanism,
            not a limitation. What this screen writes is {target.year}, which has not started.
          </p>
        )}
      </Card>

      <Section
        title={`${String(target.reviewing)} — declared against observed`}
        description="The year ending, over its whole length. This is the evidence the next allocation is decided against."
      >
        {ranked.length === 0 ? (
          <EmptyState
            title="Nothing to review yet"
            description="No rankable area has any completed work in this year. The allocation below can still be set; it just has no history behind it, and the charts will fill in as work completes."
          />
        ) : (
          <Card className="flex flex-col gap-5">
            {ranked.map((row) => (
              <BalanceMeter
                key={row.areaKey}
                areaKey={row.areaKey}
                name={row.name}
                kind={row.kind}
                targetPct={previousWeight(row.areaKey) ?? 0}
                observedPct={row.actualSharePct}
                stale={row.stale}
              />
            ))}
          </Card>
        )}
        <p className="text-xs text-ink-muted">{minutesCaveat(estimated)}</p>
      </Section>

      <StatRow>
        <StatTile
          label={`Completed in ${String(target.reviewing)}`}
          value={String(closing.data.areas.reduce((total, row) => total + row.completions, 0))}
        />
        <StatTile
          label="Months with any measurement"
          value={`${String(measured)} of ${String(labels.length)}`}
        />
        <StatTile label="Objectives tracked" value={String(attainment.length)} />
        <StatTile
          label={`Declared for ${String(target.reviewing)}`}
          value={previous.ok ? `${previous.data.sumPct.toFixed(0)}%` : '—'}
        />
      </StatRow>

      <Section
        title="Share over time"
        description="Every rankable area, monthly, against the share declared for that year. The declared line steps on 1 January because that is when a weight changes."
      >
        {!kpi.ok ? (
          <ApiFailureState failure={kpi} surface="the history" />
        ) : ranked.length === 0 ? null : (
          <div className="grid gap-4 xl:grid-cols-2">
            {ranked.map((row) => (
              <LineChart
                key={row.areaKey}
                title={row.name}
                subtitle="Observed against declared, monthly"
                labels={monthLabels}
                series={[
                  {
                    label: 'Observed',
                    values: [...observedShareSeries(row.areaKey, kpi.data.minutes)],
                  },
                  {
                    label: 'Declared',
                    values: [...declaredSeries(labels, row.areaKey, byYear)],
                    slot: 'lane',
                  },
                ]}
                formatAs={{ kind: 'percent' }}
              />
            ))}
          </div>
        )}

        {/* One copy under the grid, not one under each panel — see the same
            note on the KPI dashboard. */}
        <p className="max-w-prose text-xs text-ink-muted">
          {WINDOW_CAVEAT} {minutesCaveat(estimated)}
        </p>
      </Section>

      <Section
        title="Objective attainment"
        description="Self-assessed progress beside what the task breakdown computes. The two disagreeing is information, not an error (ADR-0013)."
      >
        {attainment.length === 0 ? (
          <EmptyState
            title="No objectives to report on"
            description="Objectives are authored in prisme and reported back to the document tool. With none set for the year under review, there is nothing to score the allocation against beyond the balance above."
          />
        ) : (
          <Card>
            <ChartTable
              head={['Objective', 'Period', 'Self', 'Computed']}
              caption={`Objective attainment for ${String(target.reviewing)}`}
            >
              {attainment.map((objective) => (
                <tr
                  key={objective.objectiveId}
                  className="border-b border-border-hairline last:border-0"
                >
                  <th scope="row" className="px-2 py-1.5 text-left font-normal text-ink">
                    {objective.title}
                  </th>
                  <td className="px-2 py-1.5 text-right text-ink-secondary">{objective.period}</td>
                  <td className="px-2 py-1.5 text-right text-ink tabular-nums">
                    {objective.progressSelfPct === null
                      ? '—'
                      : `${objective.progressSelfPct.toFixed(0)}%`}
                  </td>
                  <td className="px-2 py-1.5 text-right text-ink tabular-nums">
                    {objective.progressComputedPct === null
                      ? '—'
                      : `${objective.progressComputedPct.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </ChartTable>
          </Card>
        )}
      </Section>

      <Section
        title={`Allocate ${String(target.year)}`}
        description="Shares of one person's capacity, fixed for the whole calendar year. Set them against what is above, not against what feels reasonable in the moment."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/kpi">Open the full dashboard</Link>
          </Button>
        }
      >
        {entries.length === 0 ? (
          <EmptyState
            title="There are no rankable areas"
            description="Weights are allocated between areas of the Change lane. Create at least one area before allocating; Run and Signals are lanes and never carry a share."
          />
        ) : (
          <WeightForm year={target.year} reviewing={target.reviewing} entries={entries} />
        )}
      </Section>
    </div>
  );
}

function Header({ year, reviewing }: { year: number; reviewing?: number }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold text-ink">Year Review</h1>
      <p className="text-sm text-ink-secondary">
        {reviewing === undefined
          ? 'The yearly allocation decision.'
          : `Close ${String(reviewing)} against what was declared for it, then allocate ${String(year)}.`}
      </p>
    </header>
  );
}
