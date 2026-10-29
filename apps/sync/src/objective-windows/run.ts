import {
  objectiveWindowSteps,
  type ObjectiveStatus,
  type ObjectiveType,
  type ObjectiveWindowStep,
} from '@prisme/domain';

/**
 * An objective's status follows its window (ADR-0037), once per pass.
 *
 * The rule is `objectiveWindowSteps` in `@prisme/domain`: a draft becomes
 * active when its period starts, an active objective whose period has not
 * started is a draft, and an objective nobody judged by the end of its review
 * window is missed. This applies it to every open objective, and records each
 * change in the event log with its reason, so an objective closed by its
 * window is never mistaken for one a person judged.
 *
 * **prisme's own tables only.** It writes no API, so it runs under the write
 * freeze too, and the period's tasks in the task tool are never closed by it:
 * the owner tidies those during the review window, and after.
 *
 * **Level-triggered** (ADR-0009): it reads what every open objective is now
 * and moves it to where its window says, so a missed pass, a restored backup or
 * a status set by hand converge on the next one. Each change is a
 * compare-and-set on the status it was read with, so a person judging an
 * objective while a pass runs wins.
 */

export interface OpenObjective {
  readonly id: string;
  readonly type: ObjectiveType;
  readonly period: string;
  readonly status: ObjectiveStatus;
}

export interface ObjectiveWindowStore {
  /** Every draft or active objective. */
  openObjectives(): Promise<readonly OpenObjective[]>;
  /**
   * Move one objective from `step.from` to `step.to` and record it, in one
   * transaction. `false` when its status is no longer `step.from`.
   */
  applyStep(id: string, step: ObjectiveWindowStep, at: Date): Promise<boolean>;
}

export interface ObjectiveWindowsOptions {
  readonly store: ObjectiveWindowStore;
  /** The instance's calendar day, `YYYY-MM-DD`. */
  readonly today: string;
  readonly now: Date;
  /** `plan` reports what would move and writes nothing. */
  readonly mode: 'plan' | 'apply';
}

export interface ObjectiveWindowsResult {
  /** Changes made, or that would be made under `plan`, by reason. */
  readonly counts: Readonly<Record<ObjectiveWindowStep['reason'], number>>;
  /** Changes skipped because somebody moved the objective first. */
  readonly raced: number;
}

export async function advanceObjectiveWindows(
  options: ObjectiveWindowsOptions,
): Promise<ObjectiveWindowsResult> {
  const counts: Record<ObjectiveWindowStep['reason'], number> = {
    period_started: 0,
    period_not_started: 0,
    review_window_ended: 0,
  };
  let raced = 0;

  const objectives = [...(await options.store.openObjectives())].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

  for (const objective of objectives) {
    for (const step of objectiveWindowSteps(objective, options.today)) {
      if (options.mode === 'plan') {
        counts[step.reason] += 1;
        continue;
      }
      if (await options.store.applyStep(objective.id, step, options.now)) {
        counts[step.reason] += 1;
      } else {
        raced += 1;
        break;
      }
    }
  }

  return { counts, raced };
}

/** The instance's calendar day in an IANA timezone, `YYYY-MM-DD`. */
export function calendarDayIn(timezone: string, now: Date): string {
  // `en-CA` formats a date as ISO year-month-day.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
