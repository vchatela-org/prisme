import { AreaBadge, Badge, Card, ClearedState, Section, cn } from '@prisme/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiFailureState } from '@/components/api-failure';
import {
  adoptRefusalText,
  candidateLink,
  ignoreEndedConfirmation,
  ignoreEndedOffer,
  NO_AREA,
  periodText,
  queueFilters,
  queueHref,
  sourceKey,
  sourceLabel,
  WHEN_LABELS,
  type CandidateLink,
  type QueueFilters,
} from '@/lib/adoption-view';
import { apiFetch } from '@/lib/api';
import {
  adoptionQueueSchema,
  areaListSchema,
  type AdoptionCandidate,
  type AdoptionQueue,
  type Area,
  type QueueWhen,
} from '@/lib/contracts';
import { webRuntime } from '@/lib/runtime';
import { CandidateDecisions, IgnoreEndedButton } from './adoption-actions';
import { RescanButton } from './rescan-button';

export const metadata = {
  title: 'Adoption · prisme',
  description: 'External work with no prisme link, and what it could become.',
};

/**
 * The adoption queue — every external object prisme has no link for.
 *
 * This is the screen where years of existing work are brought into the model,
 * and it is the highest-risk surface in the application. Three things about it
 * are decisions rather than styling:
 *
 * **Nothing here writes outward.** Adopt creates a prisme entity bound to the
 * object that already exists; merge binds to an entity prisme already had;
 * ignore records a refusal. No page and no task is created, ever
 * (docs/13-migration.md §1, ADR-0010).
 *
 * **The confidence is shown, and so is the score behind it.** A proposal is a
 * suggestion with its reasoning visible: which rule fired, against which
 * entity, and — for a fuzzy match — how similar the titles actually were. A
 * similarity nobody can see is a number nobody can disagree with, and
 * disagreeing is what a human is here for.
 *
 * **The queue is designed to become empty**, so its empty state is a finished
 * job rather than a first-run explanation. Every decision removes a row and no
 * decision brings one back — which is the only reason a queue like this gets
 * worked rather than abandoned.
 *
 * **A title opens the object it names**, in Notion or Todoist, whenever the
 * deployment supplies a link template for its kind (`candidateLink`). A title
 * is often not enough to decide on; the page behind it usually is.
 *
 * **What has ended is hidden, then ignored.** A Notion database with a date
 * column chosen on Settings → Notion dates its entries, and the default view
 * leaves out one whose period is over — an objective for a year long gone is
 * history rather than a question. The filter above the list shows how many,
 * and one click shows them. Hidden is not decided, though: a hidden row still
 * keeps the queue from reaching zero, so the *Ended* view offers to ignore
 * every row it shows, behind one confirmation that states the count and the
 * filters (docs/13-migration.md §4).
 *
 * The filters live in the address, so a filtered queue can be reloaded and
 * linked, and each carries a count of the rows it would show.
 *
 * Every title below is **instance data**. It renders in a browser and never in
 * this repository (docs/17-privacy.md).
 */
