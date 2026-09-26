import {
  AreaBadge,
  BalanceMeter,
  Button,
  Card,
  EmptyState,
  Section,
  StaleWeightsBanner,
  StatRow,
  StatTile,
} from '@prisme/ui';
import Link from 'next/link';
import { areaColorCollisions } from '@prisme/ui/server';
import { AreaColourNotice } from '@/components/area-colour-notice';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { proposePins } from '@/lib/area-pin-proposal';
import { instanceAreaColors } from '@/lib/area-pins';
import { areaWeightsSchema, balanceSchema, focusSchema, type AreaBalance } from '@/lib/contracts';
import { estimatedMinutesPct, minutesChartCaveat, mostStarved, orderAreas } from '@/lib/kpi-view';

export const metadata = {
  title: 'Areas · prisme',
  description: 'What each area was allocated, and what it actually received.',
};

/**
 * Areas — declared versus observed capacity.
 *
 * This is the screen that exists in no other tool, and the one most likely to
 * change a decision. Neither the document tool nor the task tool can say what
 * share of a month went to each area, because neither knows the areas; prisme
 * can, and the gap between what was agreed and what happened is the whole
 * point of allocating before ranking (ADR-0005).
 *
 * ## The hero is the comparison, not the number
 *
 * Each area is a meter scaled to *its own* target, so an area on 5% and an
 * area on 30% both fill half their bar when they are on their agreed share
 * (`balance-meter-core.ts`). The eye compares positions down a column instead
 * of doing six divisions, and an area that is starved is visible before any
 * number is read.
 *
 * ## Nothing here is computed
 *
 * `balanceFactor`, `actualSharePct` and `targetSharePct` all arrive from
 * `/balance`, computed by `packages/domain` over the rolling four-week window.
 * This screen orders them, labels them and says what they rest on.
 *
 * ## Weights are read-only here, and the page says why
 *
 * A weight is fixed for a calendar year and changed only at the Year Review
 * (ADR-0007). A pencil icon beside each share would make that rigidity look
 * like an oversight; instead the section says when they can next change and
 * links to the surface that changes them.
 */
