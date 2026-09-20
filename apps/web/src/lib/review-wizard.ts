/**
 * The review wizard's shape: which steps a cadence has, where it resumes, and
 * what it writes down at the end.
 *
 * ## The steps are the spec's, not this file's invention
 *
 * `docs/10-model.md#cadences-and-where-each-step-happens` is a frozen table of
 * step *shapes* — one row per kind of step, with the surface it happens on and
 * the entities it touches. That table is what this module encodes, row for
 * row, and the brief is explicit that a step with no row there is a spec gap
 * to raise rather than one to improvise.
 *
 * What is deliberately **not** here is the concrete checklist. That is
 * instance data: it lives in the document tool, it names real projects and
 * real people, and it would be a privacy leak in a public repository
 * (docs/17-privacy.md). A session's `checklist` is keyed by the step ids
 * below, and a key this build does not recognise is kept rather than dropped —
 * an instance that has added its own step should not lose it because a
 * deployment rolled forward.
 *
 * ## Each step brings its own data
 *
 * The brief's sharpest note is that a checklist which merely lists steps is no
 * better than the paper one. So a step is not a label: it names the panel that
 * renders the data the step is about, and the surface that owns the decision
 * when it needs more room than a panel. `surface` is a link, never a
 * redirect — a review that sends you away loses its place, which is the
 * failure resumability exists to prevent.
 */

import type { ReviewCadence, ReviewSession } from './contracts';

/** Which data panel a step renders. One per row of the cadence map. */
export type StepPanel =
  | 'inbox'
  | 'finished'
  | 'now-set'
  | 'conflicts'
  | 'deadlines'
  | 'rescore'
  | 'refill'
  | 'capacity'
  | 'lanes'
  | 'objective-progress'
  | 'orphans'
  | 'author-objectives'
  | 'replan'
  | 'allocate-weights'
  | 'decisions';

export interface WizardStep {
  /** The checklist key stored on the session. Stable: renaming one loses history. */
  readonly id: string;
  readonly title: string;
  /** What the step is asking, in one sentence. */
  readonly prompt: string;
  /**
   * The surface from the cadence map that owns this decision in full, when
   * there is one.
   *
   * Null where the map puts the step *here* — clearing the conflict ledger is
   * the case, and there is no other surface in the application that shows it.
   * A link is offered, never a redirect: a review that sends you away loses
   * its place.
   */
  readonly surface: string | null;
  readonly panel: StepPanel;
}

/**
 * The weekly ritual: keep the `now` set honest for the coming week.
 *
 * Ordered as the map orders it, which is the order the week is actually
 * reviewed in: what arrived, what finished, what is in flight, what is stuck,
 * what is coming, and only then what should be picked up next. Re-scoring
 * before confirming what finished would re-rank a list containing work that
 * is already done.
 */
const WEEKLY: readonly WizardStep[] = [
  {
    id: 'triage-inbox',
    title: 'Triage what arrived',
    prompt:
      'Everything captured since the last review: initiatives still in the inbox, and takeaways waiting on a decision. An action takeaway can become backlog; a principle never does.',
    surface: '/inbox',
    panel: 'inbox',
  },
  {
    id: 'confirm-finished',
    title: 'Confirm what finished',
    prompt:
      // No backticks: a prompt is rendered as text, not as Markdown, so they
      // reach the screen as literal characters.
      'Initiatives sitting in review — finished but unverified. Confirming one moves it to done; anchor completion arrives from the task tool on its own.',
    surface: '/backlog?status=review',
    panel: 'finished',
  },
  {
    id: 'check-now-set',
    title: 'Check the now set for staleness and blockers',
    prompt:
      'What is in flight, when each was last touched, and what is waiting on something else. A now set nobody has touched in a fortnight is a now set that has stopped being true.',
    surface: '/',
    panel: 'now-set',
  },
  {
    id: 'clear-conflicts',
    title: 'Clear the conflict ledger',
    prompt:
      'Fields where prisme and an external tool disagree. Each one is a decision about who was right, and an unresolved ledger is how drift becomes permanent. A field that conflicts every week is a field whose ownership is wrong — the ledger is a design signal, not only a queue.',
    // The cadence map puts this step on `/review/weekly` and there is no other
    // surface in this application that shows the ledger at all.
    surface: null,
    panel: 'conflicts',
  },
  {
    id: 'look-ahead-deadlines',
    title: 'Look ahead at deadlines',
    prompt:
      'What is due, and what the schedule says cannot make it. A deadline prioritises; it is never a plan, and prisme will flag an impossible one rather than quietly moving it.',
    surface: '/timeline',
    panel: 'deadlines',
  },
  {
    id: 'rescore',
    title: 'Re-score what changed',
    prompt:
      'The ranked backlog as it stands. Re-estimating writes four factors and nothing else — the score that follows is the active method’s, and every change appends a new score row.',
    surface: '/backlog',
    panel: 'rescore',
  },
  {
    id: 'refill-now',
    title: 'Refill free now slots',
    prompt:
      'Where the per-area caps leave room, and what the ranking would put there. Allocation first, ranking only within an area.',
    surface: '/backlog',
    panel: 'refill',
  },
];

