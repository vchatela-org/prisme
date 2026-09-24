import type { DocToolClient, TaskToolClient } from '@prisme/connectors';
import { attribute, type AttributionResult } from './attribute.js';
import { reconstructAdherence } from './adherence.js';
import { declaredMinutesFromProcesses } from './processes.js';
import type { BackfillStore } from './ports.js';
import { formatBackfillReport } from './report.js';
import { planResume, SLICE_DAYS, type ResumePlan } from './slices.js';
import type { AdherencePeriod, CapacityWeek, RitualRecord, StoredCompletion } from './types.js';
import { dayText, startOfWeek, weeklyCapacity } from './weeks.js';

/**
 * One backfill pass.
 *
 * Two phases, and the split is the design rather than a tidying:
 *
 *   1. **Fetch and record.** Window by window, oldest first, each window's rows
 *      and the cursor committing together. This is the part that talks to the
 *      network, the part that will hit a rate limit, and the only part a resume
 *      skips.
 *   2. **Attribute and materialise.** From the *stored* history, over the whole
 *      covered range, every time — level-triggered like every other pass in this
 *      application. Adding an `area_mapping` row for a project that has existed
 *      for three years re-attributes three years of history on the next run
 *      without fetching a page, because the location was stored and the area
 *      was not.
 *
 * It writes nothing outward and cannot: there is no writer in this file's
 * dependencies, and the store port has no method that could reach one.
 */

export interface BackfillOptions {
  readonly store: BackfillStore;
  readonly taskClient: TaskToolClient;
  /** Absent when no document-tool binding is configured. The run still works. */
  readonly docClient?: DocToolClient | undefined;
  /** The name of the duration property on a process page. Instance data. */
  readonly durationProperty?: string | undefined;
  /** How far back to go. */
  readonly from: Date;
  readonly now: () => Date;
  readonly defaultMinutes: number;
  readonly sliceDays?: number | undefined;
  /**
   * Called after each window lands, so a long run says something while it runs.
   * A backfill over years is minutes of silence otherwise.
   */
  readonly onSlice?: ((progress: SliceProgress) => void) | undefined;
}

export interface SliceProgress {
  readonly index: number;
  readonly total: number;
  readonly fetched: number;
}