export default async function AreasPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const requested = Number((await searchParams).year);
  const year = Number.isInteger(requested) ? requested : new Date().getUTCFullYear();

  // `/balance` already carries each area's name and kind, so this screen needs
  // no separate `/areas` read — one fewer round trip, and no chance of the two
  // disagreeing about an area's name halfway down the page.
  const [balance, weights, focus] = await Promise.all([
    apiFetch({ path: '/balance', query: { year: String(year) }, schema: balanceSchema }),
    apiFetch({ path: '/areas/weights', query: { year: String(year) }, schema: areaWeightsSchema }),
    apiFetch({ path: '/focus', schema: focusSchema }),
  ]);

  if (!balance.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header year={year} />
        <ApiFailureState failure={balance} surface="the balance view" />
      </div>
    );
  }

  const data = balance.data;

  const targetOf = (key: string): number | null =>
    data.areas.find((row) => row.areaKey === key)?.targetSharePct ?? null;

  // A colour clash is reported with names, not keys: the key is what goes in the
  // environment, and the name is what the reader is looking at on the chart.
  const nameOf = new Map(data.areas.map((row) => [row.areaKey, row.name]));

  const rows = orderAreas(data.areas, targetOf);
  const ranked = rows.filter((row) => row.kind === 'area');
  const lanes = rows.filter((row) => row.kind !== 'area');

  const inFlight = new Map<string, number>(
    (focus.ok ? focus.data.slotsByArea : []).map((slot) => [slot.areaKey, slot.used]),
  );

  const estimated = estimatedMinutesPct(data.areas);

  // Read off the balance factor the API already computed, never a ratio worked
  // out here — and reported as a count when the clamp has flattened several
  // areas onto the same number, which on a real window it usually has.
  const worst = mostStarved(ranked);

  /*
   * The colours, and whether two areas are wearing the same one.
   *
   * This screen is the only place it can be both detected and fixed: the
   * pinning is `AREA_COLOR_PINS`, which is web-tier configuration, so nothing
   * outside this tier can tell whether the colours in force still collide.
   * Reported here rather than on every screen that paints an area — one
   * explanation of a global setting, where the areas themselves are listed.
   */
  const areas = data.areas.map((row) => ({ key: row.areaKey, kind: row.kind }));
  const pins = await instanceAreaColors();
  const collisions = areaColorCollisions(areas, pins).map((group) =>
    group.map((key) => ({ key, name: nameOf.get(key) ?? key })),
  );

  return (
    <div className="flex flex-col gap-8">
      <Header
        year={year}
        window={`${data.from} → ${data.to} · ${String(data.windowWeeks)} weeks`}
      />

      {data.stale ? (
        <StaleWeightsBanner
          year={data.weightYear}
          carriedFrom={data.weightSourceYear ?? data.weightYear}
          action={
            <Button asChild size="sm">
              <Link href="/review/year">Open the Year Review</Link>
            </Button>
          }
        />
      ) : null}

      {collisions.length > 0 ? (
        <AreaColourNotice collisions={collisions} proposal={proposePins(areas, pins)} />
      ) : null}

      <StatRow>
        <StatTile label="Areas allocated" value={String(ranked.length)} />
        <StatTile
          label="Declared capacity"
          value={weights.ok ? `${weights.data.sumPct.toFixed(0)}%` : '—'}
        />
        <StatTile
          label="Completions in the window"
          value={String(data.areas.reduce((total, row) => total + row.completions, 0))}
        />
        <StatTile
          label={worst.tied > 1 ? 'Most starved — no single answer' : 'Most starved'}
          value={worst.label}
        />
      </StatRow>

      {weights.ok && Math.round(weights.data.sumPct) !== 100 ? (
        <Card className="border-status-warning p-4 text-sm text-ink">
          The declared shares add up to {weights.data.sumPct.toFixed(0)}%, not 100%. Every target
          share below is read against that total, so they are still comparable to each other — but
          they no longer describe how one person&rsquo;s capacity was meant to be split. The Year
          Review is where that is corrected.
        </Card>
      ) : null}

      <Section
        title={`Declared against observed — ${String(data.weightYear)}`}
        description="What each area was allocated for the year, and what it actually received over the window. The mark in the middle of each track is the agreed share; a full track is twice it."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/kpi">See it over time</Link>
          </Button>
        }
      >
        {ranked.length === 0 ? (
          <EmptyState
            title="No areas are allocated yet"
            description="An area is created once and weighted once a year. Until at least one exists there is nothing to allocate between, and every score is ranked against an empty comparison."
          />
        ) : (
          <Card className="flex flex-col gap-5">
            {ranked.map((row) => (
              <AreaRow
                key={row.areaKey}
                row={row}
                href={`/areas/${encodeURIComponent(row.areaKey)}?year=${String(year)}`}
                inFlight={inFlight.get(row.areaKey) ?? 0}
              />
            ))}
          </Card>
        )}

        <p className="text-xs text-ink-muted">
          {minutesChartCaveat({ estimatedPct: estimated, coverage: data })}
        </p>
      </Section>

      {lanes.length > 0 ? (
        <Section
          title="Lanes"
          description="Upkeep and noise. Both count toward capacity and neither is ever ranked (ADR-0014), so there is no agreed share to be on or off."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {lanes.map((row) => (
              <LaneCard key={row.areaKey} row={row} />
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Year weights" description="Read-only until the Year Review.">
        <Card className="flex flex-col gap-3 text-sm text-ink-secondary">
          <p>
            A weight is fixed for a whole calendar year and decided once, at the Year Review
            (ADR-0007). That rigidity is the mechanism rather than a limitation: a share you can
            adjust in the moment is one that gets adjusted to match whatever you already did, and
            then the gap above stops meaning anything.
          </p>
          <p>
            {weights.ok && !weights.data.stale
              ? `${String(weights.data.year)} was decided for itself. The next decision is due at the end of the year.`
              : 'This year has no weights of its own, so the shares above were carried forward. The Year Review is unlocked until that is settled.'}
          </p>
          <div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/review/year">Open the Year Review</Link>
            </Button>
          </div>
        </Card>
      </Section>
    </div>
  );
}

/**
 * One area: the meter, the numbers behind it, and what it has in flight now.
 *
 * The balance factor is shown as the scoring method reads it, to two decimal
 * places, because it is an input to every score in that area and a reader
 * comparing two scores will want to know which way it pushed.
 */
function AreaRow({ row, href, inFlight }: { row: AreaBalance; href: string; inFlight: number }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-hairline pb-4 last:border-0 last:pb-0">
      <BalanceMeter
        areaKey={row.areaKey}
        name={row.name}
        kind={row.kind}
        targetPct={row.targetSharePct ?? 0}
        observedPct={row.actualSharePct}
        stale={row.stale}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span className="tabular-nums">balance factor {row.balanceFactor.toFixed(2)}</span>
        <span className="tabular-nums">{row.completions} completed</span>
        <span className="tabular-nums">{Math.round(row.minutes / 60)} h attributed</span>
        <span className="tabular-nums">{inFlight} in flight</span>
        <Link href={href} className="text-ink-secondary hover:underline">
          Open
        </Link>
      </div>
    </div>
  );
}

/**
 * A lane. Run carries hours against a budget; Signals carries volume and no
 * time at all, so the card says that rather than showing an empty hours line.
 */
function LaneCard({ row }: { row: AreaBalance }) {
  return (
    <Card className="flex flex-col gap-2">
      <AreaBadge areaKey={row.areaKey} name={row.name} kind={row.kind} />
      {row.kind === 'run' ? (
        <>
          <p className="text-2xl font-semibold text-ink">
            {(row.runHoursPerWeek ?? 0).toFixed(1)}
            <span className="text-sm font-normal text-ink-secondary">
              {' '}
              h/week
              {row.runBudgetHoursPerWeek === null
                ? ''
                : ` of ${row.runBudgetHoursPerWeek.toFixed(0)} budgeted`}
            </span>
          </p>
          <p className="text-xs text-ink-secondary">
            {row.runBudgetHoursPerWeek === null
              ? 'No budget is set, so there is nothing to be over or under.'
              : (row.runHoursPerWeek ?? 0) > row.runBudgetHoursPerWeek
                ? 'Over budget. Upkeep is taking time that was allocated to an area.'
                : 'Within budget.'}
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-semibold text-ink">
            {row.completions}
            <span className="text-sm font-normal text-ink-secondary"> in the window</span>
          </p>
          <p className="text-xs text-ink-secondary">
            Counted as volume and nothing else. Responding to an alert is not a choice about how to
            spend a week, so Signals contributes no minutes to the comparison above.
          </p>
        </>
      )}
      <p className="text-xs text-ink-muted tabular-nums">
        {row.actualSharePct.toFixed(1)}% of attributed capacity
      </p>
    </Card>
  );
}

function Header({ year, window: windowText }: { year: number; window?: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Areas</h1>
        <p className="text-sm text-ink-secondary">
          What each area was allocated for {year}, and what it actually received.
        </p>
      </div>
      {windowText ? <p className="text-xs text-ink-muted tabular-nums">{windowText}</p> : null}
    </header>
  );
}