/**
 * The monthly ritual: allocation and objectives, deliberately *not* the week's
 * work.
 *
 * The separation is the point. A monthly review that re-triages the inbox
 * becomes four weekly reviews a year, and the allocation question — the one
 * thing no other tool asks — is the one that gets dropped when time runs out.
 */
const MONTHLY: readonly WizardStep[] = [
  {
    id: 'capacity-declared-observed',
    title: 'Declared against observed capacity',
    prompt:
      'What each area was allocated this year, against what it actually received. The gap is the finding; the weight itself is not editable here and will not be until the Year Review.',
    surface: '/areas',
    panel: 'capacity',
  },
  {
    id: 'lane-check',
    title: 'Lane check: Run, Signals, Ritual',
    prompt:
      'Upkeep hours, notification volume, and whether the habits held. None of these is ranked work, and all three consume the same week.',
    surface: '/kpi',
    panel: 'lanes',
  },
  {
    id: 'objective-progress',
    title: 'Set objective progress',
    prompt:
      'Self-assessed progress, by judgement, beside what the task breakdown computes. The two are never averaged — where they disagree, that disagreement is the finding.',
    surface: '/objectives',
    panel: 'objective-progress',
  },
  {
    id: 'find-orphans',
    title: 'Find orphans, both directions',
    prompt:
      'Objectives with no work behind them, and work serving no objective. Neither is automatically wrong; both are worth seeing once a month.',
    surface: '/objectives',
    panel: 'orphans',
  },
  {
    id: 'author-objectives',
    title: 'Author the next period’s objectives',
    prompt:
      'What the coming period is for. A key result measured in a rate is a habit and belongs in the Ritual lane instead — that distinction is made here or not at all.',
    surface: '/objectives',
    panel: 'author-objectives',
  },
  {
    id: 'replan-slipped',
    title: 'Replan what slipped',
    prompt:
      'The schedule as it stands, with the critical path and anything whose deadline has become infeasible. Moving one initiative moves what depends on it.',
    surface: '/timeline',
    panel: 'replan',
  },
];

/**
 * The one step a yearly review adds.
 *
 * The map is explicit that quarterly and yearly add no new step *shapes*, and
 * that yearly adds exactly one surface: `/review/year`, the only place a
 * weight is writable. The wizard therefore links there rather than
 * re-implementing the form — a second place to write a weight is a second
 * answer to what was declared.
 */
const ALLOCATE: WizardStep = {
  id: 'allocate-weights',
  title: 'Allocate next year',
  prompt:
    'The one decision that can only be taken now. A weight is fixed for a whole calendar year; the rigidity is the mechanism, not a limitation (ADR-0007).',
  surface: '/review/year',
  panel: 'allocate-weights',
};

/**
 * The last step of every cadence: write it down, and push the narrative out.
 *
 * It is the same step shape in every ritual in the map, so it is one constant
 * rather than four copies — and it is last everywhere, because a decision
 * recorded before the evidence has been looked at is a decision made
 * somewhere else.
 */
const RECORD: WizardStep = {
  id: 'record-decisions',
  title: 'Record decisions and push the narrative',
  prompt:
    'What was decided, in the words it was decided in. Closing the session takes a snapshot of per-area capacity as it stood at this moment, and that snapshot is never retaken.',
  surface: '/review/history',
  panel: 'decisions',
};

/**
 * The steps a cadence works through.
 *
 * Quarterly is the monthly set over a longer period — the same steps against a
 * wider window, which is what `windowDaysFor` carries. Inventing extra
 * quarterly steps would be exactly the improvisation the brief rules out.
 */
export function stepsFor(cadence: ReviewCadence): readonly WizardStep[] {
  switch (cadence) {
    case 'weekly':
      return [...WEEKLY, RECORD];
    case 'monthly':
    case 'quarterly':
      return [...MONTHLY, RECORD];
    case 'yearly':
      return [...MONTHLY, ALLOCATE, RECORD];
  }
}

/**
 * How far back a cadence looks.
 *
 * Used for the event log and the KPI buckets a step reads, so a quarterly
 * review is not shown the same seven days a weekly one is. Calendar-ish
 * rather than exact: a review is not a report, and a month that is 30 days
 * here changes nothing anybody would act on.
 */
export function windowDaysFor(cadence: ReviewCadence): number {
  switch (cadence) {
    case 'weekly':
      return 7;
    case 'monthly':
      return 30;
    case 'quarterly':
      return 91;
    case 'yearly':
      return 365;
  }
}

export const CADENCE_LABELS: Readonly<Record<ReviewCadence, string>> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export interface WizardProgress {
  readonly done: number;
  readonly total: number;
  /** Where an interrupted review picks up: the first step not ticked. */
  readonly resumeIndex: number;
  /** True when every step is ticked. The session can be closed. */
  readonly complete: boolean;
}

