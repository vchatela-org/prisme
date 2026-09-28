import { AreaBadge, Badge, Button, Card, EmptyState, Section, StatRow, StatTile } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  areaListSchema,
  backlogSchema,
  objectivePageSchema,
  type Objective,
} from '@/lib/contracts';
import {
  currentPeriod,
  elapsedPctOf,
  groupByPeriod,
  nextMonthlyPeriod,
  objectiveProgress,
  orphanInitiatives,
  orphanObjectives,
  servedInitiativeIds,
  splitUpcoming,
  type OrphanInitiative,
  type PeriodGroup,
} from '@/lib/objectives-view';
import { AuthorObjectiveForm } from './author-form';
import { ProgressPair } from './progress-pair';

export const metadata = {
  title: 'Objectives · prisme',
  description: 'What each period is for, and whether the work behind it is moving.',
};

/**
 * Enough to cover the year under way and the one before it, which is the
 * window the monthly and yearly reviews read. Objectives are authored a
 * handful per period, so this is a generous ceiling rather than a paging
 * decision waiting to be made.
 */
const PAGE_LIMIT = 200;

/**
 * The statuses whose connection to an objective is worth an opinion.
 *
 * Deliberately not the whole backlog. `later` holds work that has been
 * deferred on purpose and `inbox` holds work nobody has decided about yet —
 * reporting either as an orphan would produce a list that is true, enormous,
 * and never read. What is in flight or queued is the work actually consuming
 * the period, so that is the work the question is asked about.
 */
const IN_FLIGHT = 'now,next,waiting,review';

/**
 * Objectives, by period.
 *
 * ## The two numbers sit beside each other and are never merged
 *
 * Every key result shows `progressSelf` — a judgement — next to
 * `progressComputed`, which is tasks closed beneath the anchor. ADR-0013 is
 * that these measure different things and that the gap between them is worth
 * more than either. So this page never averages them, never shows a single
 * "progress" figure, and where they diverge materially it says what that
 * divergence usually means rather than flagging it as an error.
 *
 * A key result with no breakdown shows no computed number at all — not zero.
 * Absent and zero are different facts, and painting the first as the second
 * would manufacture a divergence on every objective that has no anchor yet.
 *
 * ## Orphans are shown in both directions and neither is an error
 *
 * An objective nothing serves, and in-flight work serving no objective. Both
 * are worth seeing once a month; neither is automatically wrong. An objective
 * authored this morning has nothing behind it and should not. That is why
 * these are sections with counts rather than warnings with a badge.
 *
 * ## A period still to come is kept out of sight
 *
 * An objective whose period has not started is a plan, not what now is for. It
 * sits folded under *Upcoming*, after the periods under way, and is left out of
 * every count and of the orphans — whatever its status, because one can be
 * `active` ahead of time. On the first day of its period it moves up by itself.
 */
