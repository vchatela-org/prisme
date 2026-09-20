import { AreaBadge, Button, Card, EmptyState, StatRow, StatTile } from '@prisme/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  areaListSchema,
  backlogSchema,
  balanceSchema,
  conflictPageSchema,
  deadlineHealthSchema,
  focusSchema,
  inboxSchema,
  objectivePageSchema,
  ritualListSchema,
  timelineSchema,
  type ReviewCadence,
} from '@/lib/contracts';
import {
  divergenceOf,
  elapsedPctOf,
  orphanInitiatives,
  orphanObjectives,
  servedInitiativeIds,
  type OrphanInitiative,
} from '@/lib/objectives-view';
import type { StepPanel as StepPanelKind } from '@/lib/review-wizard';

/**
 * The data a step is about, rendered inside the step.
 *
 * This is the whole difference between the wizard and the paper checklist it
 * replaces. A step that says "check the now set for staleness" and shows
 * nothing is worse than paper, because it takes longer to tick. So each panel
 * fetches what its step is about and renders the part of it the step needs —
 * not the whole surface, which is what the link beside it is for.
 *
 * ## One panel is fetched per view, not fifteen
 *
 * The wizard renders one step at a time, so only the current step's panel is
 * ever built. A review that fetched every panel up front would make opening
 * step one wait for the timeline, the balance and the conflict ledger.
 *
 * ## Panels read, and almost never write
 *
 * A step's decision usually belongs to a surface that owns it — re-scoring is
 * the backlog's, resolving a conflict is the reconciler's. The panel shows the
 * evidence and links out; it does not reimplement the decision, because two
 * implementations of a write is how two screens start disagreeing about what
 * happened.
 */
export function StepPanel({
  panel,
  cadence,
}: {
  panel: StepPanelKind;
  cadence: ReviewCadence;
}): ReactNode {
  switch (panel) {
    case 'inbox':
      return <InboxPanel />;
    case 'finished':
      return <FinishedPanel />;
    case 'now-set':
      return <NowSetPanel />;
    case 'conflicts':
      return <ConflictsPanel />;
    case 'deadlines':
      return <DeadlinesPanel />;
    case 'rescore':
      return <RescorePanel />;
    case 'refill':
      return <RefillPanel />;
    case 'capacity':
      return <CapacityPanel />;
    case 'lanes':
      return <LanesPanel />;
    case 'objective-progress':
      return <ObjectiveProgressPanel />;
    case 'orphans':
      return <OrphansPanel />;
    case 'author-objectives':
      return <AuthorObjectivesPanel />;
    case 'replan':
      return <ReplanPanel />;
    case 'allocate-weights':
      return <AllocatePanel />;
    case 'decisions':
      // Rendered by the wizard itself: it is the only step whose control is
      // the session rather than a surface, and it needs the session's own
      // decisions and close button.
      return null;
    default:
      return <UnknownPanel panel={panel} cadence={cadence} />;
  }
}

const LIMIT = 100;

/**
 * Area key to display name.
 *
 * Every panel that renders an `AreaBadge` needs it, and each passed the *key*
 * as the name until these screens were driven — so a badge read `craft` on the
 * wizard and `Craft` two clicks away on the objectives page. One panel renders
 * per view, so this is one extra request per page rather than fifteen.
 */
async function areaNamer(): Promise<(key: string) => string> {
  const areas = await apiFetch({ path: '/areas', schema: areaListSchema });
  const names = new Map((areas.ok ? areas.data.items : []).map((area) => [area.key, area.name]));
  return (key) => names.get(key) ?? key;
}

function PanelCard({ children }: { children: ReactNode }) {
  return <Card className="flex flex-col gap-3 p-4">{children}</Card>;
}

