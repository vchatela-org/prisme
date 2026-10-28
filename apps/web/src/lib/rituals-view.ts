import type { RecurringTasks, Ritual } from './contracts';

/**
 * What the Rituals screen shows of a ritual's recurring task, and of the
 * period a habit that is not a task is recorded in (S2).
 *
 * A ritual is measured from its recurring task's completions — the binding is
 * what the capacity refresh reads adherence through. Until this screen offered
 * the task, it could be tied only through the adoption queue, which a recurring
 * task does not reach, so a ritual read *not measured yet* for ever.
 */

/** One task a ritual can be measured from, as the select offers it. */
export interface RitualTaskOption {
  readonly id: string;
  readonly title: string;
  /** Whether its location maps to the ritual's own area — those come first. */
  readonly ownArea: boolean;
  /** What else in prisme holds it, in words; such a task cannot be chosen. */
  readonly takenBy: string | null;
}

export type RitualTaskChoice =
  | {
      readonly state: 'unreadable';
      readonly failure: string;
      readonly current: string | null;
    }
  | {
      readonly state: 'choose';
      readonly options: readonly RitualTaskOption[];
      /** The current task, when it is one of the options. */
      readonly chosen: string | null;
      /**
       * The current task when it is **not** among them — completed, deleted, or
       * no longer recurring. Kept, by identifier, until somebody changes it.
       */
      readonly elsewhere: string | null;
    };

function holderWords(
  heldBy: { kind: string; id: string },
  ritualNameOf: (id: string) => string | undefined,
): string {
  switch (heldBy.kind) {
    case 'ritual': {
      const name = ritualNameOf(heldBy.id);
      return name === undefined ? 'another ritual' : `the ritual ${name}`;
    }
    case 'initiative':
      return 'an initiative';
    case 'key_result':
      return 'a key result';
    default:
      return 'something else in prisme';
  }
}

/**
 * The choice for one ritual — or for a ritual not defined yet, with no `id`.
 *
 * Tasks whose location maps to the ritual's area come first, then the rest by
 * title: a recurring task is usually named for the action ("stretch") rather
 * than the habit, and may sit in another area's project, so none is hidden.
 */
export function ritualTaskChoice(
  ritual: { readonly id?: string | undefined; readonly areaKey: string },
  current: string | null,
  tasks: RecurringTasks | null,
  ritualNameOf: (id: string) => string | undefined,
): RitualTaskChoice {
  if (tasks === null || tasks.failure !== null) {
    return { state: 'unreadable', failure: tasks?.failure ?? 'unavailable', current };
  }
  const options = tasks.items
    .map((task) => ({
      id: task.id,
      title: task.title,
      ownArea: task.areaKey === ritual.areaKey,
      takenBy:
        task.heldBy === null || (task.heldBy.kind === 'ritual' && task.heldBy.id === ritual.id)
          ? null
          : holderWords(task.heldBy, ritualNameOf),
    }))
    .sort((left, right) => Number(right.ownArea) - Number(left.ownArea));
  const listed = current !== null && options.some((option) => option.id === current);
  return {
    state: 'choose',
    options,
    chosen: listed ? current : null,
    elsewhere: listed ? null : current,
  };
}

/** The title of a ritual's task, when the tool listed it. */
export function taskTitleOf(tasks: RecurringTasks | null, id: string | null): string | null {
  if (id === null || tasks === null) return null;
  return tasks.items.find((task) => task.id === id)?.title ?? null;
}

const PERIOD_NAME: Readonly<Record<Ritual['cadence'], string>> = {
  daily: 'This week',
  weekly: 'This week',
  monthly: 'This month',
  quarterly: 'This quarter',
  yearly: 'This year',
};

/**
 * The period a habit that is not a task is recorded in, as a line.
 *
 * A daily habit counts days in its week; every other cadence has one chance a
 * period, so it is either done or not yet.
 */
export function periodLine(
  cadence: Ritual['cadence'],
  period: Ritual['currentPeriod'],
): { readonly label: string; readonly status: string } {
  const status =
    period.opportunities > 1
      ? `${String(period.completions)} of ${String(period.opportunities)} days`
      : period.completions >= period.opportunities
        ? 'done'
        : 'not yet';
  return { label: PERIOD_NAME[cadence], status };
}

/** The completions after one more, or one fewer — never outside 0 … opportunities. */
export function stepCompletions(period: Ritual['currentPeriod'], step: 1 | -1): number {
  return Math.min(period.opportunities, Math.max(0, period.completions + step));
}
