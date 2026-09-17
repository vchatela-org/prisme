import type { z } from 'zod';
import {
  CAPACITY_WINDOW_DEFAULTS,
  computeCapacity,
  computeProgress,
  parseCalendarDate,
  resolveWeights,
  type AreaWeight,
  type CalendarDate,
  type Year,
} from '@prisme/domain';
import type { balanceDto } from '../dto/area.js';
import type { kpiDto } from '../dto/views.js';
import type { ApiStore } from '../store/types.js';
import { toDomainArea } from './convert.js';

/**
 * Measurement: declared versus observed capacity, and the KPI series behind it.
 *
 * This is the view that exists nowhere else, and the reason it is worth the
 * arithmetic: neither external tool can say what share of a month actually went
 * to each area, because neither knows the areas. The limitation is restated
 * here because it is restated where it is implemented in `@prisme/domain` —
 * this measures **attention routed through tasks**, not hours lived. Areas
 * whose work rarely becomes a task will read as starved. The bias errs toward
 * surfacing neglect, which is the safer direction, but it is a lens and not a
 * verdict.
 *
 * ### Asking about a past year
 *
 * `computeCapacity` resolves weights from the year `now` falls in, which is
 * exactly right and slightly awkward here: a chart of 2026 must use 2026's
 * weights even after 2027's land (ADR-0007). So a request for a past year is
 * answered as of the **last instant of that year** — the observation window is
 * that year's final four weeks, and the weights are that year's. A request for
 * the current year is answered as of now.
 */

export type BalanceShape = z.infer<typeof balanceDto>;
export type KpiShape = z.infer<typeof kpiDto>;

export interface MeasureConfig {
  readonly capacityWindowWeeks: number;
  readonly defaultTaskMinutes: number;
}

export interface MeasureService {
  balance(year: number, weeks: number | undefined, now: Date): Promise<BalanceShape>;
  /** The range is explicit, so this one needs no clock of its own. */
  kpi(from: string, to: string, bucket: 'week' | 'month'): Promise<KpiShape>;
}

const MS_PER_DAY = 86_400_000;

function dayText(instant: Date): CalendarDate {
  return parseCalendarDate(instant.toISOString().slice(0, 10));
}

/** The Monday of the week an instant falls in, in UTC. */
function startOfWeek(instant: Date): Date {
  const day = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  // getUTCDay: 0 is Sunday, so Sunday steps back six days rather than none.
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * MS_PER_DAY);
}

function startOfMonth(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
}

function bucketStart(instant: Date, bucket: 'week' | 'month'): Date {
  return bucket === 'week' ? startOfWeek(instant) : startOfMonth(instant);
}

