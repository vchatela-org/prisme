import { Badge, Button, Card, EmptyState } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { areaListSchema, reviewSessionPageSchema } from '@/lib/contracts';
import { artefactFor, CADENCE_LABELS, progressOf, stepsFor } from '@/lib/review-wizard';

export const metadata = {
  title: 'Review history · prisme',
  description: 'Past sessions, what changed at each, and the capacity snapshot at that moment.',
};

/**
 * Past reviews.
 *
 * ## The artefact is generated, not stored as prose
 *
 * Each session's artefact is rendered from the session itself, so it cannot
 * drift from what was recorded. It carries the three things nobody can
 * reconstruct afterwards: the decisions in the words they were made in, which
 * steps were **not** covered, and the per-area capacity as it stood when the
 * session closed.
 *
 * The second of those is the one usually missing from a review record. A
 * review that looked at the deadlines and found nothing, and one that never
 * got to them, read identically a month later unless somebody wrote down which
 * happened.
 *
 * ## Nothing here is committed to this repository
 *
 * The artefact contains whatever the instance wrote, which is real goals and
 * real decisions. It is rendered at request time and no build step calls this
 * (docs/17-privacy.md).
 */
export default async function ReviewHistoryPage() {
  const [sessions, areas] = await Promise.all([
    apiFetch({
      path: '/reviews',
      query: { limit: '50' },
      schema: reviewSessionPageSchema,
    }),
    apiFetch({ path: '/areas', schema: areaListSchema }),
  ]);

  if (!sessions.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={sessions} surface="the review history" />
      </div>
    );
  }

  const areaNames = Object.fromEntries(
    (areas.ok ? areas.data.items : []).map((area) => [area.key, area.name]),
  );

  const closed = sessions.data.items.filter((session) => session.completedAt !== null);

  return (
    <div className="flex flex-col gap-6">
      <Header />

      {closed.length === 0 ? (
        <EmptyState
          title="No review has been closed yet"
          description="A closed session keeps its decisions, which steps it covered, and the per-area capacity at the moment it closed — a snapshot that is never retaken."
        />
      ) : (
        closed.map((session) => {
          const steps = stepsFor(session.cadence);
          const progress = progressOf(steps, session.checklist);
          const snapshot = Object.entries(session.capacitySnapshot).sort(([left], [right]) =>
            left.localeCompare(right),
          );

          return (
            <Card key={session.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-medium text-ink">
                    {CADENCE_LABELS[session.cadence]} review
                  </h2>
                  <Badge variant="outline">{session.completedAt?.slice(0, 10)}</Badge>
                </div>
                <span className="text-xs text-ink-muted">
                  {String(progress.done)} of {String(progress.total)} steps covered ·{' '}
                  {String(session.decisions.length)} decision
                  {session.decisions.length === 1 ? '' : 's'}
                </span>
              </div>

              {session.decisions.length === 0 ? (
                <p className="text-sm text-ink-secondary">
                  No decision was recorded. Either nothing needed to change, or the review did not
                  get far enough to say — and those are different.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {session.decisions.map((decision, position) => (
                    <li
                      key={`${String(position)}-${decision.slice(0, 24)}`}
                      className="text-sm text-ink"
                    >
                      {decision}
                    </li>
                  ))}
                </ul>
              )}

              {progress.done < progress.total ? (
                <p className="text-xs text-ink-muted">
                  Not covered:{' '}
                  {steps
                    .filter((step) => session.checklist[step.id] !== true)
                    .map((step) => step.title)
                    .join(', ')}
                  .
                </p>
              ) : null}

              {snapshot.length > 0 ? (
                <div className="flex flex-wrap gap-3 border-t border-border-hairline pt-2">
                  {snapshot.map(([areaKey, sharePct]) => (
                    <span key={areaKey} className="text-xs text-ink-muted tabular-nums">
                      {areaNames[areaKey] ?? areaKey}: {sharePct.toFixed(1)}%
                    </span>
                  ))}
                </div>
              ) : null}

              <details>
                <summary className="cursor-pointer text-sm text-ink-secondary">
                  The written artefact
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-surface-page p-3 text-xs whitespace-pre-wrap text-ink-secondary">
                  {artefactFor({ session, steps, areaNames })}
                </pre>
              </details>
            </Card>
          );
        })
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Review history</h1>
        <p className="text-sm text-ink-secondary">
          What changed at each review, and what the numbers looked like when it was decided.
        </p>
      </div>
      <Button asChild variant="ghost" size="sm">
        <Link href="/review">Back to reviews</Link>
      </Button>
    </header>
  );
}