export interface BackfillResult {
  readonly plan: ResumePlan;
  readonly fetched: number;
  readonly attribution: AttributionResult;
  readonly weeks: readonly CapacityWeek[];
  readonly adherence: readonly AdherencePeriod[];
  /** Rituals with no bound task: a habit prisme cannot measure yet. */
  readonly unmeasurableRituals: readonly RitualRecord[];
  readonly declaredDurationsKnown: number;
  readonly documentToolRead: boolean;
  /** The report, rendered. **Carries instance data**; print it, never commit it. */
  readonly report: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * The weeks a covered instant range touches, as `[fromWeek, toWeek)`.
 *
 * Not the same range as the instants, which is the bug this function exists to
 * prevent: a range beginning on a Sunday belongs to a week that began the
 * Monday before it, and deleting from the *instant* left that week's row in
 * place while `weeklyCapacity` produced one for it — so the second run over the
 * same period collided on `capacity_week`'s primary key. Found by running it,
 * not by a test: the in-memory store had the same off-by-one, so the unit tests
 * agreed with the SQL and both were wrong.
 *
 * The end bound is the week containing the last instant that could carry a
 * completion — `to` is exclusive — plus one week, so that week is inside the
 * half-open range rather than just outside it.
 */
function weekBounds(covered: { readonly from: Date; readonly to: Date }): [string, string] {
  const first = startOfWeek(covered.from);
  const last = startOfWeek(new Date(Math.max(covered.to.getTime() - 1, covered.from.getTime())));
  return [dayText(first), dayText(new Date(last.getTime() + 7 * MS_PER_DAY))];
}

export async function backfill(options: BackfillOptions): Promise<BackfillResult> {
  const to = options.now();
  const sliceDays = options.sliceDays ?? SLICE_DAYS;

  const cursor = await options.store.loadCursor();
  const plan = planResume({ from: options.from, to }, cursor, sliceDays);

  let fetched = 0;
  for (const [index, slice] of plan.slices.entries()) {
    const completions = await options.taskClient.fetchCompletions(slice.since, slice.until);

    const rows: StoredCompletion[] = completions.map((completion) => ({
      externalTaskId: completion.externalTaskId,
      completedAt: completion.completedAt,
      ...(completion.projectId === undefined ? {} : { externalProjectId: completion.projectId }),
      ...(completion.sectionId === undefined ? {} : { externalSectionId: completion.sectionId }),
      ...(completion.recordedMinutes === undefined
        ? {}
        : { recordedMinutes: completion.recordedMinutes }),
      ...(completion.recordedDuration === undefined
        ? {}
        : { durationScale: completion.recordedDuration.unit }),
    }));

    // The cursor claims only what has been fetched *so far*, never the whole
    // plan: a run that dies on window nine must leave a cursor describing eight.
    await options.store.recordSlice(rows, {
      coveredFrom: plan.covers.from,
      coveredThrough: slice.until,
    });

    fetched += rows.length;
    options.onSlice?.({ index: index + 1, total: plan.slices.length, fetched });
  }

  const covered = { from: plan.covers.from, to: plan.covers.to };

  const materialised = await materialise({
    store: options.store,
    ...(options.docClient === undefined ? {} : { docClient: options.docClient }),
    ...(options.durationProperty === undefined
      ? {}
      : { durationProperty: options.durationProperty }),
    defaultMinutes: options.defaultMinutes,
    from: covered.from,
    to: covered.to,
  });

  const result = { plan, fetched, ...materialised };

  return { ...result, report: formatBackfillReport(result, covered) };
}

export interface MaterialiseOptions {
  readonly store: BackfillStore;
  /** Absent leaves the preference order two-tier. See {@link BackfillOptions}. */
  readonly docClient?: DocToolClient | undefined;
  readonly durationProperty?: string | undefined;
  readonly defaultMinutes: number;
  /**
   * The instant range to materialise, **explicit and independent of any
   * cursor**.
   *
   * That independence is the whole reason this is a function of its own. The
   * backfill runs it over `plan.covers`, which is the **union** of the request
   * and the cursor's coverage — correct for a backfill, and wrong for anything
   * that wants to refresh a window: a four-week request against a three-year
   * cursor would re-materialise three years. Passing the range in is what makes
   * a bounded refresh actually bounded.
   */
  readonly from: Date;
  readonly to: Date;
}

export interface MaterialiseResult {
  readonly attribution: AttributionResult;
  readonly weeks: readonly CapacityWeek[];
  readonly adherence: readonly AdherencePeriod[];
  /** Rituals with no bound task: a habit prisme cannot measure yet. */
  readonly unmeasurableRituals: readonly RitualRecord[];
  readonly declaredDurationsKnown: number;
  readonly documentToolRead: boolean;
}

/**
 * Phase two of a backfill, on its own: attribute the **stored** history over
 * `[from, to)` and write the materialised weeks.
 *
 * Level-triggered, like every other pass in this application
 * ([ADR-0009](../../../docs/20-decisions/0009-level-triggered-reconciliation.md)):
 * it re-reads what is stored and re-materialises the range, so adding an
 * `area_mapping` row re-attributes history without fetching a page. It reaches
 * no API when `docClient` is absent, and writes nothing outward in any case —
 * the store port has no method that could.
 *
 * The range covers **whole weeks by Monday**, not the instants it is given
 * (`weekBounds`), because a range beginning on a Sunday belongs to the week
 * that began the Monday before it. That asymmetry is where W13's off-by-one
 * lived; it is stated here because a caller passing a four-week window is
 * touching it.
 */
export async function materialise(options: MaterialiseOptions): Promise<MaterialiseResult> {
  const covered = { from: options.from, to: options.to };

  const [stored, areaMap, rituals] = await Promise.all([
    options.store.loadCompletions(covered.from, covered.to),
    options.store.loadAreaMap(),
    options.store.loadRituals(),
  ]);

  const declared = await declaredMinutesFromProcesses(rituals, {
    ...(options.docClient === undefined ? {} : { docClient: options.docClient }),
    ...(options.durationProperty === undefined
      ? {}
      : { durationProperty: options.durationProperty }),
  });

  const ritualByTask = new Map<string, string>();
  for (const ritual of rituals) {
    if (ritual.externalTaskId !== undefined) ritualByTask.set(ritual.externalTaskId, ritual.id);
  }

  const attribution = attribute(stored, {
    areaByLocation: areaMap.areaByLocation,
    kindByArea: areaMap.kindByArea,
    ritualByTask,
    declaredMinutesByTask: declared.byTask,
    defaultMinutes: options.defaultMinutes,
  });

  const weeks = weeklyCapacity(attribution.attributed);
  const adherence = reconstructAdherence(rituals, attribution.attributed, covered);

  await options.store.replaceCapacityWeeks(weeks, ...weekBounds(covered));
  await options.store.recordAdherence(adherence);

  return {
    attribution,
    weeks,
    adherence,
    unmeasurableRituals: rituals.filter((ritual) => ritual.externalTaskId === undefined),
    declaredDurationsKnown: declared.byTask.size,
    documentToolRead: declared.read,
  };
}
