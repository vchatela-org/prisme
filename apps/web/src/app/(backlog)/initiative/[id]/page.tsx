import { AreaBadge, Badge, Card, EmptyState, ScorePill, Section } from '@prisme/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageButton } from '@/app/(create)/page-button';
import { ApiFailureState } from '@/components/api-failure';
import { EstimateEditor } from '@/components/estimate-editor';
import { StatusMenu } from '@/components/status-menu';
import { DependencyEditor } from './dependency-editor';
import { apiFetch } from '@/lib/api';
import {
  areaListSchema,
  backlogSchema,
  creationListSchema,
  eventPageSchema,
  focusSchema,
  initiativeSchema,
  scoreHistorySchema,
  taskListSchema,
  type Area,
} from '@/lib/contracts';
import { pageStateOf } from '@/lib/create-view';
import { dayOf, daysSince, dueSummary } from '@/lib/focus-view';
import { countsFrom } from '@/lib/guardrails';
import { pageUrl } from '@/lib/page-link';
import { webRuntime } from '@/lib/runtime';

/**
 * One initiative, with everything that was decided about it.
 *
 * This is the screen a ranking sends somebody to when it surprises them, so it
 * is arranged around being argued with: the score with its factors and its
 * history, the dependencies that hold it back, the task subtree it is measured
 * by, and the log of every status and score change.
 *
 * Three things on this page are deliberately read-only, and each says so rather
 * than simply omitting the field. `plannedStart` and `plannedEnd` belong to the
 * schedule engine; `due` on a task belongs to the task tool; `origin` is a fact
 * about how the initiative arrived. A field with an editor beside it is a claim
 * about who owns it (docs/11-ownership.md).
 */
