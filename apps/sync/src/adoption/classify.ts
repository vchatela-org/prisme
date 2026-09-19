import type { CandidateKind, Classification, ExternalObject } from './types.js';

/**
 * "What becomes what" — docs/13-migration.md §4, as a pure function.
 *
 * The table in that section is the specification, and the order the rules are
 * tried in below is the order it is written in. Each rule is one branch, so a
 * reviewer can put the two side by side.
 *
 * **The trap this file exists to avoid is over-promotion.** Everything looks
 * like it could be an initiative. Promote everything and you get a backlog of
 * hundreds of incomparable items, which is the original problem with more
 * ceremony (ADR-0010's consequence, and the brief says it twice). So the
 * default here is `task` — *stays a task* — and a promotion has to be earned by
 * structure that is actually present: subtasks, sections, a store that means
 * something, or a label a human put there on purpose.
 *
 * Nothing in this file is a decision to write anything. A classification is a
 * suggestion on a screen.
 */

/** Product vocabulary, not instance data — the same convention as `reconcile/labels.ts`. */
export const DEFAULT_KEY_RESULT_LABEL = 'prisme:kr';

/** A recurring task that serves a habit goal rather than merely repeating. */
export const DEFAULT_RITUAL_LABEL = 'prisme:ritual';

export interface ClassifierConfig {
  /** Marks an already-intended initiative — the intent channel (docs/16-sync.md §4). */
  readonly anchorLabel: string;
  readonly keyResultLabel: string;
  readonly ritualLabel: string;
  /**
   * How many subtasks make a task an initiative rather than a task with a note
   * under it. Two, not one: a single subtask is how people write a reminder to
   * themselves, and promoting every one of those is the over-promotion trap in
   * its most common form.
   */
  readonly minimumSubtasks: number;
  /** A project with at least this many sections is structure, not a container. */
  readonly minimumSections: number;
}

export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  anchorLabel: 'prisme',
  keyResultLabel: DEFAULT_KEY_RESULT_LABEL,
  ritualLabel: DEFAULT_RITUAL_LABEL,
  minimumSubtasks: 2,
  minimumSections: 2,
};

function decide(kind: CandidateKind, reason: string): Classification {
  return { kind, reason };
}

/**
 * Classify one external object.
 *
 * Total: every object gets a kind, and two of them (`task`, `takeaway`) mean
 * *leave it exactly where it is*. There is no `undefined` return, because
 * "the classifier had nothing to say" and "the classifier said leave it" are
 * different facts and only the first is a bug.
 */
export function classify(
  object: ExternalObject,
  config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
): Classification {
  // A subtask is never a candidate in its own right. Its parent is the unit of
  // work; adopting a child would bind half a subtree and leave the roll-up
  // counting its own anchor.
  if (object.parentId !== undefined) {
    return decide('task', 'a subtask — its parent is the unit of work');
  }

  // --- The document tool ---------------------------------------------------

  if (object.role === 'takeaways_db') {
    // Two rows of the table, and the distinction is the document tool's own
    // field rather than anything prisme infers from the text. A principle never
    // enters the backlog — it surfaces during the review of its area instead
    // (docs/10-model.md §8).
    if (object.takeawayType === 'principle') {
      return decide('takeaway', 'a principle — it stays a takeaway and never enters the backlog');
    }
    if (object.takeawayType === 'action') {
      return decide('initiative', 'an actionable takeaway — promoted, not copied');
    }
    return decide(
      'takeaway',
      'a takeaway whose type is unset — it stays where it is until it is set',
    );
  }

  if (object.role === 'objectives_db') {
    return decide('key_result', 'held in the objectives store');
  }

  if (object.role === 'processes_db') {
    return decide('ritual', 'held in the processes store — a habit with adherence to measure');
  }

  // --- The task tool -------------------------------------------------------

  const labels = object.labels ?? [];

  // A human has already said what this is. The intent channel outranks every
  // heuristic below it, which is the point of having one.
  if (labels.includes(config.keyResultLabel)) {
    return decide('key_result', 'labelled as a key result — this task is its anchor');
  }
  if (labels.includes(config.ritualLabel)) {
    return decide('ritual', 'labelled as a ritual — a habit goal rather than a repeat');
  }
  if (labels.includes(config.anchorLabel)) {
    return decide('initiative', 'already carries the anchor label — a human asked for this');
  }

  // Lanes are areas with a different kind (ADR-0014), so a machine-generated
  // notification is recognised by *where it lives*, not by reading it. That
  // keeps the rule out of the business of guessing from text.
  if (object.areaLane === 'signals') {
    return decide('signal', 'in a signals lane — measured, never ranked');
  }

  if (object.recurring === true) {
    // "Run lane, or a Ritual if it serves a habit goal." Which of the two it is
    // cannot be read off a recurrence rule, and the ritual label above is the
    // only thing that can say. So the default is the cheaper, reversible one.
    return decide('run', 'recurring — the run lane, unless a human marks it a ritual');
  }

  if (object.areaLane === 'run') {
    return decide('run', 'in a run lane');
  }

  if (object.kind === 'project') {
    if ((object.sectionCount ?? 0) >= config.minimumSections) {
      return decide('project', 'a dedicated project with sections');
    }
    return decide('task', 'a project without sections — a container, not a structure');
  }

  if (object.kind === 'section') {
    // A section is a location, and locations map to areas (`area_mapping`).
    // Adopting one as an entity would give the same work two homes.
    return decide('task', 'a section is a location — it maps to an area, it does not become one');
  }

  if ((object.childCount ?? 0) >= config.minimumSubtasks && object.areaKey !== undefined) {
    return decide('initiative', 'a parent task with subtasks, in a mapped area');
  }

  if ((object.childCount ?? 0) >= config.minimumSubtasks) {
    // Structure without an area is not enough: an initiative that belongs to no
    // area cannot be allocated to, and allocation comes before ranking.
    return decide('task', 'has subtasks but sits outside every mapped area');
  }

  return decide('task', 'a loose task — most tasks are just tasks');
}