async function InboxPanel() {
  const nameOf = await areaNamer();
  const inbox = await apiFetch({ path: '/inbox', schema: inboxSchema });
  if (!inbox.ok) return <ApiFailureState failure={inbox} surface="the inbox" />;

  const { initiatives, takeaways } = inbox.data;
  const actionable = takeaways.filter((takeaway) => takeaway.mayEnterBacklog);
  const principles = takeaways.filter((takeaway) => takeaway.kind === 'principle');

  if (initiatives.length === 0 && takeaways.length === 0) {
    return (
      <EmptyState
        title="Nothing arrived since the last review"
        description="An empty inbox at the weekly review is the normal state, not a sign capture is broken."
      />
    );
  }

  return (
    <PanelCard>
      <StatRow>
        <StatTile label="Initiatives in the inbox" value={String(initiatives.length)} />
        <StatTile label="Takeaways awaiting a decision" value={String(takeaways.length)} />
        <StatTile label="Of those, actionable" value={String(actionable.length)} />
        <StatTile label="Principles" value={String(principles.length)} />
      </StatRow>

      {initiatives.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {initiatives.slice(0, 12).map((initiative) => (
            <li key={initiative.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/initiative/${initiative.id}`} className="text-ink hover:underline">
                {initiative.title}
              </Link>
              <AreaBadge areaKey={initiative.areaKey} name={nameOf(initiative.areaKey)} />
            </li>
          ))}
        </ul>
      ) : null}

      <p className="max-w-prose text-xs text-ink-muted">
        A takeaway carries no text in prisme — the words stay in the document tool. What is triaged
        here is the reference and its kind. A principle never enters the backlog; an action may.
      </p>
    </PanelCard>
  );
}

async function FinishedPanel() {
  const nameOf = await areaNamer();
  const backlog = await apiFetch({
    path: '/backlog',
    query: { status: 'review', limit: String(LIMIT) },
    schema: backlogSchema,
  });
  if (!backlog.ok) return <ApiFailureState failure={backlog} surface="what finished" />;

  if (backlog.data.items.length === 0) {
    return (
      <EmptyState
        title="Nothing is waiting to be confirmed"
        description="No initiative is sitting in review. Anchor completion arrives from the task tool on its own; this step is about the ones that need your word."
      />
    );
  }

  return (
    <PanelCard>
      <ul className="flex flex-col gap-2">
        {backlog.data.items.map((entry) => (
          <li key={entry.initiative.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/initiative/${entry.initiative.id}`} className="text-ink hover:underline">
              {entry.initiative.title}
            </Link>
            <AreaBadge areaKey={entry.initiative.areaKey} name={nameOf(entry.initiative.areaKey)} />
            <span className="text-xs text-ink-muted">
              {entry.initiative.rollup.totalTaskCount === 0
                ? 'no tasks beneath it'
                : `${String(
                    entry.initiative.rollup.totalTaskCount - entry.initiative.rollup.openTaskCount,
                  )} of ${String(entry.initiative.rollup.totalTaskCount)} closed`}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">
        Confirming one moves it to done, which is what makes it count toward the area&rsquo;s
        observed capacity. Each is confirmed on its own page.
      </p>
    </PanelCard>
  );
}

async function NowSetPanel() {
  const nameOf = await areaNamer();
  const focus = await apiFetch({ path: '/focus', schema: focusSchema });
  if (!focus.ok) return <ApiFailureState failure={focus} surface="the now set" />;

  const { now, slotsByArea, overCapacity, weightsStale } = focus.data;
  const blocked = now.filter((entry) => entry.blockedBy.length > 0);
  const atRisk = now.filter((entry) => entry.deadlineAtRisk);

  return (
    <PanelCard>
      <StatRow>
        <StatTile label="In the now set" value={String(now.length)} />
        <StatTile label="Blocked by something" value={String(blocked.length)} />
        <StatTile label="Deadline at risk" value={String(atRisk.length)} />
        <StatTile
          label="Areas at their cap"
          value={String(slotsByArea.filter((slot) => slot.used >= slot.limit).length)}
        />
      </StatRow>

      {overCapacity ? (
        <p className="text-sm text-status-warning">
          The now set is over capacity. Something has to come out before anything goes in.
        </p>
      ) : null}
      {weightsStale ? (
        <p className="text-sm text-status-warning">
          This year has no weights of its own, so every balance figure below is computed from an
          earlier year&rsquo;s allocation. The Year Review is where that is settled.
        </p>
      ) : null}

      {now.length === 0 ? (
        <EmptyState
          title="Nothing is in flight"
          description="An empty now set at a weekly review is worth a moment: either the week is deliberately clear, or nothing got picked up."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {now.map((entry) => (
            <li key={entry.initiative.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link
                href={`/initiative/${entry.initiative.id}`}
                className="text-ink hover:underline"
              >
                {entry.initiative.title}
              </Link>
              <AreaBadge
                areaKey={entry.initiative.areaKey}
                name={nameOf(entry.initiative.areaKey)}
              />
              {entry.blockedBy.length > 0 ? (
                <span className="text-xs text-status-warning">
                  waiting on {String(entry.blockedBy.length)}
                </span>
              ) : null}
              {entry.daysUntilDeadline !== null ? (
                <span
                  className={
                    entry.deadlineAtRisk ? 'text-xs text-status-warning' : 'text-xs text-ink-muted'
                  }
                >
                  {entry.daysUntilDeadline < 0
                    ? `${String(Math.abs(entry.daysUntilDeadline))} days overdue`
                    : `${String(entry.daysUntilDeadline)} days to deadline`}
                </span>
              ) : null}
              <span className="text-xs text-ink-muted">
                {entry.initiative.rollup.lastActivity === null
                  ? 'no activity recorded'
                  : `last touched ${entry.initiative.rollup.lastActivity.slice(0, 10)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

async function ConflictsPanel() {
  const conflicts = await apiFetch({
    path: '/conflicts',
    query: { limit: String(LIMIT) },
    schema: conflictPageSchema,
  });
  if (!conflicts.ok) return <ApiFailureState failure={conflicts} surface="the conflict ledger" />;

  const unresolved = conflicts.data.items.filter((row) => row.resolution === 'unresolved');

  if (unresolved.length === 0) {
    return (
      <EmptyState
        title="The ledger is clear"
        description="prisme and both external tools agree on every field they share."
      />
    );
  }

  // Fields that conflict repeatedly are a design signal, not only a queue.
  const byField = new Map<string, number>();
  for (const row of unresolved) byField.set(row.field, (byField.get(row.field) ?? 0) + 1);
  const repeated = [...byField.entries()]
    .filter(([, count]) => count > 1)
    .sort(([, left], [, right]) => right - left);

  return (
    <PanelCard>
      <StatRow>
        <StatTile label="Unresolved conflicts" value={String(unresolved.length)} />
        <StatTile label="Fields involved" value={String(byField.size)} />
      </StatRow>

      <ul className="flex flex-col gap-1">
        {unresolved.slice(0, 20).map((row) => (
          <li key={row.id} className="text-sm text-ink">
            <span className="font-medium">{row.field}</span>{' '}
            <span className="text-xs text-ink-muted">
              detected {row.detectedAt.slice(0, 10)} · by {row.actor}
            </span>
          </li>
        ))}
      </ul>

      {repeated.length > 0 ? (
        <p className="max-w-prose text-xs text-ink-secondary">
          <span className="font-medium text-ink">Worth noticing:</span>{' '}
          {repeated.map(([field, count]) => `${field} (${String(count)})`).join(', ')} conflicts
          more than once. A field that conflicts every week is a field whose ownership is wrong —
          that is an ADR, not a weekly chore.
        </p>
      ) : null}

      <p className="text-xs text-ink-muted">
        Each conflict is a decision about who was right. The values themselves are resolved where
        the reconciler owns them; an unresolved ledger is how drift becomes permanent.
      </p>
    </PanelCard>
  );
}

async function DeadlinesPanel() {
  const nameOf = await areaNamer();
  const health = await apiFetch({ path: '/timeline', schema: deadlineHealthSchema });
  if (!health.ok) return <ApiFailureState failure={health} surface="the deadlines" />;

  const withDeadline = health.data.initiatives.filter((row) => row.deadline !== null);
  const infeasible = new Set(health.data.infeasibleDeadlines);

  if (withDeadline.length === 0) {
    return (
      <EmptyState
        title="Nothing carries a deadline"
        description="A deadline prioritises; most work has none, and that is the healthy case."
      />
    );
  }

  const sorted = [...withDeadline].sort((left, right) =>
    (left.deadline ?? '').localeCompare(right.deadline ?? ''),
  );

  return (
    <PanelCard>
      <StatRow>
        <StatTile label="With a deadline" value={String(withDeadline.length)} />
        <StatTile label="The schedule says cannot make it" value={String(infeasible.size)} />
      </StatRow>

      <ul className="flex flex-col gap-1">
        {sorted.slice(0, 20).map((row) => (
          <li key={row.initiativeId} className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/initiative/${row.initiativeId}`} className="text-ink hover:underline">
              {row.initiativeId.slice(0, 8)}
            </Link>
            <AreaBadge areaKey={row.areaKey} name={nameOf(row.areaKey)} />
            <span className="text-xs text-ink-muted tabular-nums">{row.deadline}</span>
            {infeasible.has(row.initiativeId) ? (
              <span className="text-xs text-status-critical">infeasible</span>
            ) : row.deadlineSlackDays !== null ? (
              <span className="text-xs text-ink-muted">
                {String(row.deadlineSlackDays)} days slack
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="max-w-prose text-xs text-ink-muted">
        prisme flags an impossible deadline rather than moving it. A deadline is a statement about
        consequence; the plan is what moves (ADR-0003).
      </p>
    </PanelCard>
  );
}

async function RescorePanel() {
  const nameOf = await areaNamer();
  const backlog = await apiFetch({
    path: '/backlog',
    query: { status: 'next,now,later', sort: 'score', limit: '25' },
    schema: backlogSchema,
  });
  if (!backlog.ok) return <ApiFailureState failure={backlog} surface="the ranked backlog" />;

  if (backlog.data.items.length === 0) {
    return <EmptyState title="Nothing to re-score" description="The backlog is empty." />;
  }

  return (
    <PanelCard>
      <p className="text-xs text-ink-muted">
        Ranked by <span className="font-medium">{backlog.data.methodId}</span> v
        {String(backlog.data.methodVersion)}. Scores compare only within an area.
      </p>
      <ul className="flex flex-col gap-1">
        {backlog.data.items.map((entry) => (
          <li key={entry.initiative.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-8 text-right text-xs text-ink-muted tabular-nums">
              {entry.rank === null ? '—' : entry.rank}
            </span>
            <Link href={`/initiative/${entry.initiative.id}`} className="text-ink hover:underline">
              {entry.initiative.title}
            </Link>
            <AreaBadge areaKey={entry.initiative.areaKey} name={nameOf(entry.initiative.areaKey)} />
            <span className="text-xs text-ink-muted tabular-nums">
              {entry.score === null ? 'unscored' : entry.score.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
      <p className="max-w-prose text-xs text-ink-muted">
        Re-estimating writes the four factors and nothing else — the score that follows is the
        active method&rsquo;s, and every change appends a new score row rather than overwriting one.
      </p>
    </PanelCard>
  );
}

async function RefillPanel() {
  const nameOf = await areaNamer();
  const focus = await apiFetch({ path: '/focus', schema: focusSchema });
  if (!focus.ok) return <ApiFailureState failure={focus} surface="the free slots" />;

  const free = focus.data.slotsByArea.filter((slot) => slot.used < slot.limit);

  return (
    <PanelCard>
      {free.length === 0 ? (
        <EmptyState
          title="Every area is at its cap"
          description="Nothing can be picked up without something being put down. That is the allocation working, not a problem to route around."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {free.map((slot) => (
              <li key={slot.areaKey} className="flex items-center gap-2 text-sm">
                <AreaBadge areaKey={slot.areaKey} name={nameOf(slot.areaKey)} />
                <span className="text-xs text-ink-muted">
                  {String(slot.limit - slot.used)} free of {String(slot.limit)}
                </span>
              </li>
            ))}
          </ul>

          <h4 className="text-sm font-medium text-ink">What the ranking would put there</h4>
          {focus.data.upNext.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              Nothing is queued behind the now set. A free slot with nothing to put in it is worth
              knowing about.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {focus.data.upNext.slice(0, 12).map((entry) => (
                <li key={entry.initiative.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/initiative/${entry.initiative.id}`}
                    className="text-ink hover:underline"
                  >
                    {entry.initiative.title}
                  </Link>
                  <AreaBadge
                    areaKey={entry.initiative.areaKey}
                    name={nameOf(entry.initiative.areaKey)}
                  />
                  <span className="text-xs text-ink-muted">{entry.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="max-w-prose text-xs text-ink-muted">
        Allocation first, ranking only within an area. A slot free in one area is not an argument
        for promoting the highest-scoring thing overall.
      </p>
    </PanelCard>
  );
}

async function CapacityPanel() {
  const balance = await apiFetch({ path: '/balance', schema: balanceSchema });
  if (!balance.ok) return <ApiFailureState failure={balance} surface="the balance" />;

  const counting = balance.data.areas.filter((area) => area.countsTowardCapacity);

  return (
    <PanelCard>
      {balance.data.stale ? (
        <p className="text-sm text-status-warning">
          Weights are resolved from {String(balance.data.weightSourceYear ?? 'an earlier year')},
          not from {String(balance.data.weightYear)}. Every target below is that year&rsquo;s.
        </p>
      ) : null}

      {counting.length === 0 ? (
        <EmptyState
          title="No area counts toward capacity yet"
          description="Declared against observed needs at least one rankable area with completed work."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {counting.map((area) => (
            <li key={area.areaKey} className="flex flex-wrap items-center gap-2 text-sm">
              <AreaBadge areaKey={area.areaKey} name={area.name} />
              <span className="text-xs text-ink-muted tabular-nums">
                declared {area.targetSharePct === null ? '—' : `${area.targetSharePct.toFixed(0)}%`}{' '}
                · observed {area.actualSharePct.toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="max-w-prose text-xs text-ink-muted">
        The gap is the finding. A weight is not editable here and will not be until the Year Review
        — mid-year rationalisation is the thing ADR-0007 exists to prevent.
      </p>
    </PanelCard>
  );
}

async function LanesPanel() {
  const nameOf = await areaNamer();
  const rituals = await apiFetch({ path: '/rituals', schema: ritualListSchema });
  if (!rituals.ok) return <ApiFailureState failure={rituals} surface="the rituals" />;

  const measured = rituals.data.items.filter((ritual) => ritual.latestAdherencePct !== null);
  const below = measured.filter(
    (ritual) => (ritual.latestAdherencePct ?? 0) < ritual.targetAdherencePct,
  );

  return (
    <PanelCard>
      <StatRow>
        <StatTile label="Rituals" value={String(rituals.data.items.length)} />
        <StatTile label="With adherence recorded" value={String(measured.length)} />
        <StatTile label="Below their target" value={String(below.length)} />
      </StatRow>

      {rituals.data.items.length === 0 ? (
        <EmptyState
          title="No rituals yet"
          description="A habit belongs in the Ritual lane, where adherence is measured, rather than in the backlog where it would be ranked and never finished."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {rituals.data.items.map((ritual) => (
            <li key={ritual.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink">{ritual.name}</span>
              <AreaBadge areaKey={ritual.areaKey} name={nameOf(ritual.areaKey)} />
              <span className="text-xs text-ink-muted">{ritual.cadence}</span>
              <span className="text-xs text-ink-muted tabular-nums">
                {ritual.latestAdherencePct === null
                  ? 'no opportunity yet'
                  : `${ritual.latestAdherencePct.toFixed(0)}% against ${ritual.targetAdherencePct.toFixed(0)}%`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="max-w-prose text-xs text-ink-muted">
        No ritual is ranked work, and none of it competes for a now slot — but all of it consumes
        the same week, which is why the lane is checked beside the allocation.{' '}
        <Link href="/kpi" className="underline">
          Run hours and signal volume are on the dashboard
        </Link>
        .
      </p>
    </PanelCard>
  );
}

async function ObjectiveProgressPanel() {
  const nameOf = await areaNamer();
  const today = new Date().toISOString().slice(0, 10);
  const objectives = await apiFetch({
    path: '/objectives',
    query: { status: 'active', limit: String(LIMIT) },
    schema: objectivePageSchema,
  });
  if (!objectives.ok) return <ApiFailureState failure={objectives} surface="the objectives" />;

  const items = objectives.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        title="No active objective"
        description="Nothing is being tracked for this period. The next step authors them."
      />
    );
  }

  const diverging = items.flatMap((objective) => {
    const elapsedPct = elapsedPctOf(objective.period, today);
    return objective.keyResults
      .map((keyResult) => ({
        objective,
        keyResult,
        divergence: divergenceOf(keyResult, elapsedPct),
      }))
      .filter((row) => row.divergence.findings.length > 0);
  });

  return (
    <PanelCard>
      <ul className="flex flex-col gap-2">
        {items.map((objective) => (
          <li key={objective.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/objectives/${objective.id}`} className="text-ink hover:underline">
              {objective.title}
            </Link>
            <AreaBadge areaKey={objective.areaKey} name={nameOf(objective.areaKey)} />
            <span className="text-xs text-ink-muted">
              {objective.period} · {String(objective.keyResults.length)} key results
            </span>
          </li>
        ))}
      </ul>

      {diverging.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border-hairline pt-3">
          <h4 className="text-sm font-medium text-ink">
            {String(diverging.length)} key{' '}
            {diverging.length === 1 ? 'result needs' : 'results need'} a conversation
          </h4>
          {diverging.slice(0, 8).map((row) => (
            <p key={row.keyResult.id} className="max-w-prose text-xs text-ink-secondary">
              <Link
                href={`/objectives/${row.objective.id}#kr-${row.keyResult.id}`}
                className="text-ink underline"
              >
                {row.keyResult.statement}
              </Link>{' '}
              — {row.divergence.findings.map((finding) => finding.reading).join(' ')}
            </p>
          ))}
        </div>
      ) : null}

      <p className="max-w-prose text-xs text-ink-muted">
        Progress is set on the objective pages, where both numbers sit side by side. They are never
        averaged — where they disagree, that disagreement is the finding (ADR-0013).
      </p>
    </PanelCard>
  );
}

async function OrphansPanel() {
  const [objectives, inFlight] = await Promise.all([
    apiFetch({
      path: '/objectives',
      query: { limit: String(LIMIT) },
      schema: objectivePageSchema,
    }),
    apiFetch({
      path: '/backlog',
      query: { status: 'now,next,waiting,review', limit: String(LIMIT) },
      schema: backlogSchema,
    }),
  ]);

  if (!objectives.ok) return <ApiFailureState failure={objectives} surface="the objectives" />;

  const active = objectives.data.items.filter((objective) => objective.status === 'active');
  const orphanedObjectives = orphanObjectives(active);
  const served = servedInitiativeIds(objectives.data.items);
  const candidates: readonly OrphanInitiative[] = (inFlight.ok ? inFlight.data.items : []).map(
    (entry) => ({
      id: entry.initiative.id,
      title: entry.initiative.title,
      areaKey: entry.initiative.areaKey,
      status: entry.initiative.status,
    }),
  );
  const orphanedWork = orphanInitiatives(candidates, served);

  return (
    <PanelCard>
      <StatRow>
        <StatTile label="Objectives with no work" value={String(orphanedObjectives.length)} />
        <StatTile
          label="In-flight work with no objective"
          value={inFlight.ok ? String(orphanedWork.length) : '—'}
        />
      </StatRow>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium text-ink">Objectives nothing serves</h4>
          {orphanedObjectives.length === 0 ? (
            <p className="text-sm text-ink-secondary">None.</p>
          ) : (
            orphanedObjectives.map((objective) => (
              <Link
                key={objective.id}
                href={`/objectives/${objective.id}`}
                className="text-sm text-ink hover:underline"
              >
                {objective.title}
              </Link>
            ))
          )}
        </div>

        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium text-ink">Work serving no objective</h4>
          {!inFlight.ok ? (
            <p className="text-sm text-ink-secondary">The backlog could not be read.</p>
          ) : orphanedWork.length === 0 ? (
            <p className="text-sm text-ink-secondary">None.</p>
          ) : (
            orphanedWork.slice(0, 15).map((initiative) => (
              <Link
                key={initiative.id}
                href={`/initiative/${initiative.id}`}
                className="text-sm text-ink hover:underline"
              >
                {initiative.title}
              </Link>
            ))
          )}
        </div>
      </div>

      <p className="max-w-prose text-xs text-ink-muted">
        Neither direction is automatically wrong. Upkeep, a favour and an outside deadline are all
        legitimately unattached; an objective authored this morning has nothing behind it yet. The
        question is whether any of them surprises you.
      </p>
    </PanelCard>
  );
}

async function AuthorObjectivesPanel() {
  const objectives = await apiFetch({
    path: '/objectives',
    query: { limit: String(LIMIT) },
    schema: objectivePageSchema,
  });
  if (!objectives.ok) return <ApiFailureState failure={objectives} surface="the objectives" />;

  const drafts = objectives.data.items.filter((objective) => objective.status === 'draft');
  const unmeasured = objectives.data.items.filter(
    (objective) => objective.status !== 'draft' && objective.keyResults.length === 0,
  );

  return (
    <PanelCard>
      <StatRow>
        <StatTile label="Objectives in draft" value={String(drafts.length)} />
        <StatTile label="Active with no key result" value={String(unmeasured.length)} />
      </StatRow>

      {unmeasured.length > 0 ? (
        <p className="max-w-prose text-sm text-ink-secondary">
          {String(unmeasured.length)}{' '}
          {unmeasured.length === 1 ? 'objective has' : 'objectives have'} no key result, so nothing
          measures {unmeasured.length === 1 ? 'it' : 'them'}. That is the one thing worth fixing
          before the period starts.
        </p>
      ) : null}

      <p className="max-w-prose text-xs text-ink-muted">
        A key result measured in a rate is a habit and belongs in the Ritual lane instead — that
        distinction is made here or not at all (ADR-0012). The authoring form is on the objectives
        screen.
      </p>

      <Button asChild size="sm" variant="secondary" className="self-start">
        <Link href="/objectives">Author on the objectives screen</Link>
      </Button>
    </PanelCard>
  );
}

async function ReplanPanel() {
  const timeline = await apiFetch({ path: '/timeline', schema: timelineSchema });
  if (!timeline.ok) return <ApiFailureState failure={timeline} surface="the schedule" />;

  const { criticalPath, infeasibleDeadlines, minSlackDays, danglingRefs } = timeline.data;

  return (
    <PanelCard>
      <StatRow>
        <StatTile label="On the critical path" value={String(criticalPath.length)} />
        <StatTile label="Infeasible deadlines" value={String(infeasibleDeadlines.length)} />
        <StatTile label="Minimum slack" value={`${String(minSlackDays)} days`} />
        <StatTile label="Planned initiatives" value={String(timeline.data.initiatives.length)} />
      </StatRow>

      {timeline.data.weightsStale ? (
        <p className="text-sm text-status-warning">
          The per-area slot limits come from {String(timeline.data.weightYear)}&rsquo;s weights,
          which are inherited rather than declared for this year.
        </p>
      ) : null}

      {danglingRefs.length > 0 ? (
        <p className="text-sm text-ink-secondary">
          {String(danglingRefs.length)} dependency{danglingRefs.length === 1 ? '' : ' edges'} point
          outside the plan, so it is optimistic exactly there.
        </p>
      ) : null}

      <p className="max-w-prose text-xs text-ink-muted">
        Moving one initiative moves what depends on it. A move is a request — a dependency or a full
        area can refuse the day, and the Timeline says so rather than drawing the bar somewhere
        else.
      </p>

      <Button asChild size="sm" variant="secondary" className="self-start">
        <Link href="/timeline">Open the Timeline</Link>
      </Button>
    </PanelCard>
  );
}

async function AllocatePanel() {
  const areas = await apiFetch({ path: '/areas', schema: areaListSchema });

  return (
    <PanelCard>
      <p className="max-w-prose text-sm text-ink-secondary">
        A weight is fixed for a whole calendar year, and the rigidity is the mechanism rather than a
        limitation (ADR-0007). This is the one decision that can only be taken now, and the Year
        Review is the only surface that writes it — there is deliberately no second place to set a
        weight.
      </p>
      {areas.ok ? (
        <p className="text-xs text-ink-muted">
          {String(areas.data.items.length)} areas exist. The allocation is between the rankable
          ones; Run and Signals are lanes and never carry a share.
        </p>
      ) : null}
      <Button asChild size="sm" className="self-start">
        <Link href="/review/year">Open the Year Review</Link>
      </Button>
    </PanelCard>
  );
}

/**
 * A step whose panel this build does not know.
 *
 * Reachable only through a session carrying a step id from another build or
 * from an instance's own checklist. It renders as a step that can still be
 * ticked rather than as an error, because the alternative is a review somebody
 * cannot finish.
 */
function UnknownPanel({ panel, cadence }: { panel: string; cadence: ReviewCadence }) {
  return (
    <PanelCard>
      <p className="max-w-prose text-sm text-ink-secondary">
        This {cadence} review carries a step this build has no panel for ({panel}). It is kept and
        can still be ticked — a step recorded by another build is not corrupt, and dropping it would
        delete somebody&rsquo;s record of having done the work.
      </p>
    </PanelCard>
  );
}