/**
 * Where a session stands, and where it resumes.
 *
 * **The first unticked step, not the furthest reached.** A reader who ticked
 * steps 1, 2 and 4 and closed the tab is returned to step 3, because the gap
 * is the thing they did not finish; landing them on 5 would silently skip it
 * and the artefact would claim the review covered ground it did not.
 *
 * A fully ticked session resumes on its last step — the one that records the
 * decisions and closes the session — rather than past the end.
 */
export function progressOf(
  steps: readonly WizardStep[],
  checklist: Readonly<Record<string, boolean>>,
): WizardProgress {
  const done = steps.filter((step) => checklist[step.id] === true).length;
  const firstOpen = steps.findIndex((step) => checklist[step.id] !== true);
  return {
    done,
    total: steps.length,
    resumeIndex: firstOpen === -1 ? Math.max(steps.length - 1, 0) : firstOpen,
    complete: steps.length > 0 && done === steps.length,
  };
}

/**
 * A step index that is safe to render, from whatever the URL said.
 *
 * The step is in the query string so a review can be linked to and reloaded
 * into the same place. That makes it caller-controlled input: it is clamped
 * here rather than trusted, and a nonsense value lands on the resume point
 * instead of erroring, because a review that 500s on a bad link is a review
 * somebody abandons.
 */
export function stepIndexFrom(
  raw: string | undefined,
  steps: readonly WizardStep[],
  fallback: number,
): number {
  if (raw === undefined || !/^\d{1,3}$/.test(raw)) return fallback;
  const index = Number(raw);
  if (index < 0 || index >= steps.length) return fallback;
  return index;
}

/**
 * Checklist keys the session carries that this build has no step for.
 *
 * Reported rather than dropped. An instance that has added a step of its own,
 * or a session written by an older build, is not corrupt — and a wizard that
 * silently discarded those keys on the next PATCH would delete somebody's
 * record of having done the work.
 */
export function unknownStepIds(
  steps: readonly WizardStep[],
  checklist: Readonly<Record<string, boolean>>,
): readonly string[] {
  const known = new Set(steps.map((step) => step.id));
  return Object.keys(checklist)
    .filter((key) => !known.has(key))
    .sort();
}

export interface ArtefactInput {
  readonly session: ReviewSession;
  readonly steps: readonly WizardStep[];
  /** Area key → display name, so the snapshot reads in words. */
  readonly areaNames: Readonly<Record<string, string>>;
}

/**
 * The written artefact, as Markdown.
 *
 * The definition of done is that it is *worth reading a month later*, and what
 * makes that true is not prose — it is three things a reader cannot
 * reconstruct afterwards:
 *
 * 1. **The decisions in the words they were decided in.** Not summarised.
 * 2. **What was skipped.** A review that did not get to the deadlines is a
 *    different review from one that looked and found nothing, and only the
 *    artefact can tell them apart later.
 * 3. **The capacity snapshot at that moment.** It is the only record of what
 *    the numbers looked like when the decision was taken, and it is never
 *    retaken.
 *
 * It is generated from the session, so it contains whatever that instance
 * wrote — which is why nothing calls this at build time and no output of it
 * is committed anywhere (docs/17-privacy.md).
 */
export function artefactFor(input: ArtefactInput): string {
  const { session, steps, areaNames } = input;
  const label = CADENCE_LABELS[session.cadence];
  const started = session.startedAt.slice(0, 10);

  const lines: string[] = [`# ${label} review — ${started}`, ''];

  lines.push(
    session.completedAt === null
      ? `Opened ${started}. **Still open** — this is a draft of a review in progress.`
      : `Opened ${started}, closed ${session.completedAt.slice(0, 10)}.`,
    '',
  );

  lines.push('## Decisions', '');
  if (session.decisions.length === 0) {
    lines.push(
      '_No decision was recorded._ A review with no decisions is worth noticing: either nothing needed to change, or the review did not get far enough to say.',
      '',
    );
  } else {
    for (const decision of session.decisions) lines.push(`- ${decision}`);
    lines.push('');
  }

  const covered = steps.filter((step) => session.checklist[step.id] === true);
  const skipped = steps.filter((step) => session.checklist[step.id] !== true);

  lines.push('## Covered', '');
  if (covered.length === 0) lines.push('_Nothing was ticked._', '');
  else {
    for (const step of covered) lines.push(`- ${step.title}`);
    lines.push('');
  }

  if (skipped.length > 0) {
    lines.push(
      '## Not covered',
      '',
      'Recorded because a step that was skipped and a step that found nothing read identically a month later.',
      '',
    );
    for (const step of skipped) lines.push(`- ${step.title}`);
    lines.push('');
  }

  const snapshot = Object.entries(session.capacitySnapshot).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (snapshot.length > 0) {
    lines.push(
      '## Capacity at the moment this closed',
      '',
      'Observed share per area, as it stood. Taken once, never retaken.',
      '',
    );
    for (const [areaKey, sharePct] of snapshot) {
      lines.push(`- ${areaNames[areaKey] ?? areaKey}: ${sharePct.toFixed(1)}%`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
