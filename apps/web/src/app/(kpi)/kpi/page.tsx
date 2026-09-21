import {
  BarChart,
  Button,
  Card,
  EmptyState,
  LineChart,
  Section,
  StaleWeightsBanner,
  StatRow,
  StatTile,
} from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  areaDetailListSchema,
  areaWeightsSchema,
  balanceSchema,
  deadlineHealthSchema,
  focusSchema,
  kpiSchema,
  takeawayPageSchema,
  type AreaDetail,
} from '@/lib/contracts';
import { stalenessOf, STALE_AFTER_DAYS } from '@/lib/focus-view';
import {
  agingBuckets,
  bucketLabel,
  estimatedMinutesPct,
  labelsOf,
  measuredBuckets,
  minutesCaveat,
  observedSourceCaveat,
  observedShareSeries,
  orderAreas,
  WINDOW_CAVEAT,
} from '@/lib/kpi-view';
import { declaredSeries, staleYears, yearsSpanned, type WeightsByYear } from '@/lib/weight-year';
import { RangePicker, resolveRange } from './range';

export const metadata = {
  title: 'KPI · prisme',
  description: 'Balance, throughput, adherence and attainment over time.',
};

/**
 * The KPI dashboard.
 *
 * ## What is here, and what is deliberately not
 *
 * The brief lists nine metrics. Eight are drawn; **cycle time is not**, and
 * that is a stated gap rather than an omission. prisme records no moment at
 * which an initiative started — reconstructing one means walking the event log
 * for `status_changed` transitions and pairing them, which is aggregation
 * logic, which is business logic, and putting it in the browser creates the
 * second source of truth `apps/api/src/dto/views.ts` exists to prevent. It
 * belongs behind `/kpi`. The dashboard says so where the chart would be, so a
 * reader learns it is missing rather than assuming it was never wanted.
 *
 * The brief's other instruction pulls the same way: *resist adding metrics
 * because they are computable*. A metric that has to be invented in the view
 * layer to exist at all has not earned its place on a dashboard.
 *
 * ## Every historical chart uses the weight in force at the time
 *
 * The balance charts resolve their declared line per bucket, from one weights
 * request per year the window spans. Drawing a two-year window at today's
 * weights would move every target line under work that already happened, which
 * is the single easiest thing to get wrong on this screen.
 *
 * ## Honesty is rendered, not footnoted
 *
 * Anything resting on estimated durations says so under the chart, with the
 * measured proportion; anything measuring attention-routed-through-tasks says
 * that too. `docs/12-scoring.md` §4 states the limitation plainly and this is
 * where a reader meets it.
 */
