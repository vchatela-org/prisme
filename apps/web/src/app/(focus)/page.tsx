import { AreaBadge, Button, Card, EmptyState, Section } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { SyncBar } from '@/components/sync-bar';
import { apiFetch } from '@/lib/api';
import {
  areaListSchema,
  focusSchema,
  syncStatusSchema,
  taskListSchema,
  type Area,
} from '@/lib/contracts';
import {
  dayOf,
  dueSummary,
  type DueSummaryMap,
  groupByArea,
  orderSlots,
  stalenessOf,
  STALE_AFTER_DAYS,
} from '@/lib/focus-view';
import { countsFrom } from '@/lib/guardrails';
import { EntryCard } from './entry-card';

export const metadata = {
  title: 'Focus · prisme',
  description: 'What to work on now, and why each thing is there.',
};

/**
 * Focus — the screen that answers "what should I work on now?".
 *
 * If that takes more than three seconds of reading, nothing else in prisme
 * matters, which is why the page is arranged in exactly the order the question
 * is asked: what is in flight, what is stale in it, and what the next free slot
 * would draw from.
 *
 * ## One request per question
 *
 * `GET /focus` answers the whole screen: the now set, already ranked, already
 * joined to its blockers and its progress, with the reason each item is there.
 * The areas and the sync line are two more, and the per-initiative task counts
 * are one small request each for the now set only — bounded by `maxNow`, which
 * is five. The alternative, a list endpoint filtered client-side, would put
 * aggregation logic in the browser, and that logic is business logic in a
 * second place (`apps/api/src/dto/views.ts`).
 *
 * ## Nothing here is computed
 *
 * No score, no rank, no "at risk" threshold, no balance factor. The one thing
 * the page works out for itself is how long something has sat untouched.
 */
