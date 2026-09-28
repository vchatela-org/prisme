import {
  CAPACITY_WINDOW_DEFAULTS,
  computeCapacity,
  computeScores,
  notUnderWay,
  parseCalendarDate,
  rank,
  resolveWeights,
  selectNowSet,
  toScoringContexts,
  yearOfInstant,
  type Area,
  type AreaCapacity,
  type AreaWeight,
  type Initiative,
  type ProjectStatus,
  type RankedInitiative,
  type Registry,
  type ScoredInitiative,
  type ScoringMethod,
  type Selection,
  type SelectionLimits,
  type UnderWayContext,
  type Year,
} from '@prisme/domain';
import type { ApiStore, AreaRecord, InitiativeRecord, RollupRecord } from '../store/types.js';
import { calendarDayIn } from './adoption-queue.js';
import { toDomainArea, toDomainInitiative } from './convert.js';

/**
 * One ranking, computed once per request that needs one.
 *
 * **Allocate before you rank.** The order in this file is the order in the
 * specification and it is not negotiable: measure what each area actually
 * received, turn that into a balance factor against the year's weights, hand
 * *that* to the scoring method, and only then select. A score that ranks across
 * areas without the balance factor is a bug (CLAUDE.md §2), and the way that
 * bug gets written is by ranking first and adjusting afterwards.
 *
 * ### Why the ranking is recomputed rather than read back
 *
 * `initiative_score` holds a history, not a cache. The active method's score
 * depends on the balance factor, which moves every time something is completed
 * — so a stored row answers "what did it score when it was last written", which
 * is the right question for a trend and the wrong one for a list somebody is
 * about to act on. The scoring method is pure and the data is personal-scale,
 * so recomputing is cheap and always current. Persisting a ranking is a
 * deliberate act with its own endpoint (`POST /initiatives/rescore`), because
 * an append-only history should record decisions, not page views.
 *
 * ### Why everything is ranked in memory
 *
 * The scoring method is a plugin (ADR-0006) and `packages/domain` is pure, so
 * the ranking cannot be expressed as an `ORDER BY` without re-implementing the
 * active method in SQL — two implementations of the ordering, diverging the
 * first time one is changed. Filtering happens in the database, ranking and
 * paging happen here, over a set that is a few thousand rows at the very
 * outside for one person's planning history.
 *
 * ### Only what is under way is ranked (ADR-0035)
 *
 * Every open initiative is scored, because a score describes the initiative.
 * But one that may not start before a later day, or whose project is not
 * active, is not part of today's prioritization: selection neither offers it a
 * slot nor queues it, and it gets **no rank**. The positions of the rest stay
 * contiguous and in the order the method produced, so the Backlog still reads
 * the ordering that chose the week. Work already `now` keeps its rank, as it
 * keeps its slot.
 */

/**
 * Every project, read in one page to learn which are active. One person's
 * projects are a few dozen; a ceiling this far above that is a guard, not a
 * paging decision.
 */
const PROJECT_READ_LIMIT = 1000;

export interface RankingOptions {
  readonly now: Date;
  /** The instance's IANA timezone, which decides what day `now` is. */
  readonly timezone: string;
  readonly capacityWindowWeeks: number;
  readonly defaultTaskMinutes: number;
  readonly limits: SelectionLimits;
}

export interface Ranking {
  readonly now: Date;
  readonly areaRecords: readonly AreaRecord[];
  readonly areas: readonly Area[];
  readonly weights: readonly AreaWeight[];
  readonly weightYear: Year;
  /** The weights behind every balance factor were carried forward, or absent. */
  readonly weightsStale: boolean;
  readonly capacity: readonly AreaCapacity[];
  readonly initiativeRecords: readonly InitiativeRecord[];
  readonly initiatives: readonly Initiative[];
  readonly recordById: ReadonlyMap<string, InitiativeRecord>;
  readonly rollupById: ReadonlyMap<string, RollupRecord>;
  readonly method: ScoringMethod<never>;
  readonly scored: readonly ScoredInitiative[];
  readonly ranked: readonly RankedInitiative[];
  readonly selection: Selection;
  /** Today, and each project's status: what decides whether work is under way. */
  readonly underWay: UnderWayContext;
  /**
   * Position in the active ordering, 1-based. Only ranked work appears, and
   * work not under way is not ranked.
   */
  readonly rankById: ReadonlyMap<string, number>;
  readonly scoreById: ReadonlyMap<string, ScoredInitiative>;
}

export async function buildRanking(
  store: ApiStore,
  registry: Registry,
  options: RankingOptions,
): Promise<Ranking> {
  const [areaRecords, weightRecords, initiativeRecords, rollupRecords, projectRecords] =
    await Promise.all([
      store.areas.list(),
      store.areas.weights(),
      store.initiatives.list({}),
      store.initiatives.rollups(),
      store.projects.list(undefined, { limit: PROJECT_READ_LIMIT, offset: 0 }),
    ]);

  const areas = areaRecords.map(toDomainArea);
  const weights: AreaWeight[] = weightRecords.map((record) => ({
    areaKey: record.areaKey,
    year: record.year as Year,
    weightPct: record.weightPct,
  }));

  const windowStart = new Date(
    options.now.getTime() - options.capacityWindowWeeks * 7 * 24 * 60 * 60 * 1000,
  );
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
      weeks: options.capacityWindowWeeks,
      defaultMinutes: options.defaultTaskMinutes,
      weights,
    },
    options.now,
  );

  const contexts = toScoringContexts(capacity, areas);
  const initiatives = initiativeRecords.map(toDomainInitiative);

  const method = registry.activeMethod();
  const scored = computeScores(initiatives, contexts, method, method.defaultParams, options.now);
  const ranked = rank(scored, initiatives);
  const underWay: UnderWayContext = {
    today: parseCalendarDate(calendarDayIn(options.timezone, options.now)),
    projectStatusById: new Map(
      projectRecords.items.map((record) => [record.id, record.status as ProjectStatus]),
    ),
  };
  const selection = selectNowSet(ranked, areas, options.limits, underWay);

  const scoreById = new Map<string, ScoredInitiative>(
    scored.map((entry) => [entry.initiativeId, entry]),
  );
  const rankById = new Map<string, number>();
  for (const { initiative } of ranked) {
    if (initiative.status !== 'now' && notUnderWay(initiative, underWay) !== undefined) continue;
    rankById.set(initiative.id, rankById.size + 1);
  }

  const weightYear = yearOfInstant(options.now);

  return {
    now: options.now,
    areaRecords,
    areas,
    weights,
    weightYear,
    weightsStale: resolveWeights(weights, weightYear).stale,
    capacity,
    initiativeRecords,
    initiatives,
    recordById: new Map(initiativeRecords.map((record) => [record.id, record])),
    rollupById: new Map(rollupRecords.map((record) => [record.initiativeId, record])),
    method,
    scored,
    ranked,
    selection,
    underWay,
    rankById,
    scoreById,
  };
}
