import { AreaBadge, Badge, Card, ClearedState, Section } from '@prisme/ui';
import { ApiFailureState } from '@/components/api-failure';
import { apiFetch } from '@/lib/api';
import {
  adoptionQueueSchema,
  areaListSchema,
  type AdoptionCandidate,
  type Area,
} from '@/lib/contracts';
import { CandidateDecisions } from './adoption-actions';

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
 * Every title below is **instance data**. It renders in a browser and never in
 * this repository (docs/17-privacy.md).
 */
export default async function AdoptionPage() {
  const [queue, areas] = await Promise.all([
    apiFetch({ path: '/adoption/queue', query: { limit: '100' }, schema: adoptionQueueSchema }),
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

  const { items, total } = queue.data;

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
            ? 'Nothing is waiting.'
            : `${String(total)} waiting — ${String(proposed.length)} with a proposal, ${String(manual.length)} needing a decision.`
        }
      />

      {total === 0 ? (
        <ClearedState
          title="The queue is empty"
          description="Every external object prisme can see is either linked, ignored, or something the scan decided to leave where it is. Run `prisme-sync adopt --plan` to look again."
        />
      ) : null}

      {proposed.length > 0 ? (
        <Section
          title="Proposed"
          description="prisme thinks each of these is an entity it already has. Accepting one links them; it creates nothing, in prisme or in either tool."
        >
          <CandidateList candidates={proposed} byKey={byKey} nameOf={nameOf} />
        </Section>
      ) : null}

      {manual.length > 0 ? (
        <Section
          title="No match"
          description="Nothing resolved these. Adopting one creates a prisme entity bound to the object that already exists — most things, though, are better ignored than promoted."
        >
          <CandidateList candidates={manual} byKey={byKey} nameOf={nameOf} />
        </Section>
      ) : null}
    </div>
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
}: {
  candidates: readonly AdoptionCandidate[];
  byKey: ReadonlyMap<string, Area>;
  nameOf: (key: string) => string;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {candidates.map((candidate) => (
        <li key={`${candidate.externalKind}:${candidate.externalId}`}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="truncate text-sm font-medium text-ink">{candidate.title}</p>
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
                <span className="truncate">{candidate.reason}</span>
              </div>
              {hasRule(candidate) ? <Proposal candidate={candidate} /> : null}
            </div>

            <CandidateDecisions candidate={candidate} />
          </Card>
        </li>
      ))}
    </ul>
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
    <div>
      <h1 className="text-xl font-semibold text-ink">Adoption</h1>
      <p className="text-sm text-ink-secondary">
        {subtitle ?? 'External work with no prisme link.'}
      </p>
    </div>
  );
}
