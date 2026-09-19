import type { AreaSlot, FocusEntry, SelectionReason } from './contracts';

/**
 * The arithmetic and the wording Focus is drawn from — pure, and tested.
 *
 * Nothing here computes a score, a rank or a date. Those arrive from the API
 * already decided (`apps/web/CLAUDE.md` non-negotiable 1); what this module
 * does is group, count days, and turn an enum into the sentence a person
 * reads. All three are the kind of thing that quietly differs between two
 * screens if each writes its own, which is why they are one module with tests
 * rather than three inline helpers.
 */

/**
 * How long an initiative may sit in `now` untouched before Focus says so.
 *
 * Seven days because the weekly review is the cadence this is measured
 * against: something in `now` that no task moved between one review and the
 * next is usually blocked or wrongly sized, and surfacing that early is most
 * of what the review is for (`docs/40-workstreams/W08-ui-focus.md`).
 *
 * It is a parameter of every function below rather than a constant they read,
 * for the same reason `packages/domain` takes its clock as an argument: a
 * threshold reached for implicitly is a threshold nobody can test at another
 * value. This default belongs in `@prisme/config` the day it needs to differ
 * per instance — see the journal entry's follow-ups.
 */
export const STALE_AFTER_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between an instant and now, or null if there is no instant.
 *
 * Negative is clamped to zero: an activity timestamp in the future is a clock
 * disagreeing with another clock, and "active 2 days from now" is a worse
 * thing to print than "active today".
 */
export function daysSince(instant: string | null, now: Date): number | null {
  if (instant === null) return null;
  const then = Date.parse(instant);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / MS_PER_DAY));
}

export interface Staleness {
  /** Days since the last task moved under this initiative. Null when nothing ever has. */
  readonly idleDays: number | null;
  readonly stale: boolean;
  /** What the badge says. Empty when the initiative is not stale. */
  readonly label: string;
}

/**
 * How stale an entry is.
 *
 * An initiative with **no** activity at all is stale from the day it enters
 * `now` and is aged by `createdAt` instead — it is precisely the case worth
 * surfacing, and treating "never touched" as "not yet stale" would hide it
 * forever.
 */
export function stalenessOf(entry: FocusEntry, now: Date, thresholdDays: number): Staleness {
  const activity = entry.initiative.rollup.lastActivity;
  const idleDays = daysSince(activity ?? entry.initiative.createdAt, now);

  if (idleDays === null || idleDays < thresholdDays) {
    return { idleDays, stale: false, label: '' };
  }

  return {
    idleDays,
    stale: true,
    label:
      activity === null
        ? `No task has ever moved here — ${String(idleDays)} days old`
        : `No activity for ${String(idleDays)} days`,
  };
}

export interface AreaGroup {
  readonly areaKey: string;
  readonly entries: readonly FocusEntry[];
  /** The area's slot line, when the API sent one for it. */
  readonly slot: AreaSlot | undefined;
}

/**
 * Group ranked entries by area **without reordering them**.
 *
 * Areas appear in the order their best-ranked entry does, and entries keep the
 * order the API sent. Sorting here would produce a second ordering of the same
 * data — the thing `docs/12-scoring.md` and the backlog endpoint both refuse —
 * and the list somebody reads must be the list that chose their week.
 */
export function groupByArea(
  entries: readonly FocusEntry[],
  slots: readonly AreaSlot[],
): readonly AreaGroup[] {
  const order: string[] = [];
  const byArea = new Map<string, FocusEntry[]>();

  for (const entry of entries) {
    const key = entry.initiative.areaKey;
    let bucket = byArea.get(key);
    if (bucket === undefined) {
      bucket = [];
      byArea.set(key, bucket);
      order.push(key);
    }
    bucket.push(entry);
  }

  return order.map((areaKey) => ({
    areaKey,
    entries: byArea.get(areaKey) ?? [],
    slot: slots.find((slot) => slot.areaKey === areaKey),
  }));
}

/**
 * Why an entry is where it is, in words.
 *
 * These describe `selectNowSet`'s reasons and nothing else. They are wording,
 * not logic: no sentence here re-derives a decision, each one reports the one
 * the domain package already made.
 */
export function reasonSentence(reason: SelectionReason): string {
  switch (reason) {
    case 'in_flight':
      return 'Already in flight — in-flight work keeps its slot whatever it scores.';
    case 'selected':
      return 'Selected: it was top of the ranking and its area had a slot free.';
    case 'area_at_cap':
      return 'Its area is already at its cap. Finishing something there frees the slot.';
    case 'wip_full':
      return 'Every slot is taken. This is the next one in, when one frees.';
    case 'blocked':
      return 'Waiting on something that is neither done nor dropped.';
    case 'too_large':
      return 'Too large to start as it stands — split it into something finishable.';
    case 'not_a_candidate':
      return 'Not a candidate for now: its status puts it outside the selection.';
  }
}

/** The deadline line beside an entry, or null when it has no deadline. */
export function deadlineSentence(days: number | null, atRisk: boolean): string | null {
  if (days === null) return null;

  const when =
    days < 0
      ? `${String(Math.abs(days))} days past its deadline`
      : days === 0
        ? 'Deadline today'
        : `${String(days)} days to its deadline`;

  // "At risk" is the schedule engine's answer, not a day threshold applied
  // here — prisme flags an infeasible deadline and never moves one (ADR-0003).
  return atRisk ? `${when} — the schedule says that is not reachable` : when;
}

export interface DueSummary {
  readonly dueToday: number;
  readonly overdue: number;
  readonly open: number;
}

/**
 * What the mirrored task subtree says about today.
 *
 * **Counts, not titles** — and not because it would be hard. A mirrored task
 * carries no text at all: the words belong to the task tool and prisme holds
 * the structure, the state and the dates (docs/11-ownership.md §5). So Focus
 * can say "two due today, one late" and the task tool says which, which is
 * also the division that keeps somebody's task titles out of this application
 * entirely.
 *
 * `due` is read here and never written: prisme writes `deadline`, the task tool
 * owns `due` (ADR-0003).
 */
export function dueSummary(
  tasks: readonly { completed: boolean; due: string | null }[],
  today: string,
): DueSummary {
  let dueToday = 0;
  let overdue = 0;
  let open = 0;

  for (const task of tasks) {
    if (task.completed) continue;
    open += 1;
    if (task.due === null) continue;
    if (task.due === today) dueToday += 1;
    else if (task.due < today) overdue += 1;
  }

  return { dueToday, overdue, open };
}

/** Task counts per initiative id, as the Focus page assembles them. */
export type DueSummaryMap = Record<string, DueSummary>;

/** The calendar day an instant falls on, in UTC, as `YYYY-MM-DD`. */
export function dayOf(instant: string): string {
  return instant.slice(0, 10);
}

/** The slot lines, lanes last: Run and Signals are context, not the subject. */
export function orderSlots(slots: readonly AreaSlot[]): readonly AreaSlot[] {
  return [...slots].sort((left, right) => {
    const rank = (slot: AreaSlot): number => (slot.kind === 'area' ? 0 : 1);
    return rank(left) - rank(right) || left.areaKey.localeCompare(right.areaKey);
  });
}
