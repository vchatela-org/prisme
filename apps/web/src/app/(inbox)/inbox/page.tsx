import { AreaBadge, Badge, Card, ClearedState, Section } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { EstimateEditor } from '@/components/estimate-editor';
import { apiFetch } from '@/lib/api';
import { areaListSchema, inboxSchema, type Area } from '@/lib/contracts';
import { PromoteDialog, TriageButtons } from './inbox-actions';

export const metadata = {
  title: 'Inbox · prisme',
  description: 'What arrived and has not been triaged.',
};

/**
 * The inbox: everything that arrived and has not been decided about.
 *
 * Two kinds of thing land here and they are triaged differently.
 *
 * **Initiatives in `inbox`** are already prisme's — they need a status, which
 * is one click: next, later, or dropped with a reason.
 *
 * **Action takeaways** are not prisme's at all. They belong to the document
 * tool, they carry no text on this side, and promoting one *creates* an
 * initiative rather than moving anything. A principle never appears here: it is
 * not a backlog candidate, and it surfaces during the review of its area
 * instead (docs/10-model.md §8).
 *
 * The screen is designed to become empty, so its empty state is a finished
 * queue rather than a first-run explanation.
 */
export default async function InboxPage() {
  const [inbox, areas] = await Promise.all([
    apiFetch({ path: '/inbox', schema: inboxSchema }),
    apiFetch({ path: '/areas', query: { limit: '200' }, schema: areaListSchema }),
  ]);

  if (!inbox.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={inbox} surface="the inbox" />
      </div>
    );
  }

  const areaList: readonly Area[] = areas.ok ? areas.data.items : [];
  const byKey = new Map(areaList.map((area) => [area.key, area]));
  const nameOf = (key: string): string => byKey.get(key)?.name ?? key;

  const { initiatives, takeaways } = inbox.data;
  const total = initiatives.length + takeaways.length;

  return (
    <div className="flex flex-col gap-8">
      <Header
        subtitle={
          total === 0
            ? 'Nothing is waiting.'
            : `${String(total)} waiting — ${String(initiatives.length)} captured, ${String(takeaways.length)} from readings.`
        }
      />

      {total === 0 ? (
        <ClearedState
          title="The inbox is empty"
          description="Captures and action takeaways land here between reviews. Nothing is waiting on a decision right now."
        />
      ) : null}

      {initiatives.length > 0 ? (
        <Section
          title="Captured"
          description="Give each one a status. Next means it is a candidate for a slot; later means it is real but not now."
        >
          <ul className="flex flex-col gap-3">
            {initiatives.map((initiative) => (
              <li key={initiative.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link
                      href={`/initiative/${initiative.id}`}
                      className="truncate text-sm font-medium text-ink hover:underline"
                    >
                      {initiative.title}
                    </Link>
                    <div className="flex items-center gap-3 text-xs text-ink-secondary">
                      <AreaBadge
                        areaKey={initiative.areaKey}
                        name={nameOf(initiative.areaKey)}
                        kind={byKey.get(initiative.areaKey)?.kind ?? 'area'}
                        size="sm"
                      />
                      {initiative.origin === 'adopted' ? (
                        <Badge variant="outline">Adopted</Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <EstimateEditor initiative={initiative} />
                    <TriageButtons initiative={initiative} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {takeaways.length > 0 ? (
        <Section
          title="From readings"
          description="Action takeaways that have not been promoted. Promoting one writes a new initiative; the takeaway itself is left exactly as it is."
        >
          <ul className="flex flex-col gap-3">
            {takeaways.map((takeaway) => (
              <li key={takeaway.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    {/*
                      A takeaway has no text on this side — the words stay in
                      the document tool (docs/11-ownership.md). What is shown
                      is what prisme actually holds: that one exists, what kind
                      it is, and when it was seen.
                    */}
                    <p className="text-sm text-ink">
                      {takeaway.kind === 'action' ? 'Action takeaway' : 'Principle'} · noticed{' '}
                      {takeaway.observedAt.slice(0, 10)}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-ink-secondary">
                      {takeaway.areaKey === null ? (
                        <span>No area yet</span>
                      ) : (
                        <AreaBadge
                          areaKey={takeaway.areaKey}
                          name={nameOf(takeaway.areaKey)}
                          kind={byKey.get(takeaway.areaKey)?.kind ?? 'area'}
                          size="sm"
                        />
                      )}
                      <span>Its text lives in the document tool</span>
                    </div>
                  </div>

                  {takeaway.mayEnterBacklog ? (
                    <PromoteDialog takeaway={takeaway} areas={areaList} />
                  ) : (
                    <span className="text-xs text-ink-muted">
                      A principle is not a backlog candidate
                    </span>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function Header({ subtitle }: { subtitle?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold text-ink">Inbox</h1>
      <p className="text-sm text-ink-secondary">
        {subtitle ?? 'What arrived and has not been triaged.'}
      </p>
    </header>
  );
}
