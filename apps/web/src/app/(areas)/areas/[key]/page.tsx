import {
  AreaBadge,
  BalanceMeter,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  LineChart,
  Section,
  StatRow,
  StatTile,
} from '@prisme/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { completionsSummary, itemisationGap } from '@/lib/completions-view';
import {
  areaCompletionsSchema,
  areaDetailSchema,
  areaWeightsSchema,
  balanceSchema,
  focusSchema,
  kpiSchema,
} from '@/lib/contracts';
import {
  bucketLabel,
  estimatedMinutesPct,
  labelsOf,
  measuredBuckets,
  minutesChartCaveat,
  monthsBefore,
  observedShareSeries,
} from '@/lib/kpi-view';
import { declaredSeries, yearsSpanned, type WeightsByYear } from '@/lib/weight-year';
import { CompletionsTable } from './completions-table';

/**
 * One area, over time.
 *
 * The overview answers "which area is starved"; this answers "and has it been,
 * or is this one bad month?". That question needs history, and history is
 * where the year-boundary bug lives — so the declared line here is resolved
 * per bucket from the weights in force at that time, never from this year's
 * (`../../../lib/weight-year.ts`).
 *
 * It also answers "which work was that?" — the completions the observed share
 * was made of, over the window `/balance` measured, each with the time it was
 * counted for. A share that cannot be taken apart gets overridden once and
 * then ignored.
 */

const HISTORY_MONTHS = 24;

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: `${key} · Areas · prisme` };
}

