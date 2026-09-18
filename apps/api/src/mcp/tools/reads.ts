import { z } from 'zod';
import { areaKey, calendarDate, entityId, initiativeStatus } from '../../dto/common.js';
import { balanceDto } from '../../dto/area.js';
import { kpiDto } from '../../dto/views.js';
import { takeawayDto } from '../../dto/lanes.js';
import { syncStatusDto } from '../../dto/ops.js';
import { toScoreDto } from '../../services/convert.js';
import { defineReadTool, type ReadTool } from '../tool.js';

/**
 * The read tools.
 *
 * **Small, structured answers.** The brief is blunt about why: *an agent that
 * must read 200 initiatives to answer one question will do it badly and
 * expensively.* So these do not return the REST DTOs. `GET /focus` answers a
 * screen and carries the whole initiative object for every row because a screen
 * draws all of it; a tool answers a question, and an agent deciding what to work
 * on needs a title, an area, a score and what is blocking it.
 *
 * That projection is the only thing in this file. Nothing here decides anything
 * — `selectNowSet` chose the now set, `computeScores` ranked it, the balance
 * factor came from the weights in force that year — and a rule implemented here
 * would be a second copy of a rule the REST surface already has
 * (apps/api/CLAUDE.md §6).
 *
 * ### Descriptions are the interface
 *
 * An agent picks a tool by reading its `description`, so each one says what it
 * will *not* answer as plainly as what it will. Every example uses `fixtures/`
 * vocabulary — a real initiative title in a tool description would be published
 * the moment the manifest was (docs/17-privacy.md).
 */

const scoreBrief = z.object({
  value: z.number(),
  methodId: z.string(),
  methodVersion: z.int(),
});

/**
 * An initiative, reduced to what a decision needs.
 *
 * No narrative, no rollup breakdown, no timestamps, no external identifiers.
 * `explain_score` is where the factors live, and `list_initiatives` is where
 * more rows live; anything wanting the whole object has the REST API.
 */
const initiativeBrief = z.object({
  id: entityId,
  title: z.string(),
  areaKey,
  status: initiativeStatus,
  size: z.int(),
  deadline: calendarDate.nullable(),
  score: z.number().nullable(),
  /** Position in the active method's ordering, 1-based. Null before a ranking has run. */
  rank: z.int().nullable(),
  /** Ids of dependencies that are neither `done` nor `dropped`. */
  blockedBy: z.array(entityId),
  /** Small enough to be started in one sitting, in the one respect a machine can check. */
  sizedForNow: z.boolean(),
});

type InitiativeBrief = z.infer<typeof initiativeBrief>;

interface BriefSource {
  readonly initiative: {
    id: string;
    title: string;
    areaKey: string;
    status: string;
    size: number;
    deadline: string | null;
    blockedBy: readonly string[];
    sizedForNow: boolean;
  };
  readonly score: number | null;
  readonly rank: number | null;
}

function brief(source: BriefSource): InitiativeBrief {
  const { initiative } = source;
  return {
    id: initiative.id,
    title: initiative.title,
    areaKey: initiative.areaKey,
    status: initiative.status as InitiativeBrief['status'],
    size: initiative.size,
    deadline: initiative.deadline,
    score: source.score,
    rank: source.rank,
    blockedBy: [...initiative.blockedBy],
    sizedForNow: initiative.sizedForNow,
  };
}

const focusRow = initiativeBrief.extend({
  /** Why it is where it is, straight from `selectNowSet`. */
  reason: z.enum([
    'in_flight',
    'selected',
    'area_at_cap',
    'wip_full',
    'blocked',
    'too_large',
    'not_a_candidate',
  ]),
  daysUntilDeadline: z.int().nullable(),
  /** The schedule engine's answer, not a day count: the earliest finish falls after the deadline. */
  deadlineAtRisk: z.boolean(),
});

