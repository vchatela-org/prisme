import type { Completion, CompletionEvent, TaskToolClient } from '@prisme/connectors';

/**
 * One window of completions, from the two records the task tool keeps of them
 * ([ADR-0040](../../../../docs/20-decisions/0040-completions-are-read-from-the-activity-log.md)).
 *
 * ## Why two
 *
 * The **completion history** (`fetchCompletions`) lists tasks that became
 * *checked*. A recurring task never is — completing it moves its date — so a
 * daily routine done thirty times in a month appears there zero times. The
 * **activity log** (`fetchCompletionEvents`) has one entry per completion,
 * occurrences included. It is the source of *which* completions happened.
 *
 * The completion history stays, for what the log does not carry: a one-off
 * task's recorded duration, its section, and the exact `completed_at` the rows
 * already held before this read existed. Keeping that instant is what makes a
 * re-run over history stored by the earlier reader **converge rather than
 * double**: a one-off completion keeps the key `(external_task_id,
 * completed_at)` it was first stored under, and only the occurrences the
 * history never listed are added.
 *
 * ## The rule, in order
 *
 * 1. **An un-completion takes back the latest completion of the same task
 *    before it**, inside the read. One with nothing before it in the read is
 *    ignored: the completion it takes back is outside the window, and was or
 *    will be judged by the read that holds it.
 * 2. **Per task, the history's entries pair with the log's standing
 *    completions from the latest backwards, never more than `READ_MARGIN_MS`
 *    apart.** A one-off task is listed in the history once, at its last
 *    completion, and that is the log's last standing completion of it. A paired
 *    completion is the history's entry, unchanged. The instants are not
 *    required to be equal: the log stamps when it logged and the history when
 *    the task was checked, and nothing documented says those agree to the
 *    millisecond. They are required to be within the margin, so that every
 *    read that sees one half of a pair also sees the other (below).
 * 3. **A log completion left unpaired is a completion of its own** — a
 *    recurring occurrence, almost always — keyed by the log's instant, located
 *    by the log's project and, when the entry carries one, its section. An
 *    entry without a section takes the open task's section **only while the
 *    open task is still in the project the entry names**; otherwise it is
 *    located by project alone. A task that has moved since is not guessed back.
 * 4. **A history entry left unpaired stands as it is.** The log's reach
 *    depends on the account's plan, and history it no longer reaches must not
 *    disappear because a newer reader looked.
 *
 * ## Why the read is wider than the window
 *
 * Both records are read `READ_MARGIN_MS` either side of the window, and only
 * completions keyed inside it are returned. Without the margin, a completion
 * logged a second after midnight and checked a second before it would sit in
 * two windows under two keys, each window seeing only half of the pair — and
 * be stored twice. With it, both halves are in every read that returns either
 * key. Only a pair whose two instants disagree by more than the margin — or
 * that straddle the edge of a read — can still be miscounted, by one; that is
 * a bound, and ADR-0040 says so. Where the two instants agree, none of this
 * arises.
 */

/** How far either side of a window both records are read. */
export const READ_MARGIN_MS = 86_400_000;

/** Where an open task is now. What a log entry without a section is located by. */
export interface OpenTaskLocation {
  readonly projectId: string;
  readonly sectionId?: string | undefined;
}

export interface MergeInput {
  /** The completion history, read over the widened window. */
  readonly history: readonly Completion[];
  /** The activity log's events, read over the widened window. */
  readonly events: readonly CompletionEvent[];
  /** Every open task's current location, by external id. */
  readonly openTasks: ReadonlyMap<string, OpenTaskLocation>;
  /** The window itself — inclusive at both ends, like a slice. */
  readonly since: Date;
  readonly until: Date;
}

export interface MergedCompletions {
  /** One per completion keyed inside the window, oldest first. */
  readonly completions: readonly Completion[];
  /** Of those, how many only the activity log reported: recurring occurrences, mostly. */
  readonly fromLogOnly: number;
  /** Log completions an un-completion took back, across the whole read. */
  readonly retracted: number;
}

const byTime = (a: { readonly at: Date }, b: { readonly at: Date }): number =>
  a.at.getTime() - b.at.getTime();

/** Rule 1: the log's completions left standing once every un-completion has taken one back. */
export function standingCompletions(events: readonly CompletionEvent[]): {
  readonly standing: readonly CompletionEvent[];
  readonly retracted: number;
} {
  // A stable sort keeps a completion ahead of an un-completion logged on the
  // same instant, which is the connector's order and the only sensible one.
  const ordered = [...events].sort(byTime);
  const open = new Map<string, CompletionEvent[]>();
  let retracted = 0;

  for (const event of ordered) {
    const stack = open.get(event.externalTaskId) ?? [];
    if (event.kind === 'completed') {
      stack.push(event);
      open.set(event.externalTaskId, stack);
    } else if (stack.pop() !== undefined) {
      retracted += 1;
    }
  }

  const standing = [...open.values()].flat().sort(byTime);
  return { standing, retracted };
}