export default async function AdoptionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = queueFilters(await searchParams);
  const [queue, areas] = await Promise.all([
    apiFetch({
      path: '/adoption/queue',
      query: {
        limit: '100',
        when: filters.when,
        source: filters.source,
        areaKey: filters.areaKey,
      },
      schema: adoptionQueueSchema,
    }),
    apiFetch({ path: '/areas', schema: areaListSchema }),
  ]);

  if (!queue.ok) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <ApiFailureState failure={queue} surface="the adoption queue" />
      </div>
    );
  }

  const areaList: readonly Area[] = areas.ok ? areas.data.items : [];
  const byKey = new Map(areaList.map((area) => [area.key, area]));
  const nameOf = (key: string): string => byKey.get(key)?.name ?? key;

  const { items, total, facets } = queue.data;
  const narrowed = filters.source !== undefined || filters.areaKey !== undefined;
  const hiddenEnded = filters.when === 'open' ? facets.when.ended : 0;
  const endedOffer = ignoreEndedOffer(filters, queue.data);
  const config = webRuntime().config;
  const links = {
    page: config.doctoolPageUrlTemplate,
    project: config.tasktoolProjectUrlTemplate,
  };

  // Split by whether a rule fired at all. The two halves are worked
  // differently: the first is "is this proposal right?", which is a glance; the
  // second is "what is this?", which is a decision.
  const proposed = items.filter((candidate) => hasRule(candidate));
  const manual = items.filter((candidate) => !hasRule(candidate));

  return (
    <div className="flex flex-col gap-8">
      <Header
        subtitle={
          total === 0
            ? 'Nothing is waiting here.'
            : `${String(total)} ${narrowed || filters.when !== 'open' ? 'shown' : 'waiting'} — ${String(proposed.length)} with a proposal, ${String(manual.length)} needing a decision.`
        }
      />

      <FilterBar filters={filters} facets={facets} nameOf={nameOf} />

      {hiddenEnded > 0 ? (
        <p className="text-sm text-ink-secondary">
          {String(hiddenEnded)} whose date has passed {hiddenEnded === 1 ? 'is' : 'are'} hidden.{' '}
          <Link
            className="underline underline-offset-2"
            href={queueHref(filters, { when: 'ended' })}
          >
            Show {hiddenEnded === 1 ? 'it' : 'them'}
          </Link>
        </p>
      ) : null}

      {endedOffer === undefined ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-secondary">
            Each of these has ended. Ignoring them — one by one, or all at once — is how they leave
            the queue for good.
          </p>
          <IgnoreEndedButton
            offer={endedOffer}
            confirmation={ignoreEndedConfirmation(endedOffer, items.length, nameOf)}
          />
        </div>
      )}

      {total === 0 ? (
        narrowed || filters.when !== 'open' ? (
          <ClearedState
            title="Nothing matches these filters"
            description="Clear a filter to see the rest of the queue."
          />
        ) : (
          <ClearedState
            title="The queue is empty"
            description="Every external object prisme can see is either linked, ignored, or something the scan decided to leave where it is. Rescan to look again."
          />
        )
      ) : null}

      {proposed.length > 0 ? (
        <Section
          title="Proposed"
          description="prisme thinks each of these is an entity it already has. Accepting one links them; it creates nothing, in prisme or in either tool."
        >
          <CandidateList candidates={proposed} byKey={byKey} nameOf={nameOf} links={links} />
        </Section>
      ) : null}

      {manual.length > 0 ? (
        <Section
          title="No match"
          description="Nothing resolved these. Adopting one creates a prisme entity bound to the object that already exists — most things, though, are better ignored than promoted."
        >
          <CandidateList candidates={manual} byKey={byKey} nameOf={nameOf} links={links} />
        </Section>
      ) : null}
    </div>
  );
}

/**
 * The three filters, as links: by date, by where it was read from, and by
 * area. Each value carries the number of rows it would show, and a value with
 * none is not offered — except the one in force, so it can be seen and cleared.
 */
function FilterBar({
  filters,
  facets,
  nameOf,
}: {
  filters: QueueFilters;
  facets: AdoptionQueue['facets'];
  nameOf: (key: string) => string;
}) {
  const whenOrder: readonly QueueWhen[] = [
    'open',
    'current',
    'upcoming',
    'undated',
    'ended',
    'all',
  ];
  const sourceTotal = facets.source.reduce((sum, facet) => sum + facet.count, 0);
  const areaTotal = facets.area.reduce((sum, facet) => sum + facet.count, 0);

  return (
    <nav aria-label="Filter the queue" className="flex flex-col gap-2">
      <FilterRow label="Date">
        {whenOrder
          .filter((when) => facets.when[when] > 0 || when === filters.when || when === 'open')
          .map((when) => (
            <Chip
              key={when}
              href={queueHref(filters, { when })}
              active={filters.when === when}
              label={WHEN_LABELS[when]}
              count={facets.when[when]}
            />
          ))}
      </FilterRow>
      <FilterRow label="From">
        <Chip
          href={queueHref(filters, { source: undefined })}
          active={filters.source === undefined}
          label="Anywhere"
          count={sourceTotal}
        />
        {facets.source.map((facet) => (
          <Chip
            key={facet.key}
            href={queueHref(filters, { source: facet.key })}
            active={filters.source === facet.key}
            label={sourceLabel(facet.key)}
            count={facet.count}
          />
        ))}
      </FilterRow>
      <FilterRow label="Area">
        <Chip
          href={queueHref(filters, { areaKey: undefined })}
          active={filters.areaKey === undefined}
          label="Any"
          count={areaTotal}
        />
        {facets.area.map((facet) => (
          <Chip
            key={facet.key ?? NO_AREA}
            href={queueHref(filters, { areaKey: facet.key ?? NO_AREA })}
            active={filters.areaKey === (facet.key ?? NO_AREA)}
            label={facet.key === null ? 'Outside every area' : nameOf(facet.key)}
            count={facet.count}
          />
        ))}
      </FilterRow>
    </nav>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-12 text-xs text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs',
        active
          ? 'border-accent-solid bg-accent-solid text-ink-on-accent'
          : 'border-border-strong text-ink-secondary hover:bg-surface-page hover:text-ink',
      )}
    >
      {label}
      <span className={active ? 'opacity-80' : 'text-ink-muted'}>{String(count)}</span>
    </Link>
  );
}