const focusNow = defineReadTool({
  name: 'focus_now',
  title: 'What to work on now',
  scope: 'read:focus',
  description:
    'The current now set — what prisme says to work on, with the reason each item is there and what is blocking it — plus the queue a freed slot would draw from. This is the answer to "what should I do today". It does not change anything and does not decide what is *next*: work in flight keeps its slot whatever it scores, and promoting something is `set_status` or `propose_now_set`. Scores here compare only within an area (ADR-0005); ranking two items from different areas by score is meaningless.',
  input: z.strictObject({}),
  result: z.object({
    asOf: z.string(),
    method: z.object({ id: z.string(), version: z.int() }),
    limits: z.object({ maxNow: z.int(), maxNowPerArea: z.int() }),
    /** More is in flight than the limit allows. Nothing is demoted for it. */
    overCapacity: z.boolean(),
    /** The weights behind every balance factor were carried forward from an earlier year. */
    weightsStale: z.boolean(),
    now: z.array(focusRow),
    upNext: z.array(focusRow),
    slotsByArea: z.array(z.object({ areaKey, used: z.int(), limit: z.int() })),
  }),
  async run(_input, context) {
    const focus = await context.services.work.focus(context.now);
    const row = (entry: (typeof focus.now)[number]): z.infer<typeof focusRow> => ({
      ...brief({ initiative: entry.initiative, score: entry.score, rank: entry.rank }),
      reason: entry.reason,
      daysUntilDeadline: entry.daysUntilDeadline,
      deadlineAtRisk: entry.deadlineAtRisk,
    });

    return {
      asOf: focus.asOf,
      method: { id: focus.methodId, version: focus.methodVersion },
      limits: focus.limits,
      overCapacity: focus.overCapacity,
      weightsStale: focus.weightsStale,
      now: focus.now.map(row),
      upNext: focus.upNext.map(row),
      slotsByArea: focus.slotsByArea.map((slot) => ({
        areaKey: slot.areaKey,
        used: slot.used,
        limit: slot.limit,
      })),
    };
  },
});

/** Deliberately below the REST cap of 200: a tool answers a question, not a page. */
const MAX_TOOL_PAGE = 50;

