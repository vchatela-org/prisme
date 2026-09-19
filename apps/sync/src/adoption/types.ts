/**
 * The vocabulary of adoption.
 *
 * Adoption is the one operation in prisme that looks at years of existing work
 * and decides what it *is*. It writes nothing outward, ever — the strongest
 * statement this file makes is a proposal, and the second strongest is a link.
 *
 * ```
 * scan(objects, targets, decided) → Candidate[]
 *                                     ├─ classification   what it should become
 *                                     └─ proposal?        which prisme entity it already is
 * ```
 *
 * Nothing here has a clock, a connection or a random number. Every rule in
 * docs/13-migration.md §3 and §4 is decided in this directory, against JSON,
 * which is what makes the highest-risk workstream in the project testable
 * rather than merely careful.
 */

/** The four external shapes prisme can bind to — `entity_external_ref.kind`. */
export type ExternalKind = 'page' | 'project' | 'section' | 'task';

export const EXTERNAL_KINDS: readonly ExternalKind[] = ['page', 'project', 'section', 'task'];

/**
 * What an external object should become — docs/13-migration.md §4.
 *
 * Two of these mean **leave it where it is**. `task` is the answer for a loose
 * task with no structure, and `takeaway` for a principle; neither produces a
 * prisme entity, and neither belongs in the backlog. They are values rather
 * than an absence because "the classifier decided this stays a task" and "the
 * classifier had nothing to say" are different findings, and the second one is
 * a bug report.
 */
export type CandidateKind =
  'initiative' | 'project' | 'key_result' | 'ritual' | 'run' | 'signal' | 'takeaway' | 'task';

export const CANDIDATE_KINDS: readonly CandidateKind[] = [
  'initiative',
  'project',
  'key_result',
  'ritual',
  'run',
  'signal',
  'takeaway',
  'task',
];

/** The kinds that produce a prisme entity when adopted. The rest stay put. */
export const ADOPTABLE_KINDS: readonly CandidateKind[] = [
  'initiative',
  'project',
  'key_result',
  'ritual',
];

export function isAdoptable(kind: CandidateKind): boolean {
  return ADOPTABLE_KINDS.includes(kind);
}

/** Which rule in docs/13-migration.md §3 produced a proposal. In its order. */
export type MatchRule =
  'existing_mapping' | 'exact_title' | 'normalised_title' | 'fuzzy_title' | 'manual';

export type Confidence = 'certain' | 'high' | 'medium' | 'low' | 'manual';

/**
 * The confidence each rule carries. **`certain` is the only one that
 * auto-applies**, and the database agrees: `entity_link`'s
 * `only_certainty_is_automatic` refuses an automatic row at any other level.
 */
export const RULE_CONFIDENCE: Readonly<Record<MatchRule, Confidence>> = {
  existing_mapping: 'certain',
  exact_title: 'high',
  normalised_title: 'medium',
  fuzzy_title: 'low',
  manual: 'manual',
};

export function isAutomatic(confidence: Confidence): boolean {
  return confidence === 'certain';
}

/**
 * An external object, as the queue sees it.
 *
 * Deliberately not `ExternalTask` or `DocRecord`: both tools fold into one
 * shape here, so the resolution rules are written once rather than twice and
 * cannot drift apart. Populated by the adapters in `scan.ts`.
 *
 * `title` is **instance data** — a real title from a real workspace. It reaches
 * a terminal and a browser; it never reaches this repository
 * (docs/17-privacy.md).
 */
export interface ExternalObject {
  readonly kind: ExternalKind;
  readonly externalId: string;
  readonly title: string;
  /** From `area_mapping`, or the document tool's own area relation. */
  readonly areaKey?: string | undefined;
  /** The area's kind, which is what routes an object into a lane (ADR-0014). */
  readonly areaLane?: 'area' | 'run' | 'signals' | undefined;
  /** Closed, completed or archived. A closed object matches only another closed one. */
  readonly closed: boolean;
  /** Task-tool structure: does anything hang off it? */
  readonly childCount?: number | undefined;
  /** A subtask is never a candidate in its own right — its parent is. */
  readonly parentId?: string | undefined;
  /** Recurring in the task tool's own sense. */
  readonly recurring?: boolean | undefined;
  /** Labels, for the intent channel and for ritual detection. */
  readonly labels?: readonly string[] | undefined;
  /** Sections under a project, for "dedicated project with sections". */
  readonly sectionCount?: number | undefined;
  /** The document tool's store this came from, when it came from there. */
  readonly role?: string | undefined;
  /**
   * The takeaway's own type, from the document tool. `action` is a backlog
   * candidate; `principle` never is, and that distinction is the whole reason
   * this field is carried rather than inferred from the text.
   */
  readonly takeawayType?: 'action' | 'principle' | undefined;
  /**
   * A prisme identifier the workspace already carries, from an earlier
   * automation. **Guard 4** — the cheapest and most reliable identity source
   * there is (docs/13-migration.md §2).
   */
  readonly mappedPrismeId?: string | undefined;
}

/** What docs/13-migration.md §4 says this object should become, and why. */
export interface Classification {
  readonly kind: CandidateKind;
  /** prisme's vocabulary, for the plan's third column. Displayed, never parsed. */
  readonly reason: string;
}

/**
 * An existing prisme entity an external object might already be.
 *
 * Only **unbound** entities belong here. One already carrying an
 * `entity_external_ref` cannot be the answer: guard 1 would refuse the second
 * binding at the database, and proposing it would be proposing a failure.
 *
 * No `origin`. Matching does not consult provenance and must not: an adopted
 * entity and one prisme created are equally matchable, and the guard that keeps
 * them apart lives in the planner, not here.
 */
export interface MatchTarget {
  readonly prismeId: string;
  readonly kind: CandidateKind;
  readonly title: string;
  readonly areaKey?: string | undefined;
  readonly closed: boolean;
}

export interface Proposal {
  readonly rule: MatchRule;
  readonly confidence: Confidence;
  readonly prismeId: string;
  /** 0–1, and only for `fuzzy_title`. Shown with the suggestion, never hidden. */
  readonly similarity?: number | undefined;
}

export interface Candidate {
  readonly object: ExternalObject;
  readonly classification: Classification;
  /** Absent means the manual remainder — the number the coverage report is about. */
  readonly proposal?: Proposal | undefined;
}

/** A decision already recorded, so a re-scan does not re-propose it. */
export interface DecidedSet {
  /** `entity_link` — every adopt and merge, by `kind:externalId`. */
  readonly linked: ReadonlySet<string>;
  /** `adoption_ignore`. Permanent: an item in here never returns to the queue. */
  readonly ignored: ReadonlySet<string>;
}

export function externalKey(kind: ExternalKind, externalId: string): string {
  return `${kind}:${externalId}`;
}