export default async function ObjectivesPage() {
  const today = new Date().toISOString().slice(0, 10);

  const [objectives, areas, inFlight] = await Promise.all([
    apiFetch({
      path: '/objectives',
      query: { limit: String(PAGE_LIMIT) },
      schema: objectivePageSchema,
    }),
    apiFetch({ path: '/areas', schema: areaListSchema }),
    apiFetch({
      path: '/backlog',
      query: { status: IN_FLIGHT, limit: String(PAGE_LIMIT) },
      schema: backlogSchema,
    }),
  ]);

  if (!objectives.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={objectives} surface="the objectives" />
      </div>
    );
  }

  const items = objectives.data.items;
  const { started, upcoming } = splitUpcoming(items, today);
  const groups = groupByPeriod(started);
  const upcomingGroups = groupByPeriod(upcoming);
  const areaNames = new Map(
    (areas.ok ? areas.data.items : []).map((area) => [area.key, area.name]),
  );

  const active = started.filter((objective) => objective.status === 'active');
  const orphanedObjectives = orphanObjectives(active);

  const served = servedInitiativeIds(items);
  // Work not under way yet takes none of the period, so it is owed no objective yet.
  const candidates: readonly OrphanInitiative[] = (inFlight.ok ? inFlight.data.items : [])
    .filter((entry) => entry.notUnderWay === null)
    .map((entry) => ({
      id: entry.initiative.id,
      title: entry.initiative.title,
      areaKey: entry.initiative.areaKey,
      status: entry.initiative.status,
    }));
  const orphanedWork = orphanInitiatives(candidates, served);

  const keyResultCount = started.reduce(
    (total, objective) => total + objective.keyResults.length,
    0,
  );

  return (
    <div className="flex flex-col gap-8">
      <Header />

      <StatRow>
        <StatTile label="Active objectives" value={String(active.length)} />
        <StatTile label="Key results" value={String(keyResultCount)} />
        <StatTile
          label="Active objectives with no work"
          value={String(orphanedObjectives.length)}
        />
        <StatTile
          label="In-flight work with no objective"
          value={inFlight.ok ? String(orphanedWork.length) : '—'}
        />
      </StatRow>

      {items.length === 0 ? (
        <EmptyState
          title="No objectives yet"
          description="An objective says what a period is for, and a key result says how you would know it happened. Author the first one below — annual objectives set the direction a month's objectives are steps toward."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No objective’s period has started"
          description="Every objective here is for a period still to come. They are under Upcoming, and each one moves up here on the first day of its period."
        />
      ) : (
        groups.map((group) => (
          <PeriodSection key={group.period} group={group} today={today} areaNames={areaNames} />
        ))
      )}

      {upcoming.length === 0 ? null : (
        <Section
          title="Upcoming"
          description="Objectives for a period that has not started. They are a plan, not what now is for, so nothing above counts them; each one moves up on the first day of its period."
        >
          <details>
            <summary className="cursor-pointer text-sm text-ink-secondary">
              {`Show ${String(upcoming.length)} ${
                upcoming.length === 1 ? 'objective' : 'objectives'
              }, for ${upcomingGroups.map((group) => group.period).join(', ')}`}
            </summary>
            <div className="mt-4 flex flex-col gap-8">
              {upcomingGroups.map((group) => (
                <PeriodSection
                  key={group.period}
                  group={group}
                  today={today}
                  areaNames={areaNames}
                />
              ))}
            </div>
          </details>
        </Section>
      )}

      <Section
        title="Objectives with nothing behind them"
        description="Active objectives no initiative serves. Not an error — an objective authored this morning is here and should be. It is a finding when it is still here at the end of the month."
      >
        {orphanedObjectives.length === 0 ? (
          <EmptyState
            title="Every active objective has work behind it"
            description="Each one has at least one key result an initiative is linked to."
          />
        ) : (
          <Card className="flex flex-col gap-2 p-4">
            {orphanedObjectives.map((objective) => (
              <div key={objective.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/objectives/${objective.id}`} className="text-ink hover:underline">
                  {objective.title}
                </Link>
                <AreaBadge
                  areaKey={objective.areaKey}
                  name={areaNames.get(objective.areaKey) ?? objective.areaKey}
                />
                <span className="text-xs text-ink-muted">{objective.period}</span>
                <span className="text-xs text-ink-muted">
                  {objective.keyResults.length === 0
                    ? 'no key results'
                    : 'no initiative linked to any key result'}
                </span>
              </div>
            ))}
          </Card>
        )}
      </Section>

      <Section
        title="Work serving no objective"
        description="What is in flight or queued and connected to no key result. Also not an error: upkeep, a favour and a deadline from outside are all legitimately unattached. It is worth knowing how much of the period they are taking."
      >
        {!inFlight.ok ? (
          <ApiFailureState failure={inFlight} surface="the in-flight work" />
        ) : orphanedWork.length === 0 ? (
          <EmptyState
            title="Every in-flight initiative serves an objective"
            description="Nothing queued or under way is unattached."
          />
        ) : (
          <Card className="flex flex-col gap-2 p-4">
            {orphanedWork.map((initiative) => (
              <div key={initiative.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/initiative/${initiative.id}`} className="text-ink hover:underline">
                  {initiative.title}
                </Link>
                <AreaBadge
                  areaKey={initiative.areaKey}
                  name={areaNames.get(initiative.areaKey) ?? initiative.areaKey}
                />
                <span className="text-xs text-ink-muted">{initiative.status}</span>
              </div>
            ))}
          </Card>
        )}
      </Section>

      <Section
        title="Author an objective"
        description="What the coming period is for. The period can move while the objective is open; once it is met, missed or dropped, it keeps the period it was judged against."
      >
        {!areas.ok ? (
          <ApiFailureState failure={areas} surface="the areas" />
        ) : (
          <AuthorObjectiveForm
            // Areas of the Change lane only. Run and Signals are lanes: Run is
            // upkeep that is measured rather than aimed at, and Signals is
            // volume to keep down. Neither carries an objective, and offering
            // one is how a lane quietly acquires a target it should not have.
            areas={areas.data.items
              .filter((area) => area.kind === 'area')
              .map((area) => ({ key: area.key, name: area.name }))}
            annualPeriod={currentPeriod('annual', today)}
            monthlyPeriod={nextMonthlyPeriod(today)}
          />
        )}
      </Section>
    </div>
  );
}