export default async function KpiPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const range = resolveRange((await searchParams).range, new Date());

  const [kpi, areas, balance, timeline, focus, actions, promoted] = await Promise.all([
    apiFetch({
      path: '/kpi',
      query: { from: range.from, to: range.to, bucket: range.bucket },
      schema: kpiSchema,
    }),
    apiFetch({ path: '/areas', schema: areaDetailListSchema }),
    apiFetch({ path: '/balance', schema: balanceSchema }),
    apiFetch({ path: '/timeline', schema: deadlineHealthSchema }),
    apiFetch({ path: '/focus', schema: focusSchema }),
    // Read for `total` alone — the ratio is a division of two counts the API
    // reports, so no list of takeaways is ever walked in the browser.
    apiFetch({
      path: '/takeaways',
      query: { kind: 'action', limit: '1' },
      schema: takeawayPageSchema,
    }),
    apiFetch({
      path: '/takeaways',
      query: { kind: 'action', promoted: 'true', limit: '1' },
      schema: takeawayPageSchema,
    }),
  ]);

  if (!kpi.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header label={range.label} />
        <RangePicker active={range.id} />
        <ApiFailureState failure={kpi} surface="the KPI dashboard" />
      </div>
    );
  }

  const data = kpi.data;
  const labels = labelsOf(data.minutes);
  const axis = labels.map((label) => bucketLabel(label, data.bucket));

  const byKey = new Map<string, AreaDetail>(
    (areas.ok ? areas.data.items : []).map((area) => [area.key, area]),
  );
  const nameOf = (key: string): string => byKey.get(key)?.name ?? key;

  // One weights request per year the window touches.
  const byYear: WeightsByYear = new Map(
    (
      await Promise.all(
        yearsSpanned(range.from, range.to).map(async (year) => {
          const result = await apiFetch({
            path: '/areas/weights',
            query: { year: String(year) },
            schema: areaWeightsSchema,
          });
          if (!result.ok) return null;
          return [
            year,
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

  /*
    The banner is about **this** year, not about every year the window
    reaches. The year gate is "the year under way was never decided"; a
    three-year window touching a year from before prisme held any weights is
    not an open gate, and warning about it teaches a reader to dismiss the
    banner that matters. `staleYears` still drives nothing here beyond the
    carried-from wording.
  */
  const thisYear = new Date().getUTCFullYear();
  const carried = staleYears(labels, byYear).filter((entry) => entry.year === thisYear);

  const isRankable = (areaKey: string, kind: 'area' | 'run' | 'signals'): boolean =>
    byKey.get(areaKey)?.rankable ?? kind === 'area';

  // Ordered by this year's declared share, so the cards hold still for a year
  // rather than re-ordering themselves every time a number moves.
  const declaredThisYear = (key: string): number | null =>
    byYear.get(Number(range.to.slice(0, 4)))?.weights.get(key) ?? null;

  const rankable = orderAreas(
    data.minutes.filter((series) => isRankable(series.areaKey, series.kind)),
    declaredThisYear,
  );
  const rankableThroughput = orderAreas(
    data.throughput.filter((series) => isRankable(series.areaKey, series.kind)),
    declaredThisYear,
  );

  const measured = measuredBuckets(data.minutes);
  const estimated = balance.ok ? estimatedMinutesPct(balance.data.areas) : null;
  const shortHistory =
    measured === 0
      ? 'Nothing in this window has been measured yet.'
      : measured < 3
        ? `Only ${String(measured)} of ${String(labels.length)} periods carry any measurement — a trend needs more than this.`
        : '';

  const idle = focus.ok
    ? focus.data.now.map(
        (entry) => stalenessOf(entry, new Date(focus.data.asOf), STALE_AFTER_DAYS).idleDays,
      )
    : [];

  const deadlines = timeline.ok
    ? timeline.data.initiatives.filter((entry) => entry.deadline !== null)
    : [];
  const infeasible = timeline.ok ? timeline.data.infeasibleDeadlines.length : 0;

  const conversionPct =
    actions.ok && promoted.ok && actions.data.total > 0
      ? (promoted.data.total / actions.data.total) * 100
      : null;

  return (
    <div className="flex flex-col gap-8">
      <Header label={range.label} />
      <RangePicker active={range.id} />

      {carried.length > 0 ? (
        <StaleWeightsBanner
          year={carried[0]?.year ?? thisYear}
          carriedFrom={carried[0]?.carriedFrom ?? thisYear - 1}
          action={
            <Button asChild size="sm">
              <Link href="/review/year">Open the Year Review</Link>
            </Button>
          }
        />
      ) : null}

      <StatRow>
        <StatTile
          label="Completed in the window"
          value={String(
            data.throughput.reduce(
              (total, series) => total + series.points.reduce((sum, p) => sum + p.value, 0),
              0,
            ),
          )}
        />
        <StatTile
          label="Deadlines the schedule cannot meet"
          value={String(infeasible)}
          {...(deadlines.length === 0
            ? {}
            : {
                delta: {
                  value: `of ${String(deadlines.length)}`,
                  direction: infeasible === 0 ? ('flat' as const) : ('up' as const),
                  goodDirection: 'down' as const,
                  period: 'with a deadline',
                },
              })}
        />
        <StatTile
          label="Reading to action"
          value={conversionPct === null ? '—' : `${conversionPct.toFixed(0)}%`}
        />
        <StatTile
          label="In flight, untouched a week or more"
          value={String(idle.filter((days) => days !== null && days >= STALE_AFTER_DAYS).length)}
        />
      </StatRow>

      <Section
        title="Balance over time"
        description="What each area actually received, against the share declared for that year. The declared line steps on 1 January — a weight is fixed for a calendar year and changes by decision, not by drift."
      >
        {rankable.length === 0 ? (
          <EmptyState
            title="No rankable area has any history here"
            description="Balance is measured from completed work attributed to an area. Complete something, or widen the window, and this fills in."
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {rankable.map((series) => (
              <LineChart
                key={series.areaKey}
                title={nameOf(series.areaKey)}
                subtitle="Observed against declared"
                labels={axis}
                series={[
                  {
                    label: 'Observed',
                    values: [...observedShareSeries(series.areaKey, data.minutes)],
                  },
                  {
                    label: 'Declared',
                    values: [...declaredSeries(labels, series.areaKey, byYear)],
                    slot: 'lane',
                  },
                ]}
                formatAs={{ kind: 'percent' }}
                {...(shortHistory === '' ? {} : { footnote: shortHistory })}
              />
            ))}
          </div>
        )}

        {/*
          The caveat sits under the grid rather than under each panel.

          It has to be beside the numbers — the brief is explicit that a
          limitation belongs on the chart and not in a page footer — but
          repeating the same two sentences six times is how a reader learns to
          skip the small grey paragraph, which is the same outcome as hiding
          it. One copy, directly under the charts it governs, is read.
        */}
        <p className="max-w-prose text-xs text-ink-muted">
          {WINDOW_CAVEAT} {minutesCaveat(estimated)} {observedSourceCaveat(kpi.data)}
        </p>
      </Section>

      <Section title="Throughput" description="Initiatives completed per period, by area.">
        {/*
          Rankable areas only. The two lanes have their own section below, and
          folding them in here would spend two of the palette's eight slots on
          series that are not competing with the others for anything — which is
          also how an instance with eight areas ends up over the ceiling and
          getting the chart's "facet this" error instead of a chart.
        */}
        <LineChart
          title="Completions"
          subtitle={range.bucket === 'week' ? 'Per week' : 'Per month'}
          labels={axis}
          series={rankableThroughput.map((series) => ({
            label: nameOf(series.areaKey),
            values: series.points.map((point) => point.value),
          }))}
          formatAs={{ kind: 'number' }}
          footnote={shortHistory}
        />
      </Section>

      <Section
        title="Upkeep and noise"
        description="The two lanes. Both count toward capacity and neither is ever ranked."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <LineChart
            title="Run hours against budget"
            subtitle="Hours per week attributed to upkeep"
            labels={axis}
            series={[
              {
                label: 'Observed',
                values: data.runHours.points.map((point) => point.value),
                slot: 'lane',
              },
              ...(data.runHours.budgetHoursPerWeek === null
                ? []
                : [
                    {
                      label: 'Budget',
                      values: axis.map(() => data.runHours.budgetHoursPerWeek ?? 0),
                    },
                  ]),
            ]}
            formatAs={{ kind: 'hours' }}
            footnote={
              data.runHours.budgetHoursPerWeek === null
                ? 'No weekly budget is declared for the Run lane, so there is no line to be over.'
                : minutesCaveat(estimated)
            }
          />

          <LineChart
            title="Signals volume"
            subtitle="Items handled per period"
            labels={axis}
            series={[
              {
                label: 'Signals',
                values: data.signalsVolume.map((point) => point.value),
                slot: 'lane',
              },
            ]}
            formatAs={{ kind: 'number' }}
            footnote="Counted as volume and nothing else — responding to an alert is not a choice about how to spend a week, so Signals contributes no minutes to the balance charts (ADR-0014)."
          />
        </div>
      </Section>

      <Section
        title="Ritual adherence"
        description="A habit is never done; it either recurs or it is closed dishonestly. These are measured against their own target, not against completion."
      >
        {data.ritualAdherence.length === 0 ? (
          <EmptyState
            title="No rituals are tracked"
            description="A ritual is a recurring commitment measured by adherence over time. Neither external tool provides that series — prisme owns it outright — so it stays empty until one is defined."
          />
        ) : (
          <LineChart
            title="Adherence"
            subtitle="Percentage of opportunities taken"
            labels={axis}
            series={data.ritualAdherence.map((ritual) => ({
              label: ritual.name,
              // A period with no opportunity is a gap, not a zero: missing
              // every chance and never having one are different facts.
              values: ritual.points.map((point) => (point.value === 0 ? null : point.value)),
            }))}
            formatAs={{ kind: 'percent' }}
            footnote="A period in which a ritual had no opportunity is drawn as a gap rather than as zero adherence."
          />
        )}
      </Section>

      <Section
        title="Objective attainment"
        description="Self-assessed progress beside what the task breakdown computes. The two disagreeing is information (ADR-0013), not an error."
      >
        {data.objectiveAttainment.length === 0 ? (
          <EmptyState
            title="No objectives to report on"
            description="Objectives are authored in prisme and reported back to the document tool. Until one exists, attainment has nothing to measure."
          />
        ) : (
          <BarChart
            title="Attainment"
            series={['Self-assessed', 'Computed']}
            data={data.objectiveAttainment.map((objective) => ({
              label: objective.title,
              values: [objective.progressSelfPct ?? 0, objective.progressComputedPct ?? 0],
            }))}
            formatAs={{ kind: 'percent' }}
            reference={{ value: 100, label: 'Complete' }}
            footnote="A key result with no task breakdown has no computed figure; it is drawn as zero and is not the same as no progress."
          />
        )}
      </Section>

      <Section
        title="Work in progress, by age"
        description="How long each thing in flight has sat with nothing moving underneath it."
      >
        <BarChart
          title="Untouched for"
          subtitle="Items in the now set"
          series={['Items']}
          data={
            idle.length === 0
              ? []
              : agingBuckets(idle).map((bucket) => ({
                  label: bucket.label,
                  values: [bucket.count],
                }))
          }
          formatAs={{ kind: 'number' }}
          emptyMessage="Nothing is in flight."
          footnote="Days since the last task activity, not days since the work started — prisme does not record when an initiative entered the now set, so that figure is not available to show."
        />
      </Section>

      <Section title="Not measured yet" description="What this dashboard cannot answer, and why.">
        <Card className="flex flex-col gap-2 text-sm text-ink-secondary">
          <p>
            <span className="font-medium text-ink">Cycle time.</span> prisme records no moment at
            which an initiative started, so the time from starting to finishing cannot be read from
            what the API serves. Deriving it means pairing status transitions out of the event log,
            which is aggregation the API owns — a second copy of it in this tier is how two parts of
            one product start disagreeing about the same number. It belongs behind{' '}
            <code className="text-ink">/kpi</code>.
          </p>
          <p>
            Until then, the age chart above is the honest substitute: it says how long work has sat,
            which is the question cycle time is usually asked in place of.
          </p>
        </Card>
      </Section>
    </div>
  );
}

function Header({ label }: { label: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold text-ink">KPI</h1>
      <p className="text-sm text-ink-secondary">
        {label}. A metric that has never changed a decision should be cut — that is the exit
        criterion for this phase, deliberately.
      </p>
    </header>
  );
}
