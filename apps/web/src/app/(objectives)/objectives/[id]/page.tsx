import {
  AreaBadge,
  Badge,
  Button,
  Card,
  EmptyState,
  LineChart,
  Section,
  StatRow,
  StatTile,
} from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  areaListSchema,
  backlogSchema,
  initiativeSchema,
  measurementListSchema,
  objectiveSchema,
  type Initiative,
  type KeyResult,
  type Measurement,
} from '@/lib/contracts';
import { elapsedPctOf, objectiveProgress } from '@/lib/objectives-view';
import { AddKeyResultForm } from './add-key-result-form';
import { MeasurementForm } from './measurement-form';
import { ServedByEditor } from './served-by-editor';
import { ProgressPair } from '../progress-pair';
import { ObjectiveStatusMenu } from './status-menu';

const PAGE_LIMIT = 200;

/** The statuses the link editor offers. Done and dropped work cannot start serving anything new. */
const LINKABLE = 'inbox,later,next,now,waiting,review';

/**
 * One objective, in the detail the monthly review needs.
 *
 * ## The measurement series is a trend, not a number
 *
 * ADR-0012 makes a key result first-class precisely so it can carry a series.
 * A single current value cannot answer the question the review actually asks —
 * *is this moving* — and a value that can be edited answers it dishonestly.
 * The series is append-only end to end: there is no endpoint that edits or
 * removes a measurement, and this screen offers no affordance implying there
 * is.
 *
 * ## Why the breakdown shown is the serving initiatives'
 *
 * The brief asks for the anchor task and its subtasks. The API exposes tasks
 * per *initiative* (`/initiatives/:id/tasks`) and there is no endpoint that
 * returns the breakdown beneath a key result's anchor — so what is shown is
 * the rollup of every initiative in `servedBy`, which is the same work
 * approached from the side the API models. Where a key result has an anchor
 * but nothing serving it, that is stated rather than papered over: it is the
 * case where `progressComputed` exists and this screen cannot explain it.
 *
 * Task *titles* are never rendered, because the API does not return them — the
 * task DTO carries ids, completion and timing only. That is deliberate
 * upstream and convenient here.
 */
export default async function ObjectivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);

  const objective = await apiFetch({
    path: `/objectives/${encodeURIComponent(id)}`,
    schema: objectiveSchema,
  });

  if (!objective.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={objective} surface="this objective" />
      </div>
    );
  }

  const data = objective.data;
  const elapsedPct = elapsedPctOf(data.period, today);
  const rollup = objectiveProgress(data);

  const [areas, linkable, ...series] = await Promise.all([
    apiFetch({ path: '/areas', schema: areaListSchema }),
    apiFetch({
      path: '/backlog',
      query: { status: LINKABLE, areaKey: data.areaKey, limit: String(PAGE_LIMIT) },
      schema: backlogSchema,
    }),
    ...data.keyResults.map((keyResult) =>
      apiFetch({
        path: `/key-results/${encodeURIComponent(keyResult.id)}/measurements`,
        schema: measurementListSchema,
      }),
    ),
  ]);

  const measurementsOf = (keyResultId: string): readonly Measurement[] | null => {
    const index = data.keyResults.findIndex((keyResult) => keyResult.id === keyResultId);
    const result = series[index];
    if (result === undefined || !result.ok) return null;
    return result.data.items;
  };

  // Every initiative named by any key result, fetched once even when two key
  // results share one.
  const servedIds = [...new Set(data.keyResults.flatMap((keyResult) => keyResult.servedBy))];
  const servingResults = await Promise.all(
    servedIds.map(async (initiativeId) => {
      const result = await apiFetch({
        path: `/initiatives/${encodeURIComponent(initiativeId)}`,
        schema: initiativeSchema,
      });
      return result.ok ? ([initiativeId, result.data] as const) : null;
    }),
  );
  const serving = new Map<string, Initiative>(
    servingResults.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );

  const areaNames = new Map(
    (areas.ok ? areas.data.items : []).map((area) => [area.key, area.name]),
  );

  return (
    <div className="flex flex-col gap-8">
      <Header />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink">{data.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <AreaBadge areaKey={data.areaKey} name={areaNames.get(data.areaKey) ?? data.areaKey} />
            <Badge variant={data.status === 'active' ? 'accent' : 'neutral'}>{data.status}</Badge>
            <span className="text-xs text-ink-muted">
              {data.type === 'annual' ? 'Annual' : 'Monthly'} · {data.period} ·{' '}
              {elapsedPct >= 100 ? 'period over' : `${elapsedPct.toFixed(0)}% gone`}
            </span>
          </div>
        </div>

        <ObjectiveStatusMenu objectiveId={data.id} status={data.status} />
      </div>

      <StatRow>
        <StatTile label="Key results" value={String(rollup.keyResultCount)} />
        <StatTile
          label="Mean self-assessed"
          value={rollup.selfPct === null ? '—' : `${rollup.selfPct.toFixed(0)}%`}
        />
        <StatTile
          label="Mean computed"
          value={rollup.computedPct === null ? '—' : `${rollup.computedPct.toFixed(0)}%`}
        />
        <StatTile
          label="Computed from"
          value={`${String(rollup.computedFrom)} of ${String(rollup.keyResultCount)}`}
        />
      </StatRow>

      {data.keyResults.length === 0 ? (
        <EmptyState
          title="Nothing measures this objective yet"
          description="A key result says how you would know the objective happened. Without one, the objective is an intention — and it will keep appearing in the orphan list until it has at least one."
        />
      ) : (
        data.keyResults.map((keyResult) => (
          <KeyResultPanel
            key={keyResult.id}
            keyResult={keyResult}
            objectiveId={data.id}
            elapsedPct={elapsedPct}
            measurements={measurementsOf(keyResult.id)}
            serving={serving}
            linkable={
              linkable.ok
                ? linkable.data.items.map((entry) => ({
                    id: entry.initiative.id,
                    title: entry.initiative.title,
                    status: entry.initiative.status,
                  }))
                : []
            }
          />
        ))
      )}

      <Section
        title="Add a key result"
        description="How you would know this objective happened. A measure in a rate is usually a habit — that belongs in the Ritual lane rather than here (ADR-0012)."
      >
        <AddKeyResultForm objectiveId={data.id} />
      </Section>
    </div>
  );
}

