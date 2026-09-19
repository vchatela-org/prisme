import { Button, EmptyState, Section } from '@prisme/ui';
import Link from 'next/link';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  isFiltered,
  pagePosition,
  parseBacklogQuery,
  toApiQuery,
  toSearchString,
  withChange,
  type RawSearchParams,
} from '@/lib/backlog-query';
import { areaListSchema, backlogSchema, focusSchema, type Area } from '@/lib/contracts';
import { BacklogFilters } from './backlog-filters';
import { BacklogTable } from './backlog-table';

export const metadata = {
  title: 'Backlog · prisme',
  description: 'Everything ranked, filterable, and re-scorable in place.',
};

/**
 * The backlog — every initiative, ranked, with the filters in the URL.
 *
 * Focus answers "what now"; this answers "what else, and where does it sit".
 * It is also where a weekly review does its bulk work, which is why selection
 * and inline re-scoring live here rather than on Focus.
 *
 * Focus is read alongside the page for one reason: the WIP guardrails. Moving a
 * row to `now` should say *how many* slots that area has left, and those counts
 * only exist on the focus response. If that read fails the table still works —
 * the size and blocker warnings do not need it — and no warning invents a
 * number it does not have.
 */
export default async function BacklogPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseBacklogQuery(await searchParams);

  const [backlog, areas, focus] = await Promise.all([
    apiFetch({ path: '/backlog', query: toApiQuery(query), schema: backlogSchema }),
    apiFetch({ path: '/areas', query: { limit: '200' }, schema: areaListSchema }),
    apiFetch({ path: '/focus', schema: focusSchema }),
  ]);

  const areaList: readonly Area[] = areas.ok ? areas.data.items : [];

  if (!backlog.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={backlog} surface="the backlog" />
      </div>
    );
  }

  const data = backlog.data;
  const position = pagePosition(data.offset, data.limit, data.total);
  const method = `${data.methodId} v${String(data.methodVersion)}`;

  return (
    <div className="flex flex-col gap-6">
      <Header
        subtitle={`${String(data.total)} initiatives · ordered by ${data.sort} · ranked with ${method}`}
      />

      <BacklogFilters query={query} areas={areaList} />

      {data.items.length === 0 ? (
        isFiltered(query) ? (
          <EmptyState
            title="Nothing matches these filters"
            description="Every initiative is still there; none of them matches what is selected above. Clearing one filter at a time is usually faster than guessing which one is wrong."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/backlog">Clear the filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="The backlog is empty"
            description="An initiative is a result you can finish — “fence replaced”, not “work on the fence”. They arrive here by being captured in the inbox and given a status, or by being adopted from work that already exists in your document and task tools."
            action={
              <Button asChild size="sm">
                <Link href="/inbox">Start from the inbox</Link>
              </Button>
            }
          />
        )
      ) : (
        <Section
          title="Ranked"
          description="Scores compare only within an area — allocation happens first, ranking second (ADR-0005). Hover or focus a score to see how it was reached."
        >
          <BacklogTable
            entries={data.items}
            areas={areaList}
            method={method}
            weightsStale={focus.ok ? focus.data.weightsStale : false}
            slots={focus.ok ? focus.data.slotsByArea : []}
            limits={focus.ok ? focus.data.limits : undefined}
            nowCount={focus.ok ? focus.data.now.length : 0}
          />

          <nav
            aria-label="Backlog pages"
            className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-secondary"
          >
            <span className="tabular-nums">
              {position.from}–{position.to} of {position.total}
            </span>
            <div className="flex gap-2">
              <Button asChild variant="ghost" size="sm" disabled={!position.hasPrevious}>
                <Link
                  href={`/backlog${toSearchString(withChange(query, { offset: Math.max(0, query.offset - query.limit) }))}`}
                  aria-disabled={!position.hasPrevious}
                >
                  Previous
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" disabled={!position.hasNext}>
                <Link
                  href={`/backlog${toSearchString(withChange(query, { offset: query.offset + query.limit }))}`}
                  aria-disabled={!position.hasNext}
                >
                  Next
                </Link>
              </Button>
            </div>
          </nav>
        </Section>
      )}
    </div>
  );
}

function Header({ subtitle }: { subtitle?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl font-semibold text-ink">Backlog</h1>
      <p className="text-sm text-ink-secondary">
        {subtitle ?? 'Everything ranked, filterable, and re-scorable in place.'}
      </p>
    </header>
  );
}
