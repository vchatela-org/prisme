import type { AreaKey, AreaKind, DurationSource } from '@prisme/domain';
import { locationKey } from '../reconcile/types.js';
import type {
  AttributedCompletion,
  AttributionContext,
  AttributionGap,
  Lane,
  StoredCompletion,
} from './types.js';

/**
 * Deciding what a completion was, and how long it took.
 *
 * Pure. Everything it needs — the mapping, the lanes, the ritual bindings, the
 * declared durations — arrives as maps, so the whole of this file can be proved
 * against a handful of synthetic rows.
 *
 * ### The duration preference order (docs/12-scoring.md §4)
 *
 * 1. **Recorded duration** on the completed task. The only real measurement.
 * 2. **The declared duration of the matching process page**, for recurring work.
 *    The document tool owns those pages outright and prisme reads them
 *    (ADR-0016); the match is the ritual, which binds a page to a task.
 * 3. **The configured default.** Configuration, not a constant.
 *
 * Every tier is counted, because the honest version of this measurement is "68%
 * of it is estimated" rather than a number with a caveat somewhere in a
 * document. `minutesBySource` is what lets W09 label the chart.
 *
 * ### The day-scale duration
 *
 * W03 kept the unit rather than flattening to minutes and left the decision
 * here. The decision: **a day-scale duration is not an effort.** It is a
 * block-out in a calendar, and converting one to 1440 minutes would let a
 * single all-day task outweigh a fortnight of real work. So it falls through to
 * the next tier like an absent duration, and is counted separately so that the
 * fall-through is visible rather than silent.
 */

/**
 * Which lane a completion belongs to (ADR-0014).
 *
 * The area's kind decides first and decides capacity, because lanes *are* areas
 * with a different kind and that is what keeps capacity accounting uniform
 * (docs/10-model.md §3). `ritual` is a label on top of an ordinary area: a
 * habit's completions are real time in a real area, and they are additionally
 * the series `ritual_adherence` is reconstructed from. Nothing here excludes a
 * ritual from capacity — the exclusion that exists is Signals, and it is the
 * area's kind that says so.
 */
export function laneOf(kind: AreaKind, isRitual: boolean): Lane {
  if (kind === 'signals') return 'signals';
  if (isRitual) return 'ritual';
  return kind === 'run' ? 'run' : 'change';
}

interface Duration {
  readonly minutes: number;
  readonly source: DurationSource;
}

function durationOf(
  completion: StoredCompletion,
  declaredMinutes: number | undefined,
  defaultMinutes: number,
): Duration {
  if (completion.recordedMinutes !== undefined && completion.recordedMinutes >= 0) {
    return { minutes: completion.recordedMinutes, source: 'recorded' };
  }
  if (declaredMinutes !== undefined && declaredMinutes >= 0) {
    return { minutes: declaredMinutes, source: 'declared' };
  }
  return { minutes: defaultMinutes, source: 'default' };
}

export interface AttributionResult {
  readonly attributed: readonly AttributedCompletion[];
  /** Grouped by location, so the output is a configuration to-do list. */
  readonly gaps: readonly AttributionGap[];
  /** How many completions carried a duration prisme refused to convert. */
  readonly dayScaleDurations: number;
  /**
   * Completions whose location maps to an area the `area` table does not have.
   *
   * Separate from a gap: a gap is "no mapping yet", this is "a mapping points
   * at an area that was deleted". Both are reported; neither is guessed at.
   */
  readonly danglingAreas: number;
}

export function attribute(
  completions: readonly StoredCompletion[],
  context: AttributionContext,
): AttributionResult {
  const attributed: AttributedCompletion[] = [];
  const gapCounts = new Map<string, AttributionGap>();
  let dayScaleDurations = 0;
  let danglingAreas = 0;

  for (const completion of completions) {
    if (completion.durationScale === 'day') dayScaleDurations += 1;

    const areaKey = resolveArea(completion, context.areaByLocation);
    if (areaKey === undefined) {
      countGap(gapCounts, completion);
      continue;
    }

    const kind = context.kindByArea.get(areaKey);
    if (kind === undefined) {
      danglingAreas += 1;
      continue;
    }

    const ritualId = context.ritualByTask.get(completion.externalTaskId);
    const lane = laneOf(kind, ritualId !== undefined);

    // The same rule `computeCapacity` applies, applied here so a materialised
    // week and an on-the-fly window agree by construction rather than by luck:
    // Signals are volume and contribute no time.
    const duration =
      kind === 'signals'
        ? { minutes: 0, source: 'recorded' as DurationSource }
        : durationOf(
            completion,
            context.declaredMinutesByTask.get(completion.externalTaskId),
            context.defaultMinutes,
          );

    attributed.push({
      externalTaskId: completion.externalTaskId,
      completedAt: completion.completedAt,
      areaKey,
      areaKind: kind,
      lane,
      ...(ritualId === undefined ? {} : { ritualId }),
      minutes: duration.minutes,
      source: duration.source,
    });
  }

  return {
    attributed,
    // Sorted by count, worst first: the report is a list of what to map next.
    gaps: [...gapCounts.values()].sort(
      (left, right) =>
        right.completions - left.completions ||
        (left.externalProjectId ?? '').localeCompare(right.externalProjectId ?? ''),
    ),
    dayScaleDurations,
    danglingAreas,
  };
}

/**
 * Section first, then project.
 *
 * `area_mapping` allows both, and the more specific one has to win: a mapping
 * that names a section exists precisely to say "this part of that project is a
 * different area", and checking the project first would make every such row
 * dead weight.
 */
function resolveArea(
  completion: StoredCompletion,
  areaByLocation: ReadonlyMap<string, AreaKey>,
): AreaKey | undefined {
  if (completion.externalProjectId === undefined) return undefined;

  if (completion.externalSectionId !== undefined) {
    const bySection = areaByLocation.get(
      locationKey(completion.externalProjectId, completion.externalSectionId),
    );
    if (bySection !== undefined) return bySection;
  }

  return areaByLocation.get(locationKey(completion.externalProjectId));
}

function countGap(gaps: Map<string, AttributionGap>, completion: StoredCompletion): void {
  const key = locationKey(completion.externalProjectId ?? '', completion.externalSectionId);
  const existing = gaps.get(key);
  gaps.set(key, {
    externalProjectId: completion.externalProjectId,
    externalSectionId: completion.externalSectionId,
    completions: (existing?.completions ?? 0) + 1,
  });
}