interface LinkableInitiative {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

function KeyResultPanel({
  keyResult,
  objectiveId,
  elapsedPct,
  measurements,
  serving,
  linkable,
}: {
  keyResult: KeyResult;
  objectiveId: string;
  elapsedPct: number;
  measurements: readonly Measurement[] | null;
  serving: ReadonlyMap<string, Initiative>;
  linkable: readonly LinkableInitiative[];
}) {
  const servingInitiatives = keyResult.servedBy
    .map((initiativeId) => serving.get(initiativeId))
    .filter((initiative): initiative is Initiative => initiative !== undefined);

  return (
    // The list page links to `#kr-<id>`. The anchor is a wrapper rather than a
    // prop on `Section`, which takes none — a one-screen need does not justify
    // widening a shared primitive another three workstreams render.
    <div id={`kr-${keyResult.id}`} className="scroll-mt-20">
      <Section
        title={keyResult.statement}
        description={`Target ${String(keyResult.target)} ${keyResult.unit}.`}
      >
        <div className="flex flex-col gap-4">
          <ProgressPair keyResult={keyResult} objectiveId={objectiveId} elapsedPct={elapsedPct} />

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="flex flex-col gap-3 p-4">
              <h4 className="text-sm font-medium text-ink">Measurement history</h4>
              {measurements === null ? (
                <p className="text-sm text-ink-secondary">The series could not be read.</p>
              ) : measurements.length === 0 ? (
                <p className="text-sm text-ink-secondary">
                  No measurement yet. One number is a status; a series is a trend, which is the
                  thing a review can actually act on.
                </p>
              ) : (
                <>
                  <LineChart
                    title={`Toward ${String(keyResult.target)} ${keyResult.unit}`}
                    subtitle="Every measurement, oldest first. Append-only."
                    labels={measurements.map((measurement) => measurement.observedAt.slice(0, 10))}
                    series={[
                      {
                        label: keyResult.unit,
                        values: measurements.map((measurement) => measurement.value),
                      },
                    ]}
                    formatAs={{ kind: 'number' }}
                  />
                  {measurements.some((measurement) => measurement.note !== null) ? (
                    <ul className="flex flex-col gap-1">
                      {measurements
                        .filter((measurement) => measurement.note !== null)
                        .map((measurement) => (
                          <li key={measurement.observedAt} className="text-xs text-ink-secondary">
                            <span className="tabular-nums text-ink-muted">
                              {measurement.observedAt.slice(0, 10)}
                            </span>{' '}
                            {measurement.note}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </>
              )}
              <MeasurementForm
                keyResultId={keyResult.id}
                objectiveId={objectiveId}
                unit={keyResult.unit}
              />
            </Card>

            <Card className="flex flex-col gap-3 p-4">
              <h4 className="text-sm font-medium text-ink">The work behind it</h4>

              <p className="text-xs text-ink-muted">
                {keyResult.externalAnchorId === null
                  ? 'No anchor task is linked, so nothing computes progress for this key result.'
                  : 'An anchor task is linked. What is computed comes from the tasks beneath it.'}
              </p>

              {servingInitiatives.length === 0 ? (
                <p className="text-sm text-ink-secondary">
                  {keyResult.externalAnchorId === null
                    ? 'Nothing serves this key result. That is the orphan case the monthly review looks for — it is not wrong, but it means no initiative is moving this number.'
                    : 'An anchor is linked but no initiative serves this key result, so the computed number cannot be explained from this screen.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {servingInitiatives.map((initiative) => (
                    <li key={initiative.id} className="flex flex-col gap-0.5">
                      <Link
                        href={`/initiative/${initiative.id}`}
                        className="text-sm text-ink hover:underline"
                      >
                        {initiative.title}
                      </Link>
                      <span className="text-xs text-ink-muted">
                        {initiative.status} ·{' '}
                        {initiative.rollup.totalTaskCount === 0
                          ? 'no tasks beneath it'
                          : `${String(
                              initiative.rollup.totalTaskCount - initiative.rollup.openTaskCount,
                            )} of ${String(initiative.rollup.totalTaskCount)} tasks closed`}
                        {initiative.rollup.progressPct === null
                          ? ''
                          : ` · ${initiative.rollup.progressPct.toFixed(0)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <ServedByEditor
                keyResultId={keyResult.id}
                objectiveId={objectiveId}
                servedBy={keyResult.servedBy}
                choices={linkable}
              />
            </Card>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Header() {
  return (
    <header className="flex flex-col gap-1">
      <Button asChild variant="ghost" size="sm" className="self-start px-0">
        <Link href="/objectives">← All objectives</Link>
      </Button>
    </header>
  );
}
