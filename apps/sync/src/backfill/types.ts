import type { AreaKey, AreaKind, DurationSource } from '@prisme/domain';

/**
 * What the backfill works with.
 *
 * The shape to notice is that a stored completion carries a **location**, not
 * an area. Attribution is a decision prisme makes from `area_mapping`, and it
 * is re-made from scratch on every run: adding a mapping for a project that has
 * existed for three years must re-attribute three years of history without
 * fetching a single page. A stored `area_key` would have frozen the first
 * answer into the record.
 */

/** The four lanes of ADR-0014, as a completion is labelled by one. */
export type Lane = 'change' | 'run' | 'signals' | 'ritual';

/** One completion, as the task tool reported it and as this repository holds it. */
export interface StoredCompletion {
  readonly externalTaskId: string;
  readonly completedAt: Date;
  readonly externalProjectId?: string | undefined;
  readonly externalSectionId?: string | undefined;
  /** Minutes, and only when the tool recorded minutes. */
  readonly recordedMinutes?: number | undefined;
  /** The unit the tool used. `day` means a block-out, which is not an effort. */
  readonly durationScale?: 'minute' | 'day' | undefined;
}

/** One completion, once prisme has decided what it was and how long it took. */
export interface AttributedCompletion {
  readonly externalTaskId: string;
  readonly completedAt: Date;
  readonly areaKey: AreaKey;
  readonly areaKind: AreaKind;
  readonly lane: Lane;
  /** The ritual this completion is an instance of, when it is one. */
  readonly ritualId?: string | undefined;
  /** Attributed minutes. Zero for Signals, by the same rule `computeCapacity` uses. */
  readonly minutes: number;
  readonly source: DurationSource;
}

/**
 * A completion prisme could not place.
 *
 * Counted by location and reported, never dropped: an unmapped project is a
 * configuration gap, and a gap that shows up as a slightly wrong percentage is
 * a gap nobody ever finds.
 */
export interface AttributionGap {
  /** **Instance data** at runtime. Printed to a terminal, never committed. */
  readonly externalProjectId: string | undefined;
  readonly externalSectionId: string | undefined;
  readonly completions: number;
}

/** What the run needs from prisme's own database to attribute a completion. */
export interface AttributionContext {
  /** `area_mapping`, keyed by `locationKey(project, section)`. */
  readonly areaByLocation: ReadonlyMap<string, AreaKey>;
  readonly kindByArea: ReadonlyMap<AreaKey, AreaKind>;
  /** External task id → the ritual it is an instance of. */
  readonly ritualByTask: ReadonlyMap<string, string>;
  /**
   * External task id → the declared duration of its matching process page.
   *
   * Empty whenever the document tool is not read, which is every run today —
   * see `run.ts`. The preference order then skips its middle tier, and the
   * report says how much of capacity that cost.
   */
  readonly declaredMinutesByTask: ReadonlyMap<string, number>;
  readonly defaultMinutes: number;
}

/** One materialised week for one area. Derived, disposable, recomputable. */
export interface CapacityWeek {
  /** Monday, UTC, as `YYYY-MM-DD` — the same buckets the KPI series uses. */
  readonly weekStart: string;
  readonly areaKey: AreaKey;
  readonly completions: number;
  readonly minutes: number;
  readonly minutesBySource: Readonly<Record<DurationSource, number>>;
}

/** One reconstructed adherence period for one ritual. */
export interface AdherencePeriod {
  readonly ritualId: string;
  /** `YYYY-MM-DD`: the Monday for a daily or weekly cadence, the 1st for monthly. */
  readonly periodStart: string;
  readonly opportunities: number;
  readonly completions: number;
  /**
   * Completions beyond the opportunities the cadence offered.
   *
   * `ritual_adherence` refuses `completions > opportunities`, and rightly:
   * doing a daily habit twice on Tuesday does not make the week 114% adhered.
   * The excess is clamped out of the stored row and reported here instead, so
   * it is visible rather than merely discarded.
   */
  readonly excess: number;
}

export interface RitualRecord {
  readonly id: string;
  readonly name: string;
  readonly areaKey: AreaKey;
  readonly cadence: 'daily' | 'weekly' | 'monthly';
  /** The task whose completions are this habit's, when one is bound. */
  readonly externalTaskId?: string | undefined;
  /** The process page in the document tool, when there is one. */
  readonly externalPageId?: string | undefined;
}
