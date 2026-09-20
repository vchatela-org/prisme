import { Badge, Button, Card, EmptyState, Section } from '@prisme/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  areaListSchema,
  REVIEW_CADENCES,
  reviewSessionPageSchema,
  type ReviewCadence,
} from '@/lib/contracts';
import {
  artefactFor,
  CADENCE_LABELS,
  progressOf,
  stepIndexFrom,
  stepsFor,
  unknownStepIds,
  windowDaysFor,
} from '@/lib/review-wizard';
import { DecisionRecorder } from '../decision-recorder';
import { OpenReviewButton } from '../open-review-button';
import { StepControl } from '../step-control';
import { StepPanel } from '../step-panel';

export async function generateMetadata({ params }: { params: Promise<{ cadence: string }> }) {
  const { cadence } = await params;
  const label = CADENCE_LABELS[cadence as ReviewCadence] ?? 'Review';
  return {
    title: `${label} review · prisme`,
    description: 'The ritual, one step at a time, with the data each step is about.',
  };
}

function isCadence(value: string): value is ReviewCadence {
  return (REVIEW_CADENCES as readonly string[]).includes(value);
}

/**
 * The review wizard — the highest-value screen in prisme.
 *
 * ## One step at a time, and each step brings its own data
 *
 * A checklist that merely shows steps is no better than the paper version; the
 * whole benefit is not having to go and look. So the step's panel is the data
 * the step is about, fetched here, and the link beside it goes to the surface
 * that owns the decision when it needs more room. That link is a link and
 * never a redirect — a review that sends you away loses its place, which is
 * the failure resumability exists to prevent.
 *
 * ## Resuming is the default, not a feature
 *
 * The step comes from the query string, so a review can be linked to and
 * reloaded into the same place; when it is absent or nonsense, the wizard
 * lands on the **first unticked step**. Not the furthest reached: somebody who
 * ticked 1, 2 and 4 and closed the tab is returned to 3, because 3 is the one
 * they did not do, and landing them on 5 would let the artefact claim ground
 * the review never covered.
 *
 * ## Decisions are recorded as they are made
 *
 * The recorder is on every step, not only the last one. A decision retyped at
 * the end is a decision half-remembered, and the words it was originally made
 * in are the thing worth reading a month later.
 *
 * ## Closing is deliberate
 *
 * Ticking the last step does not close the session. Closing takes the
 * per-area capacity snapshot and the API never retakes it, so it happens when
 * somebody says the review is over rather than when a checkbox goes green.
 */
