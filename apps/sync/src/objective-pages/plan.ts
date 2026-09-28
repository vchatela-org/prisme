import type { DocPropertyValue } from '@prisme/connectors';
import { objectiveDatesOf, type CalendarDate, type ObjectiveType } from '@prisme/domain';
import {
  lastAppliedKey,
  type ConflictRecord,
  type LastAppliedIndex,
  type LastAppliedWrite,
} from '../reconcile/types.js';

/**
 * An objective's period, reconciled into its page's date column (ADR-0034).
 *
 * The document-tool half of the reconciler, and the same shape as the task-tool
 * half: **desired** is prisme's objectives, **observed** is a full read of the
 * objectives store, **lastApplied** is what prisme last wrote into each page's
 * date column — and nothing here has a clock, a connection or a random number,
 * so every rule below is decided against plain values and tested that way.
 *
 * The period is prisme's (docs/11-ownership.md §6) and the date column is its
 * outward form, so a difference is always resolved **towards prisme**. What
 * `lastApplied` decides is only what the difference *was*:
 *
 * | The page holds | prisme last wrote | Verdict |
 * |---|---|---|
 * | the objective's dates | — | `in_sync`, nothing sent |
 * | something else | nothing yet | `update`: prisme states its value the first time |
 * | something else | what the page holds | `update`: prisme changed its mind |
 * | something else | something else again | `conflict`: someone edited the column by hand; prisme's value is restored and the edit goes to the ledger (docs/16-sync.md §4) |
 *
 * And five cases where nothing is sent and the report says why: the page is
 * not an entry of the objectives store, it is in the trash, it has no date
 * column by the chosen name, two objectives name the same page, or the period
 * is not written the way its type says. None of them is guessed around.
 */

/** `last_applied.entity_kind` for a page's date column: keyed by the page, as an anchor is. */
export const OBJECTIVE_PAGE = 'objective_page';
export const PAGE_DATES_FIELD = 'dates';

/** One objective with a linked page. `title` is instance data, printed and never committed. */
export interface LinkedObjective {
  readonly objectiveId: string;
  readonly title: string;
  readonly type: ObjectiveType;
  readonly period: string;
  /** `objective.external_page_id`, as stored. */
  readonly pageId: string;
}

/** One entry of the objectives store, as the full read found it. */
export interface ObservedEntry {
  /** The page's id as the tool returned it — what a write is sent to. */
  readonly pageId: string;
  readonly archived: boolean;
  /**
   * The date column, as {@link datesValue} writes one. `null` for an empty
   * date; `undefined` when the entry holds no date property by that name.
   */
  readonly dates: string | null | undefined;
}

export type ObjectivePageVerdict =
  | 'update'
  | 'conflict'
  | 'in_sync'
  | 'not_in_store'
  | 'trashed'
  | 'no_column'
  | 'shared_page'
  | 'unwritable_period';

export const OBJECTIVE_PAGE_VERDICTS: readonly ObjectivePageVerdict[] = [
  'conflict',
  'update',
  'not_in_store',
  'trashed',
  'no_column',
  'shared_page',
  'unwritable_period',
  'in_sync',
];

export interface ObjectivePageAction {
  readonly verdict: ObjectivePageVerdict;
  readonly objectiveId: string;
  readonly title: string;
  readonly pageId: string;
  /** Present on `update` and `conflict`: the one call to make. */
  readonly write?:
    | { readonly pageId: string; readonly startsOn: CalendarDate; readonly endsOn: CalendarDate }
    | undefined;
  readonly lastApplied: readonly LastAppliedWrite[];
  readonly conflict?: ConflictRecord | undefined;
  /** What the line says, in prisme's vocabulary: `2028-01-01/2028-12-31 → 2027-01-01/2027-12-31`. */
  readonly detail: string;
}

export interface ObjectivePagePlan {
  readonly actions: readonly ObjectivePageAction[];
  readonly counts: Readonly<Record<ObjectivePageVerdict, number>>;
}

/** A period's two days, in one comparable string — ISO 8601's interval form. */
export function datesValue(startsOn: string, endsOn: string): string {
  return `${startsOn}/${endsOn}`;
}

/**
 * A date property's value in {@link datesValue}'s form.
 *
 * A single date is written as the day alone, so it never equals a period's
 * range and is replaced by one. Anything that is not a date property is
 * `undefined` — the column is gone or retyped, and that is a finding, not a
 * value to overwrite.
 */
export function observedDatesOf(value: DocPropertyValue | undefined): string | null | undefined {
  if (value?.kind !== 'date') return undefined;
  if (value.start === null) return null;
  return value.end === null ? value.start : datesValue(value.start, value.end);
}

function verdictOf(
  desired: string,
  observed: string | null,
  last: string | null | undefined,
): 'in_sync' | 'update' | 'conflict' {
  if (desired === observed) return 'in_sync';
  if (last === undefined) return 'update';
  return observed === last ? 'update' : 'conflict';
}

export interface ObjectivePagePlannerConfig {
  /**
   * The form two page ids are compared in — `docIdKey` from the connectors,
   * handed in rather than imported so this file holds no runtime dependency
   * and stays under the planner-purity lint rule. The tool writes one id two
   * ways, dashed and bare, and a stored link may be either.
   */
  readonly pageKey: (id: string) => string;
}