export default async function FocusPage() {
  const [focus, areas, sync] = await Promise.all([
    apiFetch({ path: '/focus', schema: focusSchema }),
    apiFetch({ path: '/areas', schema: areaListSchema }),
    apiFetch({ path: '/sync', schema: syncStatusSchema }),
  ]);

  if (!focus.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={focus} surface="Focus" />
      </div>
    );
  }

  const byKey = new Map<string, Area>((areas.ok ? areas.data.items : []).map((a) => [a.key, a]));
  const areaName = (key: string): string => byKey.get(key)?.name ?? key;
  const areaKind = (key: string): Area['kind'] => byKey.get(key)?.kind ?? 'area';

  const data = focus.data;
  const method = `${data.methodId} v${String(data.methodVersion)}`;
  const today = dayOf(data.asOf);

  // The task counts for the now set only. `upNext` is a queue, not work in
  // progress: what is due under something nobody has started is noise.
  const dueByInitiative: DueSummaryMap = {};
  await Promise.all(
    data.now.map(async (entry) => {
      const tasks = await apiFetch({
        path: `/initiatives/${encodeURIComponent(entry.initiative.id)}/tasks`,
        schema: taskListSchema,
      });
      if (tasks.ok) dueByInitiative[entry.initiative.id] = dueSummary(tasks.data.items, today);
    }),
  );

  const groups = groupByArea(data.now, data.slotsByArea);
  const stale = data.now.filter(
    (entry) => stalenessOf(entry, new Date(data.asOf), STALE_AFTER_DAYS).stale,
  );

  const countsFor = (key: string) =>
    countsFrom(data.slotsByArea, key, areaName(key), data.limits, data.now.length);

  return (
    <div className="flex flex-col gap-8">
      <Header
        right={
          sync.ok ? (
            <SyncBar
              lastRunAt={sync.data.lastRunAt}
              now={data.asOf}
              unresolvedConflicts={sync.data.unresolvedConflicts}
              enabled={sync.data.enabled}
            />
          ) : null
        }
        subtitle={`${String(data.now.length)} of ${String(data.limits.maxNow)} slots in flight · ranked by ${method}`}
      />

      {data.weightsStale ? (
        <Card className="border-status-warning p-4 text-sm text-ink">
          No weights are set for this year, so every balance factor was carried forward from the
          last year that has them. Scores are still comparable within an area; set this year&rsquo;s
          weights before trusting a comparison across one.
        </Card>
      ) : null}

      {data.overCapacity ? (
        <Card className="p-4 text-sm text-ink">
          More is in flight than the limit allows. Nothing has been demoted for it — that is a
          decision for a review, not arithmetic — but it is worth knowing before starting anything
          else.
        </Card>
      ) : null}

      <Section
        title="Now"
        description="In flight, grouped by area. Capacity is allocated per area before anything is ranked, so these compete only with their neighbours."
      >
        {data.now.length === 0 ? (
          <EmptyState
            title="Nothing is in flight"
            description="Focus fills from the top of the ranking, area by area. Open the backlog, pick the thing you would regret not finishing this week, and move it to now."
            action={
              <Button asChild size="sm">
                <Link href="/backlog?status=next">Open the backlog</Link>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <div key={group.areaKey} className="flex flex-col gap-3">
                <div className="flex items-baseline gap-3">
                  <AreaBadge
                    areaKey={group.areaKey}
                    name={areaName(group.areaKey)}
                    kind={areaKind(group.areaKey)}
                  />
                  {group.slot === undefined ? null : (
                    <span className="text-xs text-ink-muted tabular-nums">
                      {group.slot.used} of {group.slot.limit} slots
                    </span>
                  )}
                </div>

                {group.entries.map((entry) => (
                  <EntryCard
                    key={entry.initiative.id}
                    entry={entry}
                    areaName={areaName(entry.initiative.areaKey)}
                    areaKind={areaKind(entry.initiative.areaKey)}
                    now={data.asOf}
                    method={method}
                    weightsStale={data.weightsStale}
                    counts={countsFor(entry.initiative.areaKey)}
                    {...(dueByInitiative[entry.initiative.id] === undefined
                      ? {}
                      : { due: dueByInitiative[entry.initiative.id] })}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>

      {stale.length > 0 ? (
        <Section
          title={`Stale — ${String(stale.length)} in now, untouched`}
          description={`Nothing has moved under these for ${String(STALE_AFTER_DAYS)} days or more. Usually that means blocked, or too large to have a next step — both worth deciding about rather than carrying into another week.`}
        >
          <ul className="flex flex-col gap-2">
            {stale.map((entry) => {
              const staleness = stalenessOf(entry, new Date(data.asOf), STALE_AFTER_DAYS);
              return (
                <li key={entry.initiative.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <Link
                      href={`/initiative/${entry.initiative.id}`}
                      className="text-sm text-ink hover:underline"
                    >
                      {entry.initiative.title}
                    </Link>
                    <span className="text-xs text-status-warning">{staleness.label}</span>
                  </Card>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      <Section
        title="Up next"
        description="What the next free slot would draw from, in ranked order — with the reason each one is not in flight yet."
      >
        {data.upNext.length === 0 ? (
          <EmptyState
            title="The queue is empty"
            description="Everything eligible is already in flight. Anything sitting in later or inbox needs an estimate and a status before it can be ranked."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/inbox">Triage the inbox</Link>
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {data.upNext.map((entry) => (
              <EntryCard
                key={entry.initiative.id}
                entry={entry}
                areaName={areaName(entry.initiative.areaKey)}
                areaKind={areaKind(entry.initiative.areaKey)}
                now={data.asOf}
                method={method}
                weightsStale={data.weightsStale}
                counts={countsFor(entry.initiative.areaKey)}
                variant="queue"
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Slots" description="Where this week's capacity has gone, by area.">
        <ul className="flex flex-wrap gap-2">
          {orderSlots(data.slotsByArea).map((slot) => (
            <li key={slot.areaKey}>
              <Card className="flex items-center gap-3 px-3 py-2">
                <AreaBadge
                  areaKey={slot.areaKey}
                  name={areaName(slot.areaKey)}
                  kind={slot.kind}
                  size="sm"
                />
                <span className="text-xs text-ink-secondary tabular-nums">
                  {slot.used}/{slot.limit}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Header({ right, subtitle }: { right?: React.ReactNode; subtitle?: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Focus</h1>
        <p className="text-sm text-ink-secondary">
          {subtitle ?? 'What to work on now, and why each thing is there.'}
        </p>
      </div>
      {right}
    </header>
  );
}
