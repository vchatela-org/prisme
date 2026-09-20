import { Badge, Button, Card, EmptyState, Section } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { REVIEW_CADENCES, reviewSessionPageSchema, type ReviewCadence } from '@/lib/contracts';
import { CADENCE_LABELS, progressOf, stepsFor } from '@/lib/review-wizard';
import { OpenReviewButton } from './open-review-button';

export const metadata = {
  title: 'Reviews · prisme',
  description: 'The rituals: weekly, monthly, quarterly and yearly.',
};

/**
 * The review hub.
 *
 * ## An interrupted review is the first thing on the screen
 *
 * Reviews get interrupted, and losing one twice means it stops happening. So
 * anything open is at the top, with how far it got and a link that resumes at
 * the first step it did not do — not at the beginning, and not at the furthest
 * step reached.
 *
 * ## The cadences are listed, not nested
 *
 * A monthly review is not four weeklies and the quarterly is not three
 * monthlies. Each is its own ritual with its own steps, and the separation is
 * the point: a monthly that re-triages the inbox becomes a weekly, and the
 * allocation question — the one no other tool asks — is what gets dropped when
 * the time runs out.
 */
export default async function ReviewHubPage() {
  const sessions = await apiFetch({
    path: '/reviews',
    query: { limit: '50' },
    schema: reviewSessionPageSchema,
  });

  if (!sessions.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={sessions} surface="the reviews" />
      </div>
    );
  }

  const openSessions = sessions.data.items.filter((session) => session.completedAt === null);
  const lastByCadence = new Map<ReviewCadence, string>();
  for (const session of sessions.data.items) {
    if (session.completedAt !== null && !lastByCadence.has(session.cadence)) {
      lastByCadence.set(session.cadence, session.completedAt);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Header />

      <Section
        title="In progress"
        description="A review interrupted halfway is not lost. Resuming lands on the first step you did not do."
      >
        {openSessions.length === 0 ? (
          <EmptyState
            title="Nothing is open"
            description="Start whichever ritual is due below. Each brings its own data to every step, so nothing needs looking up elsewhere."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {openSessions.map((session) => {
              const steps = stepsFor(session.cadence);
              const progress = progressOf(steps, session.checklist);
              const resumeStep = steps[progress.resumeIndex];

              return (
                <Card
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-ink">
                      {CADENCE_LABELS[session.cadence]} review
                    </span>
                    <span className="text-xs text-ink-muted">
                      Opened {session.startedAt.slice(0, 10)} · {String(progress.done)} of{' '}
                      {String(progress.total)} steps
                      {resumeStep === undefined ? '' : ` · next: ${resumeStep.title}`}
                    </span>
                    {session.decisions.length > 0 ? (
                      <span className="text-xs text-ink-muted">
                        {String(session.decisions.length)} decision
                        {session.decisions.length === 1 ? '' : 's'} recorded so far
                      </span>
                    ) : null}
                  </div>
                  <Button asChild>
                    <Link href={`/review/${session.cadence}`}>Resume</Link>
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="The rituals"
        description="Each is its own ritual with its own steps. A monthly review is not four weeklies."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {REVIEW_CADENCES.map((cadence) => {
            const steps = stepsFor(cadence);
            const openHere = openSessions.some((session) => session.cadence === cadence);
            const last = lastByCadence.get(cadence);

            return (
              <Card key={cadence} className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink">{CADENCE_LABELS[cadence]}</h3>
                  <Badge variant="outline">{String(steps.length)} steps</Badge>
                </div>
                <p className="text-xs text-ink-muted">
                  {last === undefined
                    ? 'Never run in prisme.'
                    : `Last closed ${last.slice(0, 10)}.`}
                </p>
                <ol className="flex flex-col gap-0.5">
                  {steps.map((step) => (
                    <li key={step.id} className="text-xs text-ink-secondary">
                      {step.title}
                    </li>
                  ))}
                </ol>
                {openHere ? (
                  <Button asChild variant="secondary" className="self-start">
                    <Link href={`/review/${cadence}`}>Resume</Link>
                  </Button>
                ) : (
                  <OpenReviewButton cadence={cadence} variant="secondary" />
                )}
              </Card>
            );
          })}
        </div>
      </Section>

      <Section
        title="Past reviews"
        description="What changed at each, and the capacity snapshot taken at that moment."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/review/history">Open the history</Link>
          </Button>
        }
      >
        <p className="max-w-prose text-sm text-ink-secondary">
          {String(sessions.data.total)} session{sessions.data.total === 1 ? '' : 's'} recorded. Each
          keeps the decisions in the words they were made in, which steps were covered, which were
          not, and the per-area capacity as it stood when it closed.
        </p>
      </Section>
    </div>
  );
}

function Header() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold text-ink">Reviews</h1>
      <p className="text-sm text-ink-secondary">
        Where the decisions are actually made. Automation only removes the copying.
      </p>
    </header>
  );
}