/** Rule 3's location: the entry's own, then the open task's while it is in the same project. */
function locate(
  event: CompletionEvent,
  openTasks: ReadonlyMap<string, OpenTaskLocation>,
): { readonly projectId?: string; readonly sectionId?: string } {
  if (event.sectionId !== undefined) {
    return {
      ...(event.projectId === undefined ? {} : { projectId: event.projectId }),
      sectionId: event.sectionId,
    };
  }
  const open = openTasks.get(event.externalTaskId);
  if (event.projectId === undefined) {
    // The log named no project. The open task is the same task, so its place
    // is the only one on record — and an unattributed completion is what an
    // absent place would give anyway.
    return open === undefined
      ? {}
      : {
          projectId: open.projectId,
          ...(open.sectionId === undefined ? {} : { sectionId: open.sectionId }),
        };
  }
  if (open !== undefined && open.projectId === event.projectId && open.sectionId !== undefined) {
    return { projectId: event.projectId, sectionId: open.sectionId };
  }
  return { projectId: event.projectId };
}

function fromEvent(
  event: CompletionEvent,
  openTasks: ReadonlyMap<string, OpenTaskLocation>,
): Completion {
  return {
    externalTaskId: event.externalTaskId,
    completedAt: event.at,
    ...locate(event, openTasks),
    ...(event.content === undefined ? {} : { content: event.content }),
  };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item)) ?? [];
    group.push(item);
    groups.set(key(item), group);
  }
  return groups;
}

/** The whole rule, pure: two records in, one list of completions out. */
export function mergeCompletions(input: MergeInput): MergedCompletions {
  const { standing, retracted } = standingCompletions(input.events);

  // Within one read the history lists an instant once; two identical entries
  // would be one completion, and keeping both would break the pairing.
  const history = [
    ...new Map(
      input.history.map((c) => [`${c.externalTaskId}@${c.completedAt.toISOString()}`, c]),
    ).values(),
  ];

  const historyByTask = groupBy(history, (c) => c.externalTaskId);
  const logByTask = groupBy(standing, (e) => e.externalTaskId);
  const taskIds = new Set([...historyByTask.keys(), ...logByTask.keys()]);

  const merged: { readonly completion: Completion; readonly logOnly: boolean }[] = [];
  for (const taskId of taskIds) {
    const listed = [...(historyByTask.get(taskId) ?? [])].sort(
      (a, b) => a.completedAt.getTime() - b.completedAt.getTime(),
    );
    const logged = logByTask.get(taskId) ?? [];

    // Every history entry stands, paired or not (rules 2 and 4).
    for (const completion of listed) merged.push({ completion, logOnly: false });

    // Rule 2: pair from the latest backwards, never across more than the
    // margin. What the walk leaves on the log's side is rule 3's.
    let i = listed.length - 1;
    let j = logged.length - 1;
    while (j >= 0) {
      const event = logged[j] as CompletionEvent;
      const entry = i >= 0 ? (listed[i] as Completion) : undefined;
      if (entry === undefined) {
        merged.push({ completion: fromEvent(event, input.openTasks), logOnly: true });
        j -= 1;
      } else if (Math.abs(entry.completedAt.getTime() - event.at.getTime()) <= READ_MARGIN_MS) {
        i -= 1;
        j -= 1;
      } else if (entry.completedAt.getTime() > event.at.getTime()) {
        i -= 1;
      } else {
        merged.push({ completion: fromEvent(event, input.openTasks), logOnly: true });
        j -= 1;
      }
    }
  }

  const since = input.since.getTime();
  const until = input.until.getTime();
  const inside = merged
    .filter(({ completion }) => {
      const at = completion.completedAt.getTime();
      return at >= since && at <= until;
    })
    .sort(
      (a, b) =>
        a.completion.completedAt.getTime() - b.completion.completedAt.getTime() ||
        a.completion.externalTaskId.localeCompare(b.completion.externalTaskId),
    );

  return {
    completions: inside.map(({ completion }) => completion),
    fromLogOnly: inside.filter(({ logOnly }) => logOnly).length,
    retracted,
  };
}

/**
 * Where every open task is now, for rule 3. One full read per run, not per
 * window: a recurring task is open by definition, and this is the only place
 * its section is on record when the log's entry carries none.
 */
export async function readOpenTaskLocations(
  taskClient: TaskToolClient,
): Promise<ReadonlyMap<string, OpenTaskLocation>> {
  const snapshot = await taskClient.fetchAll();
  return new Map(
    snapshot.tasks.map((task) => [
      task.externalId,
      {
        projectId: task.projectId,
        ...(task.sectionId === undefined ? {} : { sectionId: task.sectionId }),
      },
    ]),
  );
}

/**
 * Read one window from both records, widened by the margin, and merge.
 *
 * Sequential rather than concurrent: both reads share one rate limit, and a
 * backfill holds the advisory lock for as long as it takes.
 */
export async function readCompletions(
  taskClient: TaskToolClient,
  window: { readonly since: Date; readonly until: Date },
  openTasks: ReadonlyMap<string, OpenTaskLocation>,
): Promise<MergedCompletions> {
  const from = new Date(window.since.getTime() - READ_MARGIN_MS);
  const to = new Date(window.until.getTime() + READ_MARGIN_MS);

  const history = await taskClient.fetchCompletions(from, to);
  // The log's upper bound is exclusive; one millisecond more makes the two
  // reads cover the same closed range.
  const events = await taskClient.fetchCompletionEvents(from, new Date(to.getTime() + 1));

  return mergeCompletions({
    history,
    events,
    openTasks,
    since: window.since,
    until: window.until,
  });
}
