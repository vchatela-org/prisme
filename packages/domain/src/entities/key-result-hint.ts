import type { AreaKey } from './area.js';
import { type CalendarDate, dayNumberOfDate } from './calendar.js';
import type { InitiativeStatus } from './initiative.js';
import { isObjectiveOpen, type ObjectiveStatus } from './objective.js';
import { normaliseTitle } from './title.js';

/**
 * Does this initiative look like a key result? — docs/19-how-it-works.md S1.
 *
 * An initiative is an outcome finishable in one to six weeks (docs/10-model.md
 * §5). The most common way to break that is to bring in, as an initiative, a
 * goal that was kept as a task: the `prisme` label makes every labelled task an
 * initiative on the next pass, with no question asked, and a year-long goal
 * arrives with a year-end deadline beside the objective it repeats. That is
 * failure 3 of docs/00-vision.md — *objectives written as tasks are never read
 * as objectives* — recreated inside prisme.
 *
 * Two signs, each checkable without guessing:
 *
 * | Hint | When |
 * |---|---|
 * | `long_horizon` | the deadline is more than six weeks after the day the work can start — today, or a later `earliest_start` |
 * | `objective_title` | the title, normalised, is an open objective's in the same area |
 *
 * A **hint, never a decision**: nothing here changes a status, a score or a
 * slot. An initiative can legitimately have a far deadline. The screens show
 * it so the person triaging can ask the question, and *Convert to key result*
 * is the answer when it is one.
 *
 * Only open work is hinted. Converting or re-scoping something already
 * finished is not a decision anyone needs prompting for.
 */

export const KEY_RESULT_HINTS = ['long_horizon', 'objective_title'] as const;

export type KeyResultHint = (typeof KEY_RESULT_HINTS)[number];

/** Six weeks — the upper bound of an initiative's size in docs/10-model.md §5. */
export const INITIATIVE_HORIZON_DAYS = 42;

/** Statuses at which the hint is shown. Everything else is decided already. */
const HINTED_STATUSES: ReadonlySet<InitiativeStatus> = new Set<InitiativeStatus>([
  'inbox',
  'later',
  'next',
  'now',
  'waiting',
]);

/** The part of an initiative the rule reads. */
export interface KeyResultHintSubject {
  readonly title: string;
  readonly areaKey: AreaKey;
  readonly status: InitiativeStatus;
  readonly deadline?: CalendarDate | undefined;
  readonly earliestStart?: CalendarDate | undefined;
}

/** The part of an objective the rule reads. */
export interface KeyResultHintObjective {
  readonly title: string;
  readonly areaKey: AreaKey;
  readonly status: ObjectiveStatus;
}

/**
 * The hints for one initiative, in {@link KEY_RESULT_HINTS} order. Empty when
 * nothing suggests it is a key result.
 *
 * `today` is the instance's calendar day, passed in: the domain has no clock.
 */
export function keyResultHints(
  initiative: KeyResultHintSubject,
  objectives: readonly KeyResultHintObjective[],
  today: CalendarDate,
): readonly KeyResultHint[] {
  if (!HINTED_STATUSES.has(initiative.status)) return [];

  const hints: KeyResultHint[] = [];

  if (initiative.deadline !== undefined) {
    const from = Math.max(
      dayNumberOfDate(today),
      initiative.earliestStart === undefined ? 0 : dayNumberOfDate(initiative.earliestStart),
    );
    if (dayNumberOfDate(initiative.deadline) - from > INITIATIVE_HORIZON_DAYS) {
      hints.push('long_horizon');
    }
  }

  const title = normaliseTitle(initiative.title);
  if (
    objectives.some(
      (objective) =>
        objective.areaKey === initiative.areaKey &&
        isObjectiveOpen(objective.status) &&
        normaliseTitle(objective.title) === title,
    )
  ) {
    hints.push('objective_title');
  }

  return hints;
}