/** Whether identity resolution produced anything for this candidate. */
function hasRule(candidate: AdoptionCandidate): boolean {
  return candidate.matchRule !== null && candidate.proposedId !== null;
}

function CandidateList({
  candidates,
  byKey,
  nameOf,
  links,
}: {
  candidates: readonly AdoptionCandidate[];
  byKey: ReadonlyMap<string, Area>;
  nameOf: (key: string) => string;
  links: { page: string | undefined; project: string | undefined };
}) {
  return (
    <ul className="flex flex-col gap-3">
      {candidates.map((candidate) => (
        <li key={`${candidate.externalKind}:${candidate.externalId}`}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <CandidateTitle title={candidate.title} link={candidateLink(candidate, links)} />
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-secondary">
                {candidate.areaKey === null ? (
                  <span>Outside every mapped area</span>
                ) : (
                  <AreaBadge
                    areaKey={candidate.areaKey}
                    name={nameOf(candidate.areaKey)}
                    kind={byKey.get(candidate.areaKey)?.kind ?? 'area'}
                    size="sm"
                  />
                )}
                <Badge variant="outline">{kindLabel(candidate.proposedKind)}</Badge>
                <span>{sourceLabel(sourceKey(candidate))}</span>
                {periodText(candidate) === '' ? null : (
                  <span className={candidate.period === 'ended' ? 'text-status-warning' : ''}>
                    {periodText(candidate)}
                  </span>
                )}
                <span className="truncate">{candidate.reason}</span>
              </div>
              {hasRule(candidate) ? <Proposal candidate={candidate} /> : null}
              {candidate.adoptRefusal === null ? null : (
                <p className="text-xs text-ink-secondary">
                  {adoptRefusalText(candidate.adoptRefusal)}
                </p>
              )}
            </div>

            <CandidateDecisions candidate={candidate} />
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * The title, as a link to the object when there is one.
 *
 * It opens in a new tab, because the queue is worked row by row and a link that
 * replaced it would lose the place. `noreferrer` because the address of this
 * application is nothing the other tool needs.
 */
function CandidateTitle({ title, link }: { title: string; link: CandidateLink | undefined }) {
  if (link === undefined) {
    return <p className="truncate text-sm font-medium text-ink">{title}</p>;
  }

  return (
    <a
      className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:underline"
      href={link.href}
      target="_blank"
      rel="noreferrer"
      title={`Open in ${link.tool}`}
    >
      <span className="truncate">{title}</span>
      <ExternalLink aria-hidden className="size-3.5 shrink-0 text-ink-muted" />
      <span className="sr-only">(opens in {link.tool})</span>
    </a>
  );
}

/**
 * The proposal, with everything behind it.
 *
 * The rule, the entity, and the similarity when there is one. Nothing is
 * pre-accepted: the API's `confidence` is displayed exactly as it came back,
 * and the screen does not compute or upgrade it.
 */
function Proposal({ candidate }: { candidate: AdoptionCandidate }) {
  return (
    <p className="text-xs text-ink-secondary">
      <span className="font-medium text-ink">{ruleLabel(candidate.matchRule)}</span>
      {' → '}
      <code>{candidate.proposedId}</code>
      {' · '}
      {candidate.confidence} confidence
      {candidate.similarity === null ? null : ` · ${candidate.similarity.toFixed(3)} similar`}
    </p>
  );
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  initiative: 'Initiative',
  project: 'Project',
  objective: 'Objective',
  key_result: 'Key result',
  ritual: 'Ritual',
  run: 'Run lane',
  signal: 'Signal',
  takeaway: 'Takeaway',
  task: 'Stays a task',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

const RULE_LABELS: Readonly<Record<string, string>> = {
  existing_mapping: 'Existing mapping',
  exact_title: 'Exact title',
  normalised_title: 'Same title, written differently',
  fuzzy_title: 'Similar title',
  manual: 'By hand',
};

function ruleLabel(rule: string | null): string {
  return rule === null ? 'No rule' : (RULE_LABELS[rule] ?? rule);
}

function Header({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Adoption</h1>
        <p className="text-sm text-ink-secondary">
          {subtitle ?? 'External work with no prisme link.'}
        </p>
        <p className="text-xs text-ink-muted">
          The queue is re-read once a day. Rescan after labelling a task or changing an area’s
          locations.
        </p>
      </div>
      <RescanButton />
    </div>
  );
}
