import type { Replan, TimelineEntry } from './contracts';
import { dayOf } from './timeline-scale';

/**
 * What the Timeline decides, as pure functions.
 *
 * The screen renders a plan it did not compute. What is left over is grouping,
 * ordering, the sentence beside each bar, and the arithmetic of "how many of
 * this area's slots are in use on this day" — and every one of those is a rule
 * worth testing without a browser, as W08 established for Focus and W09 for the
 * KPI dashboard.
 *
 * ## `boundBy` is rendered as a sentence, and that is not paraphrasing
 *
 * `apps/web/CLAUDE.md` says to display the API's `explain` rather than
 * restating it. That rule is about the *score*, which arrives with a sentence
 * the method wrote. A date arrives with an enum — `dependency`,
 * `earliest_start`, `capacity`, `none` — and an enum has to become English
 * somewhere. It becomes English here, once, in a tested function, rather than
 * in four places in the markup.
 *
 * The sentence names the constraint and nothing else. It never says a date is
 * *right*, and it never explains a deadline: prisme flags an impossible
 * deadline and never moves one (ADR-0003), so the deadline copy is about
 * feasibility, never about a plan the deadline should bend to.
 */

export type GroupBy = 'area' | 'project';

export interface TimelineRow extends TimelineEntry {
  /** The dates actually drawn: the plan's, or a preview's while one is open. */
  readonly start: string;
  readonly end: string;
  /** True when a preview moved this row from where the plan has it. */
  readonly moved: boolean;
  /** True for the one row a preview was asked about. */
  readonly isMoveTarget: boolean;
}

export interface TimelineGroup {
  readonly key: string;
  readonly label: string;
  /** `null` for a project group, which has no area colour of its own. */
  readonly areaKey: string | null;
  readonly kind: 'area' | 'run' | 'signals' | 'project';
  readonly rows: readonly TimelineRow[];
}

/** The plan as rows, before any preview is applied. */
export function toRows(entries: readonly TimelineEntry[]): readonly TimelineRow[] {
  return entries.map((entry) => ({
    ...entry,
    start: entry.plannedStart,
    end: entry.plannedEnd,
    moved: false,
    isMoveTarget: false,
  }));
}

/**
 * Overlay a preview on the plan.
 *
 * The dates substituted here all came from the API's replan — nothing on this
 * side works out where a bar lands. That is the whole reason the preview is a
 * request rather than an optimistic local calculation: a preview the browser
 * computed is a preview that can disagree with what gets saved, which is the
 * specific failure both the brief and W02's journal warn about.
 */
export function applyPreview(
  rows: readonly TimelineRow[],
  preview: Replan | null,
): readonly TimelineRow[] {
  if (preview === null) return rows;

  const shifted = new Map(preview.shifted.map((entry) => [entry.initiativeId, entry]));
  return rows.map((row) => {
    const shift = shifted.get(row.initiativeId);
    if (shift === undefined) {
      return { ...row, moved: false, isMoveTarget: row.initiativeId === preview.move.initiativeId };
    }
    return {
      ...row,
      start: shift.toStart,
      end: shift.toEnd,
      moved: true,
      isMoveTarget: row.initiativeId === preview.move.initiativeId,
    };
  });
}

/**
 * Which deadlines are impossible in what is currently drawn.
 *
 * Read from the preview when one is open, because the plan's own flags describe
 * the plan the preview is replacing — showing those beside previewed bars would
 * tell a reader the move is safe at the exact moment it is not.
 */
export function infeasibleIn(
  entries: readonly TimelineEntry[],
  preview: Replan | null,
): ReadonlySet<string> {
  if (preview !== null) return new Set(preview.after.infeasibleDeadlines);
  return new Set(entries.filter((entry) => !entry.deadlineFeasible).map((e) => e.initiativeId));
}

/** Likewise for the critical path, which a move can re-route. */
export function criticalIn(
  timelineCritical: readonly string[],
  preview: Replan | null,
): ReadonlySet<string> {
  return new Set(preview === null ? timelineCritical : preview.after.criticalPath);
}

export interface GroupInput {
  readonly rows: readonly TimelineRow[];
  readonly groupBy: GroupBy;
  readonly areas: ReadonlyMap<string, { name: string; kind: 'area' | 'run' | 'signals' }>;
  readonly projects: ReadonlyMap<string, string>;
}

const UNGROUPED_PROJECT = '__no_project__';

/**
 * Rows into lanes.
 *
 * Groups are ordered by their earliest bar, so the eye starts at the top-left
 * and reads down and to the right; within a group the same rule applies, with
 * the id as the tie-break so two identical starts never swap between renders.
 * Ordering by name instead would put the plan's shape at the mercy of what
 * somebody called an area.
 */