/** Every bucket between two dates, so a gap reads as zero rather than as absence. */
function bucketsBetween(from: Date, to: Date, bucket: 'week' | 'month'): readonly Date[] {
  const buckets: Date[] = [];
  let cursor = bucketStart(from, bucket);
  while (cursor.getTime() <= to.getTime()) {
    buckets.push(cursor);
    cursor =
      bucket === 'week'
        ? new Date(cursor.getTime() + 7 * MS_PER_DAY)
        : new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return buckets;
}

export function createMeasureService(store: ApiStore, config: MeasureConfig): MeasureService {
  return {
    async balance(year: number, weeks: number | undefined, now: Date): Promise<BalanceShape> {
      const windowWeeks = weeks ?? config.capacityWindowWeeks;
      const asOf =
        year === now.getUTCFullYear() ? now : new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

      const [areaRecords, weightRecords] = await Promise.all([
        store.areas.list(),
        store.areas.weights(),
      ]);

      const areas = areaRecords.map(toDomainArea);
      const weights: AreaWeight[] = weightRecords.map((record) => ({
        areaKey: record.areaKey,
        year: record.year as Year,
        weightPct: record.weightPct,
      }));

      const windowStart = new Date(asOf.getTime() - windowWeeks * 7 * MS_PER_DAY);
      const completions = await store.initiatives.completions(windowStart);

      const capacity = computeCapacity(
        completions.map((completion) => ({
          id: completion.id,
          areaKey: completion.areaKey,
          completedAt: completion.completedAt,
          recordedMinutes: completion.recordedMinutes,
        })),
        areas,
        {
          ...CAPACITY_WINDOW_DEFAULTS,
          weeks: windowWeeks,
          defaultMinutes: config.defaultTaskMinutes,
          weights,
        },
        asOf,
      );

      const resolved = resolveWeights(weights, year as Year);
      const nameByKey = new Map(areaRecords.map((record) => [record.key, record.name]));

      return {
        from: dayText(windowStart),
        to: dayText(asOf),
        windowWeeks,
        weightYear: year,
        weightSourceYear: resolved.sourceYear ?? null,
        stale: resolved.stale,
        areas: capacity.map((entry) => ({
          areaKey: entry.areaKey,
          name: nameByKey.get(entry.areaKey) ?? entry.areaKey,
          kind: entry.kind,
          countsTowardCapacity: entry.countsTowardCapacity,
          minutes: entry.minutes,
          completions: entry.completions,
          actualSharePct: entry.actualSharePct,
          targetSharePct: entry.targetSharePct ?? null,
          balanceFactor: entry.balanceFactor,
          stale: entry.stale,
          minutesBySource: entry.minutesBySource,
          runHoursPerWeek: entry.runHoursPerWeek ?? null,
          runBudgetHoursPerWeek: entry.runBudgetHoursPerWeek ?? null,
        })),
      };
    },

    async kpi(from, to, bucket): Promise<KpiShape> {
      const fromAt = new Date(`${from}T00:00:00.000Z`);
      const toAt = new Date(`${to}T23:59:59.999Z`);

      const [areaRecords, completions, rituals, objectives] = await Promise.all([
        store.areas.list(),
        // Half-open on the left, matching the capacity window: two adjacent
        // ranges never count the same completion twice.
        store.initiatives.completions(new Date(fromAt.getTime() - 1)),
        store.lanes.rituals(),
        store.okr.listObjectives({}, { limit: 200, offset: 0 }),
      ]);

      const buckets = bucketsBetween(fromAt, toAt, bucket);
      const labels = buckets.map(dayText);
      const indexByLabel = new Map(labels.map((label, index) => [label, index]));

      const zeroes = (): number[] => labels.map(() => 0);
      const completionsByArea = new Map<string, number[]>();
      const minutesByArea = new Map<string, number[]>();
      for (const area of areaRecords) {
        completionsByArea.set(area.key, zeroes());
        minutesByArea.set(area.key, zeroes());
      }

      const kindByKey = new Map(areaRecords.map((record) => [record.key, record.kind]));

      for (const completion of completions) {
        if (completion.completedAt > toAt || completion.completedAt < fromAt) continue;
        const index = indexByLabel.get(dayText(bucketStart(completion.completedAt, bucket)));
        if (index === undefined) continue;

        const counts = completionsByArea.get(completion.areaKey);
        if (counts === undefined) continue;
        counts[index] = (counts[index] ?? 0) + 1;

        // Signals contribute volume and no time: responding to an alert is not
        // a choice about how to spend a week (ADR-0014).
        if (kindByKey.get(completion.areaKey) === 'signals') continue;
        const minutes = minutesByArea.get(completion.areaKey);
        if (minutes === undefined) continue;
        minutes[index] =
          (minutes[index] ?? 0) + (completion.recordedMinutes ?? config.defaultTaskMinutes);
      }

      const points = (values: readonly number[]) =>
        labels.map((periodStart, index) => ({ periodStart, value: values[index] ?? 0 }));

      const runArea = areaRecords.find((record) => record.kind === 'run');
      const runMinutes =
        runArea === undefined ? zeroes() : (minutesByArea.get(runArea.key) ?? zeroes());
      const weeksPerBucket = bucket === 'week' ? 1 : 52 / 12;

      const signalsAreas = areaRecords.filter((record) => record.kind === 'signals');
      const signals = zeroes();
      for (const area of signalsAreas) {
        const counts = completionsByArea.get(area.key) ?? [];
        counts.forEach((value, index) => {
          signals[index] = (signals[index] ?? 0) + value;
        });
      }

      const adherence = await store.lanes.adherence(
        rituals.map((ritual) => ritual.id),
        from,
        to,
      );

      const keyResults = await store.okr.keyResults(
        objectives.items.map((objective) => objective.id),
      );

      return {
        from,
        to,
        bucket,
        throughput: areaRecords.map((record) => ({
          areaKey: record.key,
          kind: record.kind,
          points: points(completionsByArea.get(record.key) ?? []),
        })),
        minutes: areaRecords.map((record) => ({
          areaKey: record.key,
          kind: record.kind,
          points: points(minutesByArea.get(record.key) ?? []),
        })),
        runHours: {
          budgetHoursPerWeek: runArea?.runBudgetHoursPerWeek ?? null,
          points: points(runMinutes.map((minutes) => minutes / 60 / weeksPerBucket)),
        },
        signalsVolume: points(signals),
        ritualAdherence: rituals.map((ritual) => {
          const own = adherence.filter((entry) => entry.ritualId === ritual.id);
          const values = zeroes();
          for (const entry of own) {
            const index = indexByLabel.get(
              dayText(bucketStart(new Date(`${entry.periodStart}T00:00:00.000Z`), bucket)),
            );
            if (index === undefined || entry.opportunities === 0) continue;
            values[index] = (entry.completions / entry.opportunities) * 100;
          }
          return {
            ritualId: ritual.id,
            name: ritual.name,
            targetAdherencePct: ritual.targetAdherencePct,
            points: points(values),
          };
        }),
        objectiveAttainment: objectives.items.map((objective) => {
          const own = keyResults.filter((keyResult) => keyResult.objectiveId === objective.id);
          const computed = own
            .map((keyResult) => computeProgress(keyResult.taskDone, keyResult.taskTotal))
            .filter((value): value is number => value !== undefined);

          return {
            objectiveId: objective.id,
            title: objective.title,
            period: objective.period,
            progressSelfPct:
              own.length === 0
                ? null
                : own.reduce((total, keyResult) => total + keyResult.progressSelf, 0) / own.length,
            progressComputedPct:
              computed.length === 0
                ? null
                : computed.reduce((total, value) => total + value, 0) / computed.length,
          };
        }),
      };
    },
  };
}
