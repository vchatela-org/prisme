import type { AreaKey, AreaKind } from '@prisme/domain';
import type { Cursor } from './slices.js';
import type {
  AdherencePeriod,
  AttributedCompletion,
  CapacityWeek,
  RitualRecord,
  StoredCompletion,
} from './types.js';

/**
 * Everything the backfill needs from prisme's own database, as an interface.
 *
 * Same reasoning as `adoption/ports.ts`: the decisions are pure functions, so
 * stating the database as a port lets the whole pass run end to end in memory
 * while the SQL stays readable on its own in `store.ts`.
 *
 * Note what this port **cannot** do. There is no writer of any kind to an
 * external tool, and there is no method that touches an entity: no initiative,
 * no objective, no link, no status. The backfill reads history and writes four
 * derived tables. It is structurally incapable of an outward write, which is
 * the same property `adoption` has and for the same reason — it is easier to
 * verify than a flag.
 */
export interface BackfillStore {
  /** Where the last run got to, or `undefined` if there has never been one. */
  loadCursor(): Promise<Cursor | undefined>;

  /**
   * Record one window's completions and advance the cursor, together.
   *
   * One transaction, because a cursor that advanced past rows which were never
   * committed describes history nothing will ever revisit (ADR-0018, applied to
   * this cursor for the same reason the sync token has it).
   *
   * Upsert on `(external_task_id, completed_at)`: the tool's own record is the
   * truth, and re-fetching a window must converge on it rather than accumulate.
   */
  recordSlice(completions: readonly StoredCompletion[], covers: Cursor): Promise<void>;

  /** Every completion in `[from, to)`, for attribution and materialisation. */
  loadCompletions(from: Date, to: Date): Promise<readonly StoredCompletion[]>;

  /** `area_mapping` and each area's kind. */
  loadAreaMap(): Promise<{
    readonly areaByLocation: ReadonlyMap<string, AreaKey>;
    readonly kindByArea: ReadonlyMap<AreaKey, AreaKind>;
  }>;

  /** Every ritual, with the external task bound to it if there is one. */
  loadRituals(): Promise<readonly RitualRecord[]>;

  /**
   * Replace everything materialised for the weeks in `[fromWeek, toWeek)`: the
   * weekly rows, and the attributed completions they sum.
   *
   * Wholesale over the range rather than upserted row by row, and
   * level-triggered like every other pass here: a week whose only completion
   * was deleted in the task tool must lose its row, and an upsert would leave
   * it behind forever.
   *
   * **Both tables in one transaction.** `capacity_completion` is what the area
   * screen itemises and `capacity_week` is what its percentages are drawn
   * from; written separately, a failure between the two would leave a list
   * that does not add up to the number above it.
   *
   * **The bounds are week starts, not the covered instants.** They are not the
   * same range, and taking the instants was a bug: a range beginning on a
   * Sunday belongs to a week that began the Monday *before* it, so the delete
   * missed that week's row while `weeklyCapacity` produced one — and the second
   * run collided on the primary key. Both bounds come from `startOfWeek`, so
   * where a week begins is one function's answer rather than two. A completion
   * belongs to the range when its instant falls between the two Mondays.
   */
  replaceMaterialised(materialised: {
    readonly weeks: readonly CapacityWeek[];
    readonly completions: readonly AttributedCompletion[];
    readonly fromWeek: string;
    readonly toWeek: string;
  }): Promise<void>;

  /** Write the reconstructed adherence series. Idempotent by `(ritual, period)`. */
  recordAdherence(periods: readonly AdherencePeriod[]): Promise<void>;
}