export default async function ReviewCadencePage({
  params,
  searchParams,
}: {
  params: Promise<{ cadence: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cadence } = await params;
  if (!isCadence(cadence)) notFound();

  const query = await searchParams;
  const rawStep = typeof query['step'] === 'string' ? query['step'] : undefined;

  const sessions = await apiFetch({
    path: '/reviews',
    query: { cadence, limit: '20' },
    schema: reviewSessionPageSchema,
  });

  if (!sessions.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header cadence={cadence} />
        <ApiFailureState failure={sessions} surface="this review" />
      </div>
    );
  }

  const steps = stepsFor(cadence);
  const open = sessions.data.items.find((session) => session.completedAt === null);

  if (open === undefined) {
    const last = sessions.data.items[0];
    return (
      <div className="flex flex-col gap-6">
        <Header cadence={cadence} />
        <EmptyState
          title={`No ${cadence} review is open`}
          description={
            last === undefined
              ? `This is the first ${cadence} review. It has ${String(steps.length)} steps, each bringing the data it is about — nothing needs looking up elsewhere.`
              : `The last one closed ${last.completedAt?.slice(0, 10) ?? ''}. Opening a new one starts from an empty checklist; the closed session keeps its own snapshot.`
          }
        />
        <div className="flex gap-2">
          <OpenReviewButton cadence={cadence} />
          <Button asChild variant="ghost">
            <Link href="/review/history">Past reviews</Link>
          </Button>
        </div>
      </div>
    );
  }

  const progress = progressOf(steps, open.checklist);
  const index = stepIndexFrom(rawStep, steps, progress.resumeIndex);
  const step = steps[index];
  if (step === undefined) notFound();

  const unknown = unknownStepIds(steps, open.checklist);
  const areas = await apiFetch({ path: '/areas', schema: areaListSchema });
  const areaNames = Object.fromEntries(
    (areas.ok ? areas.data.items : []).map((area) => [area.key, area.name]),
  );

  const stepHref = (target: number): string => `/review/${cadence}?step=${String(target)}`;

  return (
    <div className="flex flex-col gap-6">
      <Header cadence={cadence} />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-ink">
            {String(progress.done)} of {String(progress.total)} steps done
          </span>
          <span className="text-xs text-ink-muted">
            Opened {open.startedAt.slice(0, 10)} · looking back {String(windowDaysFor(cadence))}{' '}
            days · leaving this page loses nothing
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/review/history">History</Link>
          </Button>
        </div>
      </Card>

      {/* The rail: every step, its state, and a way to any of them. A wizard
          that only goes forward makes a reader who remembers something two
          steps back start again. */}
      <nav aria-label="Review steps" className="flex flex-wrap gap-1">
        {steps.map((candidate, position) => {
          const done = open.checklist[candidate.id] === true;
          const current = position === index;
          return (
            <Button
              key={candidate.id}
              asChild
              size="sm"
              variant={current ? 'primary' : done ? 'secondary' : 'ghost'}
            >
              <Link href={stepHref(position)} aria-current={current ? 'step' : undefined}>
                <span aria-hidden>{done ? '✓' : String(position + 1)}</span>
                <span className="sr-only">
                  Step {String(position + 1)}, {done ? 'done' : 'not done'}:
                </span>{' '}
                {candidate.title}
              </Link>
            </Button>
          );
        })}
      </nav>

      <Section
        title={step.title}
        description={step.prompt}
        actions={
          step.surface === null ? null : (
            <Button asChild variant="ghost" size="sm">
              <Link href={step.surface}>Open the full surface</Link>
            </Button>
          )
        }
      >
        <StepPanel panel={step.panel} cadence={cadence} />

        {step.panel === 'decisions' ? (
          <Card className="flex flex-col gap-4 p-4">
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium text-ink">
                Recorded this session ({String(open.decisions.length)})
              </h4>
              {open.decisions.length === 0 ? (
                <p className="text-sm text-ink-secondary">
                  Nothing recorded yet. A review with no decisions is worth noticing: either nothing
                  needed to change, or the review did not get far enough to say.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {open.decisions.map((decision, position) => (
                    <li
                      key={`${String(position)}-${decision.slice(0, 24)}`}
                      className="text-sm text-ink"
                    >
                      {decision}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <details className="flex flex-col gap-2">
              <summary className="cursor-pointer text-sm text-ink-secondary">
                Preview the artefact this will produce
              </summary>
              <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-surface-page p-3 text-xs text-ink-secondary whitespace-pre-wrap">
                {artefactFor({ session: open, steps, areaNames })}
              </pre>
            </details>
          </Card>
        ) : null}

        <DecisionRecorder
          reviewId={open.id}
          cadence={cadence}
          canClose={step.panel === 'decisions'}
          remaining={progress.total - progress.done}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <StepControl
            reviewId={open.id}
            cadence={cadence}
            stepId={step.id}
            done={open.checklist[step.id] === true}
            nextHref={index + 1 < steps.length ? stepHref(index + 1) : null}
          />

          <div className="flex gap-2">
            {index > 0 ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={stepHref(index - 1)}>← Previous</Link>
              </Button>
            ) : null}
            {index + 1 < steps.length ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={stepHref(index + 1)}>Skip for now →</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </Section>

      {unknown.length > 0 ? (
        <Card className="flex flex-col gap-2 p-4">
          <h4 className="text-sm font-medium text-ink">
            {String(unknown.length)} step{unknown.length === 1 ? '' : 's'} this build does not know
          </h4>
          <p className="max-w-prose text-sm text-ink-secondary">
            This session carries checklist entries with no step in this build:{' '}
            <span className="text-ink">{unknown.join(', ')}</span>. They are kept and written back
            untouched — an instance that added a step of its own, or a session written by an older
            build, is not corrupt, and silently dropping them would delete a record of work somebody
            did.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function Header({ cadence }: { cadence: ReviewCadence }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">{CADENCE_LABELS[cadence]} review</h1>
        <p className="text-sm text-ink-secondary">
          The ritual, one step at a time, with the data each step is about.
        </p>
      </div>
      <Badge variant="outline">{cadence}</Badge>
    </header>
  );
}