export default async function InitiativePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [initiative, tasks, scores, areas, focus, events, creations, others] = await Promise.all([
    apiFetch({ path: `/initiatives/${encodeURIComponent(id)}`, schema: initiativeSchema }),
    apiFetch({ path: `/initiatives/${encodeURIComponent(id)}/tasks`, schema: taskListSchema }),
    apiFetch({ path: `/initiatives/${encodeURIComponent(id)}/scores`, schema: scoreHistorySchema }),
    apiFetch({ path: '/areas', schema: areaListSchema }),
    apiFetch({ path: '/focus', schema: focusSchema }),
    apiFetch({
      path: '/events',
      query: { entityKind: 'initiative', entityId: id, limit: '20' },
      schema: eventPageSchema,
    }),
    // W15: whether a page has been *asked for* and not yet made. Without it
    // the button would read `external_page_id IS NULL` as "no page" and offer
    // to create a second — creating is no longer synchronous, which is a
    // state ADR-0011's two-state rule predates.
    apiFetch({
      path: '/creations',
      query: { entityId: id, limit: '20' },
      schema: creationListSchema,
    }),
    // Every other initiative, by title — what a dependency is chosen from and
    // named by. Sorted by title because this is a picker, not a ranking.
    apiFetch({
      path: '/backlog',
      query: { limit: '200', sort: 'title' },
      schema: backlogSchema,
    }),
  ]);

  if (!initiative.ok) {
    if (initiative.kind === 'not_found') notFound();
    return <ApiFailureState failure={initiative} surface="this initiative" />;
  }

  const data = initiative.data;
  const areaList: readonly Area[] = areas.ok ? areas.data.items : [];
  const area = areaList.find((candidate) => candidate.key === data.areaKey);
  const method =
    data.score === null ? undefined : `${data.score.methodId} v${String(data.score.methodVersion)}`;

  const counts = focus.ok
    ? countsFrom(
        focus.data.slotsByArea,
        data.areaKey,
        area?.name ?? data.areaKey,
        focus.data.limits,
        focus.data.now.length,
      )
    : undefined;

  // What a dependency can be: any other initiative still open. A finished one
  // blocks nothing, so offering it would be offering a no-op.
  const allOthers = others.ok ? others.data.items.map((entry) => entry.initiative) : [];
  const titleOf = new Map(allOthers.map((other) => [other.id, other.title]));
  const candidates = allOthers
    .filter(
      (other) =>
        other.id !== data.id &&
        (data.dependsOn.includes(other.id) ||
          (other.status !== 'done' && other.status !== 'dropped')),
    )
    .map((other) => ({ id: other.id, title: other.title, status: other.status }));

  const due = tasks.ok ? dueSummary(tasks.data.items, dayOf(data.updatedAt)) : undefined;
  const idleDays = daysSince(data.rollup.lastActivity, new Date(data.updatedAt));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-muted">
          <Link href="/backlog" className="hover:underline">
            Backlog
          </Link>
          <span aria-hidden> / </span>
          <span>{data.title}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-semibold text-ink">{data.title}</h1>
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary">
              <AreaBadge
                areaKey={data.areaKey}
                name={area?.name ?? data.areaKey}
                kind={area?.kind ?? 'area'}
                size="sm"
              />
              <Badge variant="outline">
                {data.origin === 'adopted' ? 'Adopted from existing work' : 'Created in prisme'}
              </Badge>
              {data.sizedForNow ? null : <Badge variant="outline">Larger than a now slot</Badge>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {data.score === null ? null : (
              <ScorePill
                score={data.score.value}
                explain={data.score.explain}
                factors={data.score.factors}
                {...(method === undefined ? {} : { method })}
                stale={focus.ok ? focus.data.weightsStale : false}
              />
            )}
            <StatusMenu initiative={data} {...(counts === undefined ? {} : { counts })} size="md" />
          </div>
        </div>
      </header>

      <Section
        title="Estimates"
        description="The four inputs the active method reads. Change one and the ranking is recomputed by prisme — never here."
      >
        <EstimateEditor initiative={data} variant="panel" />
      </Section>

      <Section
        title="Dates"
        description="prisme writes a deadline, which is a constraint. It never writes a due date, which is a plan — that belongs to the task tool (ADR-0003)."
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Deadline" value={data.deadline} hint="A hard external constraint." />
          <Field
            label="Earliest start"
            value={data.earliestStart}
            hint="Nothing can be scheduled before this."
          />
          <Field
            label="Planned start"
            value={data.plannedStart}
            hint="Computed by the schedule engine. Read-only everywhere."
          />
          <Field
            label="Planned end"
            value={data.plannedEnd}
            hint="Computed by the schedule engine. Read-only everywhere."
          />
        </dl>
      </Section>

      <Section title="Score" description="How the number was reached, and how it has moved.">
        {data.score === null ? (
          <EmptyState
            title="No ranking has been stored yet"
            description="The backlog recomputes a ranking on every read; history is written only when a re-score is run deliberately, which is the weekly review's step."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-3 p-4">
              <p className="text-sm text-ink">{data.score.explain}</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-border-hairline pt-3">
                {Object.entries(data.score.factors).map(([name, value]) => (
                  <div key={name} className="contents">
                    <dt className="text-xs text-ink-secondary">{name}</dt>
                    <dd className="text-right text-xs text-ink tabular-nums">{value.toFixed(2)}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-ink-muted">
                {method} · computed {data.score.computedAt.slice(0, 16).replace('T', ' ')}
              </p>
            </Card>

            {scores.ok && scores.data.items.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {scores.data.items.map((score) => (
                  <li
                    key={`${score.computedAt}-${String(score.value)}`}
                    className="flex items-center justify-between gap-3 text-xs text-ink-secondary"
                  >
                    <span>{score.computedAt.slice(0, 10)}</span>
                    <span className="tabular-nums">{score.value.toFixed(2)}</span>
                    <span className="text-ink-muted">
                      {score.methodId} v{score.methodVersion}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </Section>

      <Section
        title="Dependencies"
        description="What it waits on. A dependency that is neither done nor dropped blocks it."
      >
        {data.dependsOn.length === 0 ? (
          <p className="text-sm text-ink-secondary">It waits on nothing.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.dependsOn.map((dependency) => (
              <li key={dependency} className="flex items-center gap-2 text-sm">
                <Link href={`/initiative/${dependency}`} className="text-ink hover:underline">
                  {titleOf.get(dependency) ?? dependency}
                </Link>
                {data.blockedBy.includes(dependency) ? (
                  <Badge variant="outline" className="text-status-warning">
                    Blocking
                  </Badge>
                ) : (
                  <Badge variant="outline">Cleared</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        <DependencyEditor id={data.id} current={data.dependsOn} candidates={candidates} />
      </Section>

      <Section
        title="Tasks"
        description="The mirrored anchor subtree. prisme counts it and never edits it — every field here belongs to the task tool."
      >
        {!tasks.ok || tasks.data.items.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            No tasks are mirrored under this initiative yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="neutral">
                {data.rollup.openTaskCount} open of {data.rollup.totalTaskCount}
              </Badge>
              {due === undefined || due.dueToday === 0 ? null : (
                <Badge variant="neutral">{due.dueToday} due today</Badge>
              )}
              {due === undefined || due.overdue === 0 ? null : (
                <Badge variant="outline" className="text-status-warning">
                  {due.overdue} past their due date
                </Badge>
              )}
              {idleDays === null ? null : (
                <Badge variant="neutral">Last activity {idleDays} days ago</Badge>
              )}
            </div>
            {/*
              Counts and dates, never titles: a mirrored task carries no text on
              this side at all. The words are in the task tool, which is also
              where they are edited.
            */}
            <p className="text-xs text-ink-muted">
              Task titles live in the task tool. prisme mirrors the structure, the state and the
              dates.
            </p>
          </div>
        )}
      </Section>

      <Section
        title="Narrative page"
        description="A page is optional and created on demand, so a page existing means something was written in it (ADR-0011)."
      >
        <PageButton
          initiativeId={data.id}
          state={pageStateOf(data.externalPageId, creations.ok ? creations.data.items : [])}
          // `undefined` until the instance supplies a template, and `undefined`
          // again if the identifier cannot be turned into a link on that
          // template's own origin. The button says which state it is in.
          href={pageUrl(webRuntime().config.doctoolPageUrlTemplate, data.externalPageId)}
        />
      </Section>

      <Section
        title="Activity"
        description="The event log for this initiative — append-only, and the same rows the KPIs are computed from."
      >
        {!events.ok || events.data.items.length === 0 ? (
          <p className="text-sm text-ink-secondary">Nothing has been recorded against it yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.data.items.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-xs text-ink-muted tabular-nums">
                  {event.occurredAt.slice(0, 10)}
                </span>
                <span className="text-ink">{event.kind.replace('_', ' ')}</span>
                {event.field === null ? null : (
                  <span className="text-ink-secondary">{event.field}</span>
                )}
                <Badge variant="outline">{event.actor}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string | null; hint: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-ink-secondary">{label}</dt>
      <dd className="text-sm text-ink tabular-nums">{value ?? '—'}</dd>
      <p className="text-xs text-ink-muted">{hint}</p>
    </div>
  );
}