export function planObjectivePages(
  objectives: readonly LinkedObjective[],
  entries: readonly ObservedEntry[],
  lastApplied: LastAppliedIndex,
  config: ObjectivePagePlannerConfig,
): ObjectivePagePlan {
  const docIdKey = config.pageKey;
  const entryByPage = new Map(entries.map((entry) => [docIdKey(entry.pageId), entry]));

  const linksPerPage = new Map<string, number>();
  for (const objective of objectives) {
    const key = docIdKey(objective.pageId);
    linksPerPage.set(key, (linksPerPage.get(key) ?? 0) + 1);
  }

  // Sorted, so two runs over the same state print the same plan in the same order.
  const sorted = [...objectives].sort((left, right) =>
    left.objectiveId < right.objectiveId ? -1 : left.objectiveId > right.objectiveId ? 1 : 0,
  );

  const actions = sorted.map((objective): ObjectivePageAction => {
    const pageKey = docIdKey(objective.pageId);
    const base = {
      objectiveId: objective.objectiveId,
      title: objective.title,
      pageId: objective.pageId,
      lastApplied: [],
    };

    // One page, one objective: two periods for one column would be written in
    // turn on every pass, each undoing the other.
    if ((linksPerPage.get(pageKey) ?? 0) > 1) {
      return { ...base, verdict: 'shared_page', detail: 'another objective links the same page' };
    }

    const dates = objectiveDatesOf(objective.type, objective.period);
    if (dates === undefined) {
      return {
        ...base,
        verdict: 'unwritable_period',
        detail: `${objective.type} ${objective.period} is not a period its type names`,
      };
    }

    const entry = entryByPage.get(pageKey);
    if (entry === undefined) {
      return { ...base, verdict: 'not_in_store', detail: 'the page is not an entry of the store' };
    }
    if (entry.archived) {
      return { ...base, verdict: 'trashed', detail: 'the page is in the trash' };
    }
    if (entry.dates === undefined) {
      return { ...base, verdict: 'no_column', detail: 'the page has no date column by that name' };
    }

    const desired = datesValue(dates.startsOn, dates.endsOn);
    const lastKey = lastAppliedKey(OBJECTIVE_PAGE, pageKey, PAGE_DATES_FIELD);
    const verdict = verdictOf(desired, entry.dates, lastApplied.get(lastKey)?.value);
    const change = `${entry.dates ?? 'no date'} → ${desired}`;

    if (verdict === 'in_sync') return { ...base, verdict, detail: desired };

    return {
      ...base,
      verdict,
      write: { pageId: entry.pageId, startsOn: dates.startsOn, endsOn: dates.endsOn },
      lastApplied: [
        { entityKind: OBJECTIVE_PAGE, entityId: pageKey, field: PAGE_DATES_FIELD, value: desired },
      ],
      ...(verdict === 'conflict'
        ? {
            conflict: {
              entityId: objective.objectiveId,
              field: 'period',
              prismeValue: desired,
              externalValue: entry.dates,
              resolution: 'prisme_wins' as const,
            },
          }
        : {}),
      detail:
        verdict === 'conflict'
          ? `dates edited in the page; prisme owns the period — ${change}`
          : `dates ${change}`,
    };
  });

  const counts = Object.fromEntries(
    OBJECTIVE_PAGE_VERDICTS.map((verdict) => [verdict, 0]),
  ) as Record<ObjectivePageVerdict, number>;
  for (const action of actions) counts[action.verdict] += 1;

  return { actions, counts };
}

const VERDICT_WIDTH = 18;
const TITLE_WIDTH = 44;

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function clip(text: string, width: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= width ? pad(single, width) : `${single.slice(0, width - 1)}…`;
}

/**
 * The plan, rendered — the reconciler's format, and its rule: **real output is
 * instance data** (every title), printed to a terminal and never pasted into
 * this repository (docs/17-privacy.md).
 */
export function formatObjectivePagePlan(plan: ObjectivePagePlan): string {
  const lines = ['objective pages'];
  const shown = OBJECTIVE_PAGE_VERDICTS.filter((verdict) => verdict !== 'in_sync').flatMap(
    (verdict) => plan.actions.filter((action) => action.verdict === verdict),
  );
  if (shown.length === 0) {
    lines.push('  nothing to do: every linked page carries its objective’s period');
  } else {
    for (const action of shown) {
      lines.push(
        `  ${pad(action.verdict, VERDICT_WIDTH)}${clip(action.title, TITLE_WIDTH)}  ${action.detail}`,
      );
    }
  }
  const { counts } = plan;
  const unwritten =
    counts.not_in_store +
    counts.trashed +
    counts.no_column +
    counts.shared_page +
    counts.unwritable_period;
  lines.push(
    `Objective pages: ${String(counts.update)} to update, ${String(counts.conflict)} ${
      counts.conflict === 1 ? 'conflict' : 'conflicts'
    }, ${String(unwritten)} not writable, ${String(counts.in_sync)} unchanged.`,
  );
  return lines.join('\n');
}
