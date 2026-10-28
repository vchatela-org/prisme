import { classify, DEFAULT_CLASSIFIER_CONFIG, type ClassifierConfig } from './classify.js';
import {
  DEFAULT_RESOLVE_OPTIONS,
  indexTargets,
  resolve,
  resolveAcrossKinds,
  type ResolveOptions,
} from './resolve.js';
import {
  externalKey,
  isAdoptable,
  type Candidate,
  type CandidateKind,
  type Classification,
  type DecidedSet,
  type ExternalObject,
  type MatchTarget,
} from './types.js';

/**
 * Building the queue — docs/13-migration.md §4.
 *
 * "Lists every external object with no prisme link." Two things are subtracted
 * from that, and each is what makes the queue finishable:
 *
 *   - **Already linked.** A decision that has been made is not a question.
 *   - **Ignored.** Permanently, by a human. "A queue that re-proposes the same
 *     200 items every week gets abandoned in a fortnight, and then the model
 *     quietly diverges from reality."
 *
 * And one thing is *set aside* rather than subtracted: an object the classifier
 * says **stays where it is** — a loose task, a principle, a signal — is not a
 * question either. It is counted, and the count is reported, but it does not
 * occupy a row a human has to clear. Putting every loose task in the queue is
 * the over-promotion trap arriving by the back door: nobody works a queue of
 * four thousand, so nobody works the queue.
 *
 * This is a **level-triggered** computation (ADR-0009): the whole external
 * world in, the whole queue out, no memory of the last run beyond the decisions
 * a human made. Re-running it after a decision produces a smaller queue, and
 * that is the convergence property, proved rather than asserted in
 * `queue.test.ts`.
 */

export interface ScanInput {
  /** Every external object read this pass, from both tools. */
  readonly objects: readonly ExternalObject[];
  /** Unbound prisme entities — what an object might already be. */
  readonly targets: readonly MatchTarget[];
  /**
   * Every objective, bound or not — what a task kept as an objective repeats.
   * Read by the cross-kind rule only, and never a proposal's target.
   */
  readonly objectives?: readonly MatchTarget[] | undefined;
  readonly decided: DecidedSet;
}

export interface ScanOptions {
  readonly classifier?: ClassifierConfig | undefined;
  readonly resolve?: ResolveOptions | undefined;
}

export interface ScanResult {
  /** What a human has to decide about. Adoptable, undecided, in classification order. */
  readonly queue: readonly Candidate[];
  /**
   * Objects the classifier left where they are, by kind. Reported, never
   * queued. A number that climbs here is the system working.
   */
  readonly leftInPlace: Readonly<Record<CandidateKind, number>>;
  /** Already carrying an `entity_link`. */
  readonly alreadyLinked: number;
  /** Ignored by a human at some point. Never re-proposed. */
  readonly ignored: number;
  /** Rule 1 fired: certain, and safe to apply without asking. */
  readonly autoLinkable: readonly Candidate[];
}

function emptyCounts(): Record<CandidateKind, number> {
  return {
    initiative: 0,
    project: 0,
    objective: 0,
    key_result: 0,
    ritual: 0,
    run: 0,
    signal: 0,
    takeaway: 0,
    task: 0,
  };
}

/**
 * The order the queue is worked in.
 *
 * Confident proposals first, because they are the fast ones and clearing them
 * shrinks the list a human is looking at. The manual remainder sits at the
 * bottom, where it is visibly the work that is left rather than mixed in with
 * the easy rows.
 */
const PROPOSAL_ORDER: Readonly<Record<string, number>> = {
  existing_mapping: 0,
  exact_title: 1,
  normalised_title: 2,
  fuzzy_title: 3,
  manual: 4,
};

function rank(candidate: Candidate): number {
  return candidate.proposal === undefined ? 5 : (PROPOSAL_ORDER[candidate.proposal.rule] ?? 5);
}

/**
 * May this object be read as a key result or an objective kept as a task?
 *
 * A top-level task the classifier left in place or read as an initiative from
 * its structure. Not a subtask (its parent is the unit), and not a task a human
 * labelled: the labels are the intent channel, and they outrank a title
 * (`classify.ts`). The anchor label in particular is answered by the
 * reconciler's next pass, not by the queue.
 */
function mayCrossKinds(
  object: ExternalObject,
  classification: Classification,
  classifier: ClassifierConfig,
): boolean {
  if (object.kind !== 'task' || object.parentId !== undefined) return false;
  if (classification.kind !== 'task' && classification.kind !== 'initiative') return false;
  const labels = object.labels ?? [];
  return ![classifier.anchorLabel, classifier.keyResultLabel, classifier.ritualLabel].some(
    (label) => labels.includes(label),
  );
}

export function scan(input: ScanInput, options: ScanOptions = {}): ScanResult {
  const classifier = options.classifier ?? DEFAULT_CLASSIFIER_CONFIG;
  const resolveOptions = options.resolve ?? DEFAULT_RESOLVE_OPTIONS;
  const targets = indexTargets(input.targets);
  const objectives = indexTargets(input.objectives ?? []);

  const queue: Candidate[] = [];
  const autoLinkable: Candidate[] = [];
  const leftInPlace = emptyCounts();
  let alreadyLinked = 0;
  let ignored = 0;

  for (const object of input.objects) {
    const key = externalKey(object.kind, object.externalId);

    if (input.decided.linked.has(key)) {
      alreadyLinked += 1;
      continue;
    }
    if (input.decided.ignored.has(key)) {
      ignored += 1;
      continue;
    }

    let classification = classify(object, classifier);
    let proposal = isAdoptable(classification.kind)
      ? resolve(object, classification, targets, resolveOptions)
      : undefined;

    // A match of its own kind stands. Without one, a task whose title is a key
    // result's or an objective's is read as what it repeats (S1).
    if (proposal === undefined && mayCrossKinds(object, classification, classifier)) {
      const crossed = resolveAcrossKinds(object, targets, objectives);
      if (crossed !== undefined) {
        classification = crossed.classification;
        proposal = crossed.proposal;
      }
    }

    if (!isAdoptable(classification.kind)) {
      leftInPlace[classification.kind] += 1;
      continue;
    }

    const candidate: Candidate = { object, classification, ...(proposal ? { proposal } : {}) };
    queue.push(candidate);
    if (proposal?.confidence === 'certain') autoLinkable.push(candidate);
  }

  // Stable within a rank: by external id, so two scans of an unchanged world
  // produce byte-identical output and a diff of two reports means something.
  queue.sort(
    (left, right) =>
      rank(left) - rank(right) || left.object.externalId.localeCompare(right.object.externalId),
  );

  return { queue, leftInPlace, alreadyLinked, ignored, autoLinkable };
}

/** What a human still has to read: the queue minus the rows a machine may apply. */
export function unresolved(result: ScanResult): readonly Candidate[] {
  return result.queue.filter((candidate) => candidate.proposal?.confidence !== 'certain');
}
