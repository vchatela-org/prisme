import { Badge, Card, ClearedState, Section, StatRow, StatTile } from '@prisme/ui';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import { creationListSchema } from '@/lib/contracts';
import { ledgerAdvice, summariseLedger } from '@/lib/create-view';
import { RetryButton } from './retry-button';

export const metadata = {
  title: 'Creations · prisme',
  description: 'What prisme has decided should exist outward, and how far it has got.',
};

/**
 * The creation ledger.
 *
 * ## Why this screen exists at all
 *
 * Because multi-tool creation is not atomic and pretending otherwise is the
 * failure this workstream is about. A project is a prisme row, a task-tool
 * project, one section per subtopic and perhaps a page — up to eight writes
 * across three systems with no transaction between them. Something will fail
 * partway through, and when it does the person needs a screen that says
 * *which parts exist*, rather than a workspace they have to go and audit.
 *
 * So the intention is recorded before anything is attempted, and this renders
 * it. A half-created project is a list with two rows made and three pending,
 * not a mystery.
 *
 * ## Three states, and only one of them is a problem
 *
 * `pending` resolves on its own, on the next pass. `satisfied` is done.
 * `failed` is the one worth a person's attention, and it is the only one with
 * a button. Pages are counted apart from `pending` deliberately: they are
 * waiting on a decision rather than on a pass (ADR-0025), and grouping them
 * with things that resolve themselves would make a permanent state look
 * temporary.
 *
 * ## No draft is displayed, because none is sent
 *
 * The API omits it. What the row says is *what kind of thing* is outstanding
 * and for which entity — which is what a reader needs — and never the title
 * or the external location it would be created at (docs/17-privacy.md).
 */

const LIMIT = 100;

export default async function CreationsPage() {
  const ledger = await apiFetch({
    path: '/creations',
    query: { limit: String(LIMIT) },
    schema: creationListSchema,
  });

  if (!ledger.ok) return <ApiFailureState failure={ledger} surface="the creation ledger" />;

  const intents = ledger.data.items;
  const summary = summariseLedger(intents);
  const outstanding = intents.filter((intent) => intent.state !== 'satisfied');

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Creations"
        description="What prisme has decided should exist in the external tools, and how far the converge pass has got. Nothing here is created by the screens that asked for it — the intention is recorded first, so a failure partway through is a row rather than an orphan."
      >
        <StatRow>
          <StatTile label="Queued" value={String(summary.pending)} />
          <StatTile label="Failed" value={String(summary.failed)} />
          {/*
            Counted apart from `Queued` on purpose: a page is waiting on a
            decision rather than on a pass (ADR-0025), and grouping the two
            would make a permanent state look temporary.
          */}
          <StatTile label="Waiting on a decision" value={String(summary.waitingOnADecision)} />
          <StatTile label="Made" value={String(summary.satisfied)} />
        </StatRow>
      </Section>

      <Section title="Outstanding">
        {outstanding.length === 0 ? (
          <ClearedState
            title="Everything prisme intended has been made"
            description="Nothing is queued and nothing failed. A creation flow that has run to completion leaves this screen empty, which is where it should normally be."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {outstanding.map((intent) => {
              const advice = ledgerAdvice(intent);
              return (
                <li key={intent.id}>
                  <Card className="flex flex-wrap items-start gap-3 p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={intent.state === 'failed' ? 'outline' : 'neutral'}>
                        {intent.state}
                      </Badge>
                      <span className="text-sm font-medium text-ink">{intent.objectKind}</span>
                    </div>

                    <div className="flex min-w-60 flex-1 flex-col gap-1">
                      <span className="text-sm text-ink-secondary">
                        for a {intent.entityKind}, in the{' '}
                        {intent.tool === 'task' ? 'task tool' : 'document tool'}
                      </span>
                      <span className="text-xs text-ink-tertiary">{advice.sentence}</span>
                      {intent.lastError !== null ? (
                        /*
                         * prisme's own sentence. `apps/sync` records the
                         * connector's redacted message — tool, operation and
                         * an error *code* — and never the tool's prose, which
                         * quotes the object's own content back.
                         */
                        <span className="text-xs text-status-critical">{intent.lastError}</span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-3">
                      {intent.attempts > 0 ? (
                        <span className="text-xs tabular-nums text-ink-tertiary">
                          {String(intent.attempts)} attempt{intent.attempts === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {advice.retryable ? <RetryButton id={intent.id} /> : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
