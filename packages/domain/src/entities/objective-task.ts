import type { AreaKey } from './area.js';
import type { InitiativeId, InitiativeStatus } from './initiative.js';
import { isObjectiveOpen, type ObjectiveId, type ObjectiveStatus } from './objective.js';
import { exactTitleForm } from './title.js';

/**
 * An objective holds its task (ADR-0038).
 *
 * Keeping an objective as a task in the task tool is common: one task per
 * goal, worked on all period, with the key results as its subtasks. The
 * intent label brings that task in as an **initiative** — a one-to-six-week
 * outcome, ranked and given a `now` slot — which is what it is not
 * (docs/00-vision.md, failure 3). Converting one by hand exists (S1); this is
 * the rule that recognises the objective's own task without asking.
 *
 * The rule is deliberately narrow, because it acts without a person:
 *
 * - the initiative holds a task (its anchor) and is not closed;
 * - its title is **exactly** the objective's title — rule 2's form,
 *   `exactTitleForm`, where whitespace and Unicode normalisation do not count
 *   and case, accents and punctuation do — and in the same area;
 * - **exactly one** open objective matches it, that objective holds no task
 *   yet, and no other initiative matches the same objective.
 *
 * Anything less certain is left to *Convert to key result* or to a person.
 */

export interface ObjectiveTaskInitiative {
  readonly id: InitiativeId;
  readonly title: string;
  readonly areaKey: AreaKey;
  readonly status: InitiativeStatus;
  /** The task it is bound to. An initiative without one has nothing to give. */
  readonly externalAnchorId?: string | undefined;
}

export interface ObjectiveTaskObjective {
  readonly id: ObjectiveId;
  readonly title: string;
  readonly areaKey: AreaKey;
  readonly status: ObjectiveStatus;
  /** Whether it already holds a task. One objective, one task. */
  readonly holdsTask: boolean;
}

export interface ObjectiveTaskMatch {
  readonly initiativeId: InitiativeId;
  readonly objectiveId: ObjectiveId;
  /** The initiative's task, which becomes the objective's. */
  readonly externalTaskId: string;
}

const CLOSED: ReadonlySet<InitiativeStatus> = new Set<InitiativeStatus>(['done', 'dropped']);

/** Whether two titles are the same title, by rule 2's exact form. */
export function isSameTitle(left: string, right: string): boolean {
  return exactTitleForm(left) === exactTitleForm(right);
}

/**
 * Every initiative that is an objective's own task, and that objective. Sorted
 * by initiative id, so two runs over the same state agree line for line.
 */
export function objectiveTaskMatches(
  initiatives: readonly ObjectiveTaskInitiative[],
  objectives: readonly ObjectiveTaskObjective[],
): readonly ObjectiveTaskMatch[] {
  const candidates = objectives.filter(
    (objective) => isObjectiveOpen(objective.status) && !objective.holdsTask,
  );

  const proposed: ObjectiveTaskMatch[] = [];
  for (const initiative of initiatives) {
    if (initiative.externalAnchorId === undefined || CLOSED.has(initiative.status)) continue;
    const matching = candidates.filter(
      (objective) =>
        objective.areaKey === initiative.areaKey && isSameTitle(objective.title, initiative.title),
    );
    const [only] = matching;
    if (matching.length !== 1 || only === undefined) continue;
    proposed.push({
      initiativeId: initiative.id,
      objectiveId: only.id,
      externalTaskId: initiative.externalAnchorId,
    });
  }

  // One objective, one task: two initiatives naming the same objective is a
  // question for a person, so neither is taken.
  const claims = new Map<ObjectiveId, number>();
  for (const match of proposed) {
    claims.set(match.objectiveId, (claims.get(match.objectiveId) ?? 0) + 1);
  }
  return proposed
    .filter((match) => claims.get(match.objectiveId) === 1)
    .sort((left, right) =>
      left.initiativeId < right.initiativeId ? -1 : left.initiativeId > right.initiativeId ? 1 : 0,
    );
}