export function groupRows({
  rows,
  groupBy,
  areas,
  projects,
}: GroupInput): readonly TimelineGroup[] {
  const buckets = new Map<string, TimelineRow[]>();
  for (const row of rows) {
    const key = groupBy === 'area' ? row.areaKey : (row.projectId ?? UNGROUPED_PROJECT);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [row]);
    else bucket.push(row);
  }

  const groups: TimelineGroup[] = [];
  for (const [key, bucket] of buckets) {
    const area = areas.get(key);
    groups.push({
      key,
      label:
        groupBy === 'area'
          ? (area?.name ?? key)
          : key === UNGROUPED_PROJECT
            ? 'No project'
            : (projects.get(key) ?? 'Unknown project'),
      areaKey: groupBy === 'area' ? key : null,
      kind: groupBy === 'area' ? (area?.kind ?? 'area') : 'project',
      rows: [...bucket].sort(byStartThenId),
    });
  }

  return groups.sort((left, right) => {
    const first = earliestOf(left.rows) - earliestOf(right.rows);
    if (first !== 0) return first;
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
}

function byStartThenId(left: TimelineRow, right: TimelineRow): number {
  const start = dayOf(left.start) - dayOf(right.start);
  if (start !== 0) return start;
  return left.initiativeId < right.initiativeId ? -1 : 1;
}

function earliestOf(rows: readonly TimelineRow[]): number {
  return rows.reduce((first, row) => Math.min(first, dayOf(row.start)), Number.POSITIVE_INFINITY);
}

/** The span every bar fits inside, so the axis covers the plan and no more. */
export function spanOf(
  rows: readonly TimelineRow[],
  fallback: { from: string; to: string },
): { from: string; to: string } {
  if (rows.length === 0) return fallback;
  let from = rows[0]?.start ?? fallback.from;
  let to = rows[0]?.end ?? fallback.to;
  for (const row of rows) {
    if (dayOf(row.start) < dayOf(from)) from = row.start;
    if (dayOf(row.end) > dayOf(to)) to = row.end;
    // A deadline outside the plan still has to be drawn, or the marker for the
    // one deadline that cannot be met sits off the right-hand edge.
    if (row.deadline !== null && dayOf(row.deadline) > dayOf(to)) to = row.deadline;
  }
  return { from, to };
}

/* -------------------------------------------------------------------------
 * Explaining a date
 * ---------------------------------------------------------------------- */

export interface Explanation {
  /** Why it starts when it does. One sentence, always present. */
  readonly why: string;
  /** What the slack says. */
  readonly slack: string;
  /** Deadline feasibility, or `null` when there is no deadline to miss. */
  readonly deadline: string | null;
}

export interface ExplainContext {
  readonly titleById: ReadonlyMap<string, string>;
  readonly areaName: string;
  /** Concurrent initiatives the area may run, from the year's weights. */
  readonly areaSlots: number;
  readonly onCriticalPath: boolean;
}

function list(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'something not in the plan';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * Why this bar starts where it starts, in one sentence.
 *
 * The brief is specific that this belongs on the screen rather than in a
 * tooltip nobody finds: a Gantt chart that cannot explain itself gets
 * overridden once and then ignored forever, at which point the plan is
 * decoration.
 */
export function explain(entry: TimelineEntry, context: ExplainContext): Explanation {
  const why = ((): string => {
    switch (entry.boundBy) {
      case 'dependency': {
        const names = entry.boundByIds.map(
          (id) => context.titleById.get(id) ?? 'something not in the plan',
        );
        return `It waits on ${list(names)}: it starts the working day after the last of them finishes.`;
      }
      case 'earliest_start':
        return `It is held to ${entry.earliestStart}, the earliest start set on it — nothing in the plan is stopping it sooner.`;
      case 'capacity':
        return `${context.areaName} was already running its ${String(context.areaSlots)} ${context.areaSlots === 1 ? 'initiative' : 'initiatives'}, so this took the next slot to come free. The year's weights decide how many an area gets (ADR-0005).`;
      case 'none':
        return 'Nothing holds it back. It starts on the first working day of the plan.';
    }
  })();

  const slack = context.onCriticalPath
    ? 'On the critical path: a day lost here is a day lost on the whole plan.'
    : entry.slackDays === 0
      ? 'No slack: it can start later only by moving something else.'
      : `${String(entry.slackDays)} working ${entry.slackDays === 1 ? 'day' : 'days'} of slack before it starts to push something.`;

  const deadline =
    entry.deadline === null
      ? null
      : entry.deadlineFeasible
        ? `Due ${entry.deadline}, and the plan meets it with ${String(entry.deadlineSlackDays ?? 0)} working days to spare.`
        : `Due ${entry.deadline}, and the plan misses it by ${String(Math.abs(entry.deadlineSlackDays ?? 0))} working days. prisme flags this; it never moves a deadline to make a plan work.`;

  return { why, slack, deadline };
}

/* -------------------------------------------------------------------------
 * Capacity
 * ---------------------------------------------------------------------- */

export interface CapacityBand {
  readonly areaKey: string;
  readonly fromDay: number;
  /** Exclusive. */
  readonly toDay: number;
  readonly running: number;
  readonly slots: number;
}

/**
 * Where an area is running every slot it has.
 *
 * Counted from the bars, not derived from the weights a second time: the API
 * serves each area's slot count with the plan, and this walks the days between
 * the plan's ends counting how many of that area's bars cover each one. The
 * schedule engine will not *overrun* a slot count — capacity is a constraint it
 * enforces — so what this finds is the periods where the constraint was
 * binding, which is precisely what makes a `boundBy: 'capacity'` delay legible
 * rather than mysterious.
 *
 * Adjacent days at the same level are merged, so the overlay is a handful of
 * bands rather than one rectangle per day.
 */
export function capacityBands(
  rows: readonly TimelineRow[],
  slotsByArea: ReadonlyMap<string, number>,
): readonly CapacityBand[] {
  const byArea = new Map<string, TimelineRow[]>();
  for (const row of rows) {
    const bucket = byArea.get(row.areaKey);
    if (bucket === undefined) byArea.set(row.areaKey, [row]);
    else bucket.push(row);
  }

  const bands: CapacityBand[] = [];
  for (const [areaKey, areaRows] of byArea) {
    const slots = slotsByArea.get(areaKey);
    if (slots === undefined) continue;

    const first = Math.min(...areaRows.map((row) => dayOf(row.start)));
    const last = Math.max(...areaRows.map((row) => dayOf(row.end)));

    let openedAt: number | null = null;
    let level = 0;
    for (let day = first; day <= last + 1; day += 1) {
      const running = areaRows.filter(
        (row) => dayOf(row.start) <= day && day <= dayOf(row.end),
      ).length;
      const full = running >= slots && day <= last;

      if (full && openedAt === null) {
        openedAt = day;
        level = running;
      } else if (full && running !== level) {
        bands.push({ areaKey, fromDay: openedAt ?? day, toDay: day, running: level, slots });
        openedAt = day;
        level = running;
      } else if (!full && openedAt !== null) {
        bands.push({ areaKey, fromDay: openedAt, toDay: day, running: level, slots });
        openedAt = null;
      }
    }
  }

  return bands.sort((left, right) =>
    left.areaKey === right.areaKey
      ? left.fromDay - right.fromDay
      : left.areaKey < right.areaKey
        ? -1
        : 1,
  );
}

/* -------------------------------------------------------------------------
 * The preview, as prose
 * ---------------------------------------------------------------------- */

export interface PreviewSummary {
  /** What happened to the initiative that was dragged. */
  readonly headline: string;
  /** Whether the plan gave the requested day. */
  readonly honoured: boolean;
  readonly downstream: readonly string[];
  readonly broken: readonly string[];
  readonly repaired: readonly string[];
  /** True when there is nothing to commit. */
  readonly empty: boolean;
}

function titleOf(titles: ReadonlyMap<string, string>, id: string): string {
  return titles.get(id) ?? 'an initiative not in this plan';
}

/**
 * The diff, in the words a person needs before they commit it.
 *
 * Every number here is the API's. The rule the summary exists to enforce is
 * that a move is a *request*: a dependency or a full area can refuse the day
 * that was dropped on, and saying so plainly is better than silently drawing
 * the bar somewhere other than where it was let go.
 */
export function previewSummary(
  preview: Replan,
  titles: ReadonlyMap<string, string>,
): PreviewSummary {
  const moved = preview.shifted.find((entry) => entry.initiativeId === preview.move.initiativeId);
  const name = titleOf(titles, preview.move.initiativeId);

  const headline = preview.move.honoured
    ? moved === undefined
      ? `${name} is already planned to start on ${preview.move.requestedStart}. Nothing would change.`
      : `${name} starts ${preview.move.requestedStart} instead of ${moved.fromStart}.`
    : `${name} cannot start ${preview.move.requestedStart}. The plan puts it at ${preview.move.actualStart}, held by ${boundByPhrase(preview.move.boundBy)}.`;

  const downstream = preview.shifted
    .filter((entry) => entry.isDownstream)
    .map(
      (entry) =>
        `${titleOf(titles, entry.initiativeId)} moves ${describeDelta(entry.startDeltaDays)}, to ${entry.toStart}.`,
    );

  return {
    headline,
    honoured: preview.move.honoured,
    downstream,
    broken: preview.brokenDeadlines.map(
      (id) => `${titleOf(titles, id)} can no longer meet its deadline.`,
    ),
    repaired: preview.repairedDeadlines.map(
      (id) => `${titleOf(titles, id)} can meet its deadline again.`,
    ),
    empty: preview.shifted.length === 0,
  };
}

function describeDelta(days: number): string {
  const magnitude = Math.abs(days);
  const unit = magnitude === 1 ? 'working day' : 'working days';
  return days > 0 ? `${String(magnitude)} ${unit} later` : `${String(magnitude)} ${unit} earlier`;
}

export function boundByPhrase(boundBy: TimelineEntry['boundBy']): string {
  switch (boundBy) {
    case 'dependency':
      return 'something it depends on';
    case 'earliest_start':
      return 'its earliest start';
    case 'capacity':
      return 'its area having no free slot';
    case 'none':
      return 'nothing — it is unconstrained';
  }
}

export const BOUND_BY_LABEL: Readonly<Record<TimelineEntry['boundBy'], string>> = {
  dependency: 'Dependency',
  earliest_start: 'Earliest start',
  capacity: 'Capacity',
  none: 'Unconstrained',
};