/** One period's objectives, each with its key results and their two numbers. */
function PeriodSection({
  group,
  today,
  areaNames,
}: {
  group: PeriodGroup;
  today: string;
  areaNames: ReadonlyMap<string, string>;
}) {
  return (
    <Section
      title={group.period}
      description={
        group.type === 'annual'
          ? 'The year’s direction. A month’s objectives are read as steps toward these.'
          : 'One month. Narrow enough that progress is a fact rather than a forecast.'
      }
    >
      <div className="flex flex-col gap-4">
        {group.objectives.map((objective) => (
          <ObjectiveCard
            key={objective.id}
            objective={objective}
            today={today}
            areaNames={areaNames}
          />
        ))}
      </div>
    </Section>
  );
}

function ObjectiveCard({
  objective,
  today,
  areaNames,
}: {
  objective: Objective;
  today: string;
  areaNames: ReadonlyMap<string, string>;
}) {
  const elapsedPct = elapsedPctOf(objective.period, today);
  const rollup = objectiveProgress(objective);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link
            href={`/objectives/${objective.id}`}
            className="text-base font-medium text-ink hover:underline"
          >
            {objective.title}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <AreaBadge
              areaKey={objective.areaKey}
              name={areaNames.get(objective.areaKey) ?? objective.areaKey}
            />
            <Badge variant={objective.status === 'active' ? 'accent' : 'neutral'}>
              {objective.status}
            </Badge>
            <span className="text-xs text-ink-muted">
              {elapsedPct >= 100 ? 'Period over' : `${elapsedPct.toFixed(0)}% of the period gone`}
            </span>
          </div>
        </div>

        <Button asChild variant="ghost" size="sm">
          <Link href={`/objectives/${objective.id}`}>Open</Link>
        </Button>
      </div>

      {objective.keyResults.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          No key result yet, so nothing measures this. It counts as an orphan until one is added.
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-muted">
            {rollup.selfPct === null
              ? null
              : `Mean across ${String(rollup.keyResultCount)} key ${
                  rollup.keyResultCount === 1 ? 'result' : 'results'
                }: ${rollup.selfPct.toFixed(0)}% self-assessed`}
            {rollup.computedPct === null
              ? ', nothing computed'
              : `, ${rollup.computedPct.toFixed(0)}% computed from ${String(
                  rollup.computedFrom,
                )} of ${String(rollup.keyResultCount)}`}
            .
          </p>

          <div className="flex flex-col gap-3">
            {objective.keyResults.map((keyResult) => (
              <ProgressPair
                key={keyResult.id}
                keyResult={keyResult}
                objectiveId={objective.id}
                elapsedPct={elapsedPct}
              />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Header() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold text-ink">Objectives</h1>
      <p className="text-sm text-ink-secondary">
        What each period is for, and whether the work behind it is moving. Self-assessed progress
        sits beside what the breakdown computes; the two are never averaged.
      </p>
    </header>
  );
}