export default async function AreaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { key } = await params;
  const requested = Number((await searchParams).year);
  const year = Number.isInteger(requested) ? requested : new Date().getUTCFullYear();

  const to = `${String(year)}-12-31`;
  const from = monthsBefore(to, HISTORY_MONTHS);

  const [area, balance, completed, kpi, focus] = await Promise.all([
    apiFetch({ path: `/areas/${encodeURIComponent(key)}`, schema: areaDetailSchema }),
    apiFetch({ path: '/balance', query: { year: String(year) }, schema: balanceSchema }),
    apiFetch({
      path: `/areas/${encodeURIComponent(key)}/completions`,
      query: { year: String(year) },
      schema: areaCompletionsSchema,
    }),
    apiFetch({ path: '/kpi', query: { from, to, bucket: 'month' }, schema: kpiSchema }),
    apiFetch({ path: '/focus', schema: focusSchema }),
  ]);

  if (!area.ok) {
    if (area.kind === 'not_found') notFound();
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs crumbs={[{ label: 'Areas', href: '/areas' }, { label: key }]} linkAs={Link} />
        <ApiFailureState failure={area} surface="this area" />
      </div>
    );
  }

  const row = balance.ok ? balance.data.areas.find((entry) => entry.areaKey === key) : undefined;

  // One request per year the history spans, so a chart crossing 31 December
  // has both years' decisions in hand before it draws a point.
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

  const labels = kpi.ok ? labelsOf(kpi.data.minutes) : [];
  const observed = kpi.ok ? observedShareSeries(key, kpi.data.minutes) : [];
  const declared = declaredSeries(labels, key, byYear);
  const measured = kpi.ok ? measuredBuckets(kpi.data.minutes) : 0;

  const throughput = kpi.ok
    ? (kpi.data.throughput.find((series) => series.areaKey === key)?.points ?? [])
    : [];

  const inFlight = focus.ok
    ? focus.data.now.filter((entry) => entry.initiative.areaKey === key)
    : [];
  const slot = focus.ok ? focus.data.slotsByArea.find((s) => s.areaKey === key) : undefined;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumbs
        crumbs={[{ label: 'Areas', href: '/areas' }, { label: area.data.name }]}
        linkAs={Link}
      />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <AreaBadge areaKey={area.data.key} name={area.data.name} kind={area.data.kind} />
          </h1>
          <p className="text-sm text-ink-secondary">
            {area.data.rankable
              ? 'Ranked. Initiatives here compete with each other and with nothing outside this area.'
              : 'A lane. It counts toward capacity and is never ranked (ADR-0014).'}
            {area.data.active ? '' : ' Inactive.'}
          </p>
        </div>
      </header>

      {row === undefined ? null : (
        <>
          <StatRow>
            <StatTile
              label={`Observed share, ${String(balance.ok ? balance.data.windowWeeks : 4)} weeks`}
              value={`${row.actualSharePct.toFixed(1)}%`}
            />
            <StatTile
              label={`Declared for ${String(year)}`}
              value={row.targetSharePct === null ? 'no share' : `${row.targetSharePct.toFixed(0)}%`}
            />
            <StatTile label="Balance factor" value={row.balanceFactor.toFixed(2)} />
            <StatTile label="Completed in the window" value={String(row.completions)} />
          </StatRow>

          <Card>
            <BalanceMeter
              areaKey={row.areaKey}
              name={row.name}
              kind={row.kind}
              targetPct={row.targetSharePct ?? 0}
              observedPct={row.actualSharePct}
              stale={row.stale}
            />
          </Card>
        </>
      )}

      <div id="completed" className="scroll-mt-6">
        <Section
          title="Completed in the window"
          description={
            area.data.kind === 'signals'
              ? 'Every completion counted here over the window, newest first. Signals are volume: they are counted and add no time.'
              : 'Every completion counted toward the observed share above, newest first, with the time each was counted for. That share is this area’s part of all the time attributed across every area — not progress through this area’s own work.'
          }
        >
          {!completed.ok ? (
            <ApiFailureState failure={completed} surface="this area's completions" />
          ) : completed.data.completions.length === 0 && (row?.completions ?? 0) === 0 ? (
            <EmptyState
              title="Nothing counted here in this window"
              description={`No completion in ${completed.data.from} → ${completed.data.to} was attributed to this area. If work happened here, its project may not be mapped to the area yet — Settings is where a project is folded into an area.`}
            />
          ) : (
            <>
              <p className="text-sm text-ink tabular-nums">
                {completionsSummary(completed.data.totals, area.data.kind)}
              </p>
              {row === undefined ? null : (
                <GapNote
                  text={itemisationGap(completed.data.totals.completions, row.completions)}
                />
              )}
              <CompletionsTable
                rows={completed.data.completions}
                now={new Date().toISOString()}
                areaName={area.data.name}
              />
              <p className="text-xs text-ink-muted">
                {completed.data.from} → {completed.data.to}, the window the share above was measured
                over. A title is the one the task had when prisme fetched it.
              </p>
            </>
          )}
        </Section>
      </div>

      <Section
        title="Share over time"
        description="What this area received each month, against what it was allocated that year."
      >
        {!kpi.ok ? (
          <ApiFailureState failure={kpi} surface="this area's history" />
        ) : (
          <LineChart
            title={`${area.data.name} — observed against declared`}
            subtitle="Monthly, as a percentage of all attributed capacity"
            labels={labels.map((label) => bucketLabel(label, 'month'))}
            series={[
              { label: 'Observed', values: [...observed] },
              // The declared line takes the lane grey rather than a second
              // hue: it is a reference, not a competing measurement, and a
              // categorical colour would make it read as another area.
              { label: 'Declared', values: [...declared], slot: 'lane' },
            ]}
            formatAs={{ kind: 'percent' }}
            footnote={`${minutesChartCaveat({
              estimatedPct: balance.ok ? estimatedMinutesPct(balance.data.areas) : null,
              coverage: kpi.data,
              windowed: true,
            })} ${measured === 0 ? '' : `${String(measured)} of ${String(labels.length)} months carry any measurement.`}`}
          />
        )}
      </Section>

      <Section title="Throughput" description="Initiatives completed in this area, per month.">
        {!kpi.ok ? null : (
          <LineChart
            title={`${area.data.name} — completions`}
            labels={labels.map((label) => bucketLabel(label, 'month'))}
            series={[
              {
                label: 'Completed',
                values: throughput.map((point) => point.value),
              },
            ]}
            formatAs={{ kind: 'number' }}
          />
        )}
      </Section>

      <Section
        title="In flight"
        description={
          slot === undefined
            ? 'What is in the now set for this area.'
            : `${String(slot.used)} of ${String(slot.limit)} slots used. Capacity is allocated per area before anything is ranked.`
        }
      >
        {inFlight.length === 0 ? (
          <EmptyState
            title="Nothing in flight here"
            description="This area has no initiative in the now set. That is either a deliberate pause or the reason its observed share is low — the chart above says which."
            action={
              <Button asChild size="sm" variant="secondary">
                <Link href={`/backlog?area=${encodeURIComponent(key)}`}>Open its backlog</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {inFlight.map((entry) => (
              <li key={entry.initiative.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <Link
                    href={`/initiative/${entry.initiative.id}`}
                    className="text-sm text-ink hover:underline"
                  >
                    {entry.initiative.title}
                  </Link>
                  <span className="text-xs text-ink-muted tabular-nums">
                    rank {entry.rank} · score {entry.score.toFixed(2)}
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {area.data.kind === 'run' && area.data.runBudgetHoursPerWeek !== null ? (
        <Section title="Budget" description="Upkeep is budgeted in hours per week, not as a share.">
          <Card className="text-sm text-ink">
            {area.data.runBudgetHoursPerWeek.toFixed(0)} hours per week.{' '}
            {row?.runHoursPerWeek === null || row?.runHoursPerWeek === undefined
              ? 'Nothing has been attributed to it in this window.'
              : `${row.runHoursPerWeek.toFixed(1)} observed.`}
          </Card>
        </Section>
      ) : null}
    </div>
  );
}

function GapNote({ text }: { text: string | null }) {
  if (text === null) return null;
  return <Card className="border-status-warning p-3 text-sm text-ink">{text}</Card>;
}
