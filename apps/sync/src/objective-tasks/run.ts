import {
  objectiveTaskMatches,
  type ObjectiveTaskInitiative,
  type ObjectiveTaskMatch,
  type ObjectiveTaskObjective,
} from '@prisme/domain';

/**
 * An objective holds its task (ADR-0038), once per pass.
 *
 * An initiative whose task carries exactly an open objective's title, in the
 * same area, is that objective's own task brought in by the intent label. The
 * rule that recognises it is `objectiveTaskMatches` in `@prisme/domain`; this
 * applies it. The task moves to the objective, the initiative is dropped with
 * a reason that says why, and both are written to the event log, in one
 * transaction per match.
 *
 * **prisme's own tables only.** Nothing is written to the task tool here: the
 * reconciler, later in the same pass, finds the task held by an objective and
 * converges the few fields prisme owns on it (its deadline, its label, its
 * backlink). So this runs under the write freeze, and `plan` counts without
 * writing.
 *
 * **Level-triggered** (ADR-0009): every pass compares every initiative with
 * every open objective, so a match made possible by a later edit — a title
 * corrected on either side — is taken on the pass after it.
 */

export interface ObjectiveTaskStore {
  /** Every initiative, with the task it holds. */
  initiatives(): Promise<readonly ObjectiveTaskInitiative[]>;
  /** Every objective, and whether it already holds a task. */
  objectives(): Promise<readonly ObjectiveTaskObjective[]>;
  /**
   * Move the task from the initiative to the objective and drop the
   * initiative, in one transaction. `false` when either changed since it was
   * read — the initiative no longer holds that task or is closed, or the
   * objective is closed or holds a task — and then nothing is written.
   */
  giveTaskToObjective(match: ObjectiveTaskMatch, at: Date): Promise<boolean>;
}

export interface ObjectiveTasksOptions {
  readonly store: ObjectiveTaskStore;
  readonly now: Date;
  readonly mode: 'plan' | 'apply';
}

export interface ObjectiveTasksResult {
  /** Tasks given to their objective, or that would be under `plan`. */
  readonly moved: number;
  /** Matches skipped because something changed first. */
  readonly raced: number;
}

export async function giveObjectivesTheirTasks(
  options: ObjectiveTasksOptions,
): Promise<ObjectiveTasksResult> {
  const [initiatives, objectives] = await Promise.all([
    options.store.initiatives(),
    options.store.objectives(),
  ]);
  const matches = objectiveTaskMatches(initiatives, objectives);
  if (options.mode === 'plan') return { moved: matches.length, raced: 0 };

  let moved = 0;
  let raced = 0;
  for (const match of matches) {
    if (await options.store.giveTaskToObjective(match, options.now)) moved += 1;
    else raced += 1;
  }
  return { moved, raced };
}