const listInitiatives = defineReadTool({
  name: 'list_initiatives',
  title: 'Search the ranked backlog',
  scope: 'read:backlog',
  description:
    'Initiatives, filtered and paged, in the order the active scoring method produced. Use it to find something by area, status or title — not to read the whole backlog, which is paged at 50 and will cost more than it answers. Sorting by `score` returns rows in rank order rather than re-sorting the numbers: two orderings of the same data means the list you read is not the list that chose the week.',
  input: z.strictObject({
    areaKey: areaKey.optional(),
    status: z.array(initiativeStatus).max(8).optional(),
    projectId: entityId.optional(),
    hasDeadline: z.boolean().optional(),
    search: z.string().min(1).max(200).optional(),
    sort: z.enum(['score', 'deadline', 'age', 'title', 'size']).default('score'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    limit: z.int().min(1).max(MAX_TOOL_PAGE).default(20),
    offset: z.int().min(0).default(0),
  }),
  result: z.object({
    total: z.int(),
    limit: z.int(),
    offset: z.int(),
    method: z.object({ id: z.string(), version: z.int() }),
    sort: z.string(),
    items: z.array(initiativeBrief),
  }),
  async run(input, context) {
    const page = await context.services.work.backlog(
      {
        areaKeys: input.areaKey === undefined ? undefined : [input.areaKey],
        statuses: input.status,
        projectId: input.projectId,
        hasDeadline: input.hasDeadline,
        search: input.search,
        sort: input.sort,
        direction: input.direction,
        page: { limit: input.limit, offset: input.offset },
      },
      context.now,
    );

    return {
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      method: { id: page.methodId, version: page.methodVersion },
      sort: page.sort,
      items: page.items.map(brief),
    };
  },
});

const areaBalance = defineReadTool({
  name: 'area_balance',
  title: 'Declared versus observed capacity per area',
  scope: 'read:areas',
  description:
    'What each area was allocated this year, what it actually received, and the balance factor between them. This is the allocation view — read it before ranking anything, because a score only compares inside an area (ADR-0005). It measures attention routed through tasks, not hours lived. Weights are year-scoped: there is no "current" weight, and `stale` true means the year being asked about has none of its own and an earlier year was carried forward.',
  input: z.strictObject({
    year: z.int().min(1970).max(9999).optional(),
    weeks: z.int().min(1).max(52).optional(),
  }),
  result: balanceDto,
  run: (input, context) =>
    context.services.measure.balance(
      input.year ?? context.now.getUTCFullYear(),
      input.weeks,
      context.now,
    ),
});

const kpi = defineReadTool({
  name: 'kpi',
  title: 'KPI series over a date range',
  scope: 'read:kpi',
  description:
    'Throughput, attributed minutes, Run hours against budget, Signals volume, ritual adherence and objective attainment, bucketed by week or month. Ask for the narrowest range that answers the question — every series is returned for every bucket in the range. Signals carry volume and no time at all, and are excluded from capacity (ADR-0014).',
  input: z.strictObject({
    from: calendarDate,
    to: calendarDate,
    bucket: z.enum(['week', 'month']).default('week'),
  }),
  result: kpiDto,
  run: (input, context) => context.services.measure.kpi(input.from, input.to, input.bucket),
});

const objectives = defineReadTool({
  name: 'objectives',
  title: 'Objectives and their key results',
  scope: 'read:objectives',
  description:
    "Objectives for a period — `2026` for an annual one, `2026-03` for a month — with each key result's self-assessed progress beside the progress computed from its tasks. The two are reported separately on purpose (ADR-0013): self-assessment is the measure that syncs outward, and a divergence between them is the signal, not an error to reconcile.",
  input: z.strictObject({
    period: z
      .string()
      .regex(/^\d{4}(-\d{2})?$/, 'expected YYYY or YYYY-MM')
      .optional(),
    areaKey: areaKey.optional(),
    status: z.enum(['draft', 'active', 'met', 'missed', 'dropped']).optional(),
    limit: z.int().min(1).max(MAX_TOOL_PAGE).default(20),
    offset: z.int().min(0).default(0),
  }),
  result: z.object({
    total: z.int(),
    limit: z.int(),
    offset: z.int(),
    items: z.array(
      z.object({
        id: entityId,
        title: z.string(),
        type: z.enum(['annual', 'monthly']),
        period: z.string(),
        areaKey,
        status: z.enum(['draft', 'active', 'met', 'missed', 'dropped']),
        keyResults: z.array(
          z.object({
            id: entityId,
            statement: z.string(),
            target: z.number(),
            unit: z.string(),
            progressSelfPct: z.number(),
            progressComputedPct: z.number().nullable(),
            servedBy: z.array(entityId),
          }),
        ),
      }),
    ),
  }),
  async run(input, context) {
    const page = await context.services.objectives.list(
      { period: input.period, areaKey: input.areaKey, status: input.status },
      { limit: input.limit, offset: input.offset },
    );

    return {
      total: page.total,
      limit: input.limit,
      offset: input.offset,
      items: page.items.map((objective) => ({
        id: objective.id,
        title: objective.title,
        type: objective.type,
        period: objective.period,
        areaKey: objective.areaKey,
        status: objective.status,
        keyResults: objective.keyResults.map((keyResult) => ({
          id: keyResult.id,
          statement: keyResult.statement,
          target: keyResult.target,
          unit: keyResult.unit,
          progressSelfPct: keyResult.progressSelf,
          progressComputedPct: keyResult.progressComputed,
          servedBy: [...keyResult.servedBy],
        })),
      })),
    };
  },
});

const listTakeaways = defineReadTool({
  name: 'list_takeaways',
  title: 'Reading takeaways',
  scope: 'read:focus',
  description:
    'Takeaways captured from readings, in the document tool. A takeaway of kind `action` is a backlog candidate and can be promoted with `promote_takeaway`; a `principle` never enters the backlog at all and surfaces as context when its area is reviewed (ADR-0014). Filter on `promoted: false` to find what is still waiting on a decision. The takeaway text belongs to the document tool and is not returned here — prisme holds the link, not the content.',
  input: z.strictObject({
    kind: z.enum(['principle', 'action']).optional(),
    promoted: z.boolean().optional(),
    limit: z.int().min(1).max(MAX_TOOL_PAGE).default(20),
    offset: z.int().min(0).default(0),
  }),
  result: z.object({
    total: z.int(),
    limit: z.int(),
    offset: z.int(),
    items: z.array(takeawayDto),
  }),
  async run(input, context) {
    const page = await context.services.lanes.takeaways(
      { kind: input.kind, promoted: input.promoted },
      { limit: input.limit, offset: input.offset },
    );
    return { total: page.total, limit: input.limit, offset: input.offset, items: page.items };
  },
});

const syncStatus = defineReadTool({
  name: 'sync_status',
  title: 'Reconciliation state',
  scope: 'read:sync',
  description:
    'Whether reconciliation is enabled, whether outward writes are unfrozen, when the last pass ran and how many conflicts are unresolved. Read this before `apply`: `writeEnabled` false means the write freeze is still on and an apply will refuse rather than partially run. It reports state and triggers nothing — `plan_preview` runs a pass.',
  input: z.strictObject({}),
  result: syncStatusDto,
  run: (_input, context) => context.services.ops.syncStatus(),
});

const explainScore = defineReadTool({
  name: 'explain_score',
  title: 'Why an initiative scores what it does',
  scope: 'read:backlog',
  description:
    "One initiative's current score with every intermediate the active method used, the sentence it produced, and how the number has moved over time. Use it when a ranking is surprising — a number nobody can interrogate stops being trusted the first time it surprises someone. Scores are attributable to the method *and version* that produced them, so two rows with different `methodVersion` are not comparable.",
  input: z.strictObject({
    initiativeId: entityId,
    historyLimit: z.int().min(0).max(100).default(10),
  }),
  result: z.object({
    initiative: initiativeBrief,
    /** Null until a ranking has been persisted for this initiative. */
    score: z
      .object({
        value: z.number(),
        methodId: z.string(),
        methodVersion: z.int(),
        /** Every intermediate the method used, so the number can be argued with. */
        factors: z.record(z.string(), z.number()),
        explain: z.string(),
        computedAt: z.string(),
      })
      .nullable(),
    history: z.array(scoreBrief.extend({ computedAt: z.string() })),
  }),
  async run(input, context) {
    const initiative = await context.services.work.get(input.initiativeId, context.now);
    const history =
      input.historyLimit === 0
        ? []
        : await context.services.work.scoreHistory(input.initiativeId, input.historyLimit);

    return {
      initiative: brief({
        initiative,
        score: initiative.score?.value ?? null,
        // The rank is a property of an ordering, and this tool computes none.
        rank: null,
      }),
      score:
        initiative.score === null
          ? null
          : {
              value: initiative.score.value,
              methodId: initiative.score.methodId,
              methodVersion: initiative.score.methodVersion,
              factors: initiative.score.factors,
              explain: initiative.score.explain,
              computedAt: initiative.score.computedAt,
            },
      history: history.map((record) => {
        const dto = toScoreDto(record);
        return {
          value: dto.value,
          methodId: dto.methodId,
          methodVersion: dto.methodVersion,
          computedAt: dto.computedAt,
        };
      }),
    };
  },
});

export const readTools: readonly ReadTool[] = [
  focusNow,
  listInitiatives,
  areaBalance,
  kpi,
  objectives,
  listTakeaways,
  syncStatus,
  explainScore,
];

export { initiativeBrief, brief, MAX_TOOL_PAGE };
