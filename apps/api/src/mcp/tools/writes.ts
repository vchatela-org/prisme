import { z } from 'zod';
import { areaKey, calendarDate, entityId, fibonacci, initiativeStatus } from '../../dto/common.js';
import { ApiError } from '../../http/errors.js';
import type { Change, McpTool } from '../tool.js';
import { defineReadTool, defineWriteTool } from '../tool.js';
import { initiativeBrief, brief } from './reads.js';

/**
 * The write tools — the sharpest edge in the system.
 *
 * Each declares a `plan` and an `execute`, and the dispatcher will not reach
 * the second without a confirmation bound to the output of the first
 * (`server.ts`). What that buys is worth stating precisely, because it is *not*
 * protection against a stolen token: the threat this answers is a well-meaning
 * agent with a valid credential and a misunderstood instruction
 * (docs/14-threat-model.md §4). Authentication has nothing to say about that.
 *
 * ### Writing a `plan` that actually goes stale
 *
 * A plan is hashed and re-derived at execution; a mismatch is a refusal. Two
 * rules follow, and both are easy to break without noticing:
 *
 *  1. **Read the world into `before`.** A diff that reports only what it wants
 *     the world to become hashes identically before and after somebody else's
 *     edit, and the confirmation then authorises a change nobody saw. Every
 *     `before` below is a live read.
 *  2. **Never put the clock in a plan.** A timestamp anywhere inside makes every
 *     confirmation stale within a millisecond, and trains whoever sees it to
 *     retry until it works — which is the failure mode `hashPlan`'s own comment
 *     warns about. `apply` is the one with the sharp edge here: a reconciler
 *     result carries `startedAt` and `finishedAt`, and neither reaches the diff.
 *
 * ### Refusals belong in `plan`, not in `execute`
 *
 * A dry run that cannot see a refusal is not a preview of the write. Promoting
 * a principle, dropping without a reason, closing a review twice: each is
 * checked while planning, so the agent is told *before* it asks a human to
 * confirm something that was never going to happen.
 */

/** The estimate a captured item carries until somebody triages it. */
const UNTRIAGED_ESTIMATE = 1;

function change(input: Omit<Change, 'field'> & { field?: string | null }): Change {
  return { ...input, field: input.field ?? null };
}

/** Stable ordering, so two runs of the same plan hash the same. */
function ordered(changes: readonly Change[]): readonly Change[] {
  return [...changes].sort((left, right) => {
    const key = (value: Change): string => `${value.entity}:${value.id ?? ''}:${value.field ?? ''}`;
    const [a, b] = [key(left), key(right)];
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// ── capture ─────────────────────────────────────────────────────────────────

const capture = defineWriteTool({
  name: 'capture',
  title: 'Capture an initiative into the inbox',
  scope: 'write:initiative',
  description:
    'Files a new initiative in the **inbox**, untriaged. Phrase the title as a result — "fence replaced", not "work on fence": an activity has no completion condition, which is how something stays open for two years. It always lands in `inbox` and never anywhere else; moving it is `set_status`, and estimating it is `score_initiative`. `areaKey` is required and has no default — `area_balance` lists the areas that exist, and if the request does not say which one it belongs to, **ask rather than guess**: an initiative filed in the wrong area is counted against the wrong capacity and ranked against the wrong things. An inbox item is never selected into a now set and carries no meaningful score until it is triaged, which is why the estimates default rather than being required. The dry run lists any existing initiative in the same area with the same title, so a duplicate is visible before it is created. There is no delete: a capture you regret is `set_status` to `dropped` with a reason, which is deliberate — an unexplained disappearance is indistinguishable from a deletion six months later.',
  input: z.strictObject({
    title: z.string().min(1).max(500),
    areaKey,
    projectId: entityId.optional(),
    value: fibonacci.optional(),
    timeCriticality: fibonacci.optional(),
    risk: fibonacci.optional(),
    size: fibonacci.optional(),
    /** A hard external constraint. prisme writes `deadline` and never `due` (ADR-0003). */
    deadline: calendarDate.optional(),
  }),
  result: initiativeBrief,
  async plan(input, context) {
    const estimates = {
      value: input.value ?? UNTRIAGED_ESTIMATE,
      timeCriticality: input.timeCriticality ?? UNTRIAGED_ESTIMATE,
      risk: input.risk ?? UNTRIAGED_ESTIMATE,
      size: input.size ?? UNTRIAGED_ESTIMATE,
    };

    // The duplicate check is also what makes this plan state-dependent: a
    // create has no `before` of its own, so without it the confirmation could
    // not notice that the very thing being created had appeared meanwhile.
    const similar = await context.services.work.backlog(
      {
        areaKeys: [input.areaKey],
        search: input.title,
        sort: 'title',
        direction: 'asc',
        page: { limit: 10, offset: 0 },
      },
      context.now,
    );
    const normalise = (value: string): string => value.trim().toLowerCase();
    const duplicates = similar.items
      .filter((entry) => normalise(entry.initiative.title) === normalise(input.title))
      .map((entry) => entry.initiative.id)
      .sort();

    return {
      summary: `Create one initiative in ${input.areaKey}, in the inbox.`,
      changes: [
        change({
          op: 'create',
          entity: 'initiative',
          id: null,
          before: null,
          after: {
            title: input.title,
            areaKey: input.areaKey,
            status: 'inbox',
            projectId: input.projectId ?? null,
            deadline: input.deadline ?? null,
            ...estimates,
          },
        }),
        // Part of the diff, not a warning: if a duplicate appears between the
        // dry run and the execution, the hash moves and the confirmation is
        // refused rather than quietly creating the second copy. `observe`
        // rather than `create`, so it does not inflate the count a human reads
        // to decide whether this is about to duplicate something.
        change({
          op: 'observe',
          entity: 'initiative',
          id: null,
          field: 'sameTitleInArea',
          before: duplicates,
          after: duplicates,
        }),
      ],
      warnings:
        duplicates.length === 0
          ? []
          : [
              `${String(duplicates.length)} initiative(s) in ${input.areaKey} already carry this exact title: ${duplicates.join(', ')}. Adopting existing work must never create a second copy (ADR-0010).`,
            ],
    };
  },
  async execute(input, _plan, context) {
    const created = await context.services.work.create(
      {
        title: input.title,
        areaKey: input.areaKey,
        projectId: input.projectId,
        status: 'inbox',
        value: input.value ?? UNTRIAGED_ESTIMATE,
        timeCriticality: input.timeCriticality ?? UNTRIAGED_ESTIMATE,
        risk: input.risk ?? UNTRIAGED_ESTIMATE,
        size: input.size ?? UNTRIAGED_ESTIMATE,
        deadline: input.deadline,
        dependsOn: [],
      },
      context.now,
    );
    return brief({ initiative: created, score: created.score?.value ?? null, rank: null });
  },
});

// ── promote_takeaway ────────────────────────────────────────────────────────

const promoteTakeaway = defineWriteTool({
  name: 'promote_takeaway',
  title: 'Promote a reading takeaway into an initiative',
  scope: 'write:takeaway',
  description:
    "Creates an initiative from an action takeaway and records the link. It **links, it does not copy**: the takeaway stays where it is, in the document tool, and the initiative gets the title you write here rather than the takeaway's own text — a takeaway is phrased as an idea and an initiative has to be phrased as a result. A takeaway of kind `principle` is refused outright: a principle never enters the backlog. A takeaway already promoted is refused too, because promoting it twice duplicates the work. The new initiative lands in the **inbox**, untriaged, exactly as `capture` does. `takeawayId` comes from `list_takeaways` — which cannot search by topic, because prisme holds the link and not the text.",
  input: z.strictObject({
    takeawayId: entityId,
    title: z.string().min(1).max(500),
    areaKey,
    value: fibonacci,
    timeCriticality: fibonacci,
    risk: fibonacci,
    size: fibonacci,
  }),
  result: initiativeBrief,
  async plan(input, context) {
    const takeaway = await context.services.lanes.getTakeaway(input.takeawayId);

    if (takeaway.kind !== 'action') {
      throw new ApiError(
        'unprocessable',
        'a principle never enters the backlog; it surfaces as context when its area is reviewed',
      );
    }
    if (takeaway.promotedTo !== null) {
      throw new ApiError(
        'conflict',
        'this takeaway has already been promoted, and promoting it twice would duplicate the work',
      );
    }

    return {
      summary: `Promote one action takeaway into a new initiative in ${input.areaKey}.`,
      changes: [
        change({
          op: 'create',
          entity: 'initiative',
          id: null,
          before: null,
          after: {
            title: input.title,
            areaKey: input.areaKey,
            status: 'inbox',
            value: input.value,
            timeCriticality: input.timeCriticality,
            risk: input.risk,
            size: input.size,
          },
        }),
        change({
          op: 'promote',
          entity: 'takeaway',
          id: takeaway.id,
          field: 'promotedTo',
          before: takeaway.promotedTo,
          after: 'the initiative created above',
        }),
      ],
      warnings:
        takeaway.areaKey === null || takeaway.areaKey === input.areaKey
          ? []
          : [
              `the takeaway is filed under ${takeaway.areaKey} and the initiative is being created in ${input.areaKey}`,
            ],
    };
  },
  async execute(input, _plan, context) {
    const created = await context.services.lanes.promote(
      input.takeawayId,
      {
        title: input.title,
        areaKey: input.areaKey,
        value: input.value,
        timeCriticality: input.timeCriticality,
        risk: input.risk,
        size: input.size,
      },
      context.now,
    );
    return brief({ initiative: created, score: created.score?.value ?? null, rank: null });
  },
});

// ── score_initiative ────────────────────────────────────────────────────────

const ESTIMATE_FIELDS = ['value', 'timeCriticality', 'risk', 'size'] as const;

const scoreInitiative = defineWriteTool({
  name: 'score_initiative',
  title: 'Set an initiative’s estimates',
  scope: 'write:initiative',
  description:
    'Changes the four estimates the active scoring method reads — value, time criticality, risk and size — on the Fibonacci scale (1, 2, 3, 5, 8, 13); a 4 or a 6 cannot be constructed. It does **not** write a score: scores are computed from these by the active method and appended to history with the method and version that produced them (ADR-0006). It scores an initiative and never a task — nothing in the task tool carries a score (ADR-0004). Omitted fields are left alone. If you have a title rather than an `initiativeId`, `list_initiatives` with `search` is how you resolve one.',
  input: z.strictObject({
    initiativeId: entityId,
    value: fibonacci.optional(),
    timeCriticality: fibonacci.optional(),
    risk: fibonacci.optional(),
    size: fibonacci.optional(),
  }),
  result: initiativeBrief,
  async plan(input, context) {
    const current = await context.services.work.get(input.initiativeId, context.now);

    const changes = ESTIMATE_FIELDS.flatMap((field) => {
      const after = input[field];
      if (after === undefined || after === current[field]) return [];
      return [
        change({
          op: 'update',
          entity: 'initiative',
          id: current.id,
          field,
          before: current[field],
          after,
        }),
      ];
    });

    return {
      summary:
        changes.length === 0
          ? 'Every estimate already holds the requested value; nothing would change.'
          : `Change ${String(changes.length)} estimate(s) on one initiative.`,
      changes: ordered(changes),
      warnings: [],
    };
  },
  async execute(input, _plan, context) {
    const updated = await context.services.work.update(
      input.initiativeId,
      {
        value: input.value,
        timeCriticality: input.timeCriticality,
        risk: input.risk,
        size: input.size,
      },
      context.now,
    );
    return brief({ initiative: updated, score: updated.score?.value ?? null, rank: null });
  },
});

// ── set_status ──────────────────────────────────────────────────────────────

const setStatus = defineWriteTool({
  name: 'set_status',
  title: 'Move one initiative to another status',
  scope: 'write:initiative',
  description:
    'Transitions a single initiative and writes the event log with the before and after. The ladder is `inbox` (untriaged) → `later` → `next` → `now` (in flight) → `done`, with `waiting` for blocked on someone else, `review` for finished but unverified, and `dropped` for abandoned. **"I finished it" is `done`.** Moving to `dropped` requires a `reason`: a drop with no reason is indistinguishable from a deletion six months later, and the reason is the only part anyone re-reads. To change what the week contains, prefer `propose_now_set` — it shows the whole now set moving at once, where this shows one row; use this one when a single initiative moves for its own reasons. If you have a title rather than an `initiativeId`, `list_initiatives` with `search` is how you resolve one.',
  input: z.strictObject({
    initiativeId: entityId,
    to: initiativeStatus,
    reason: z.string().min(1).max(500).optional(),
  }),
  result: initiativeBrief,
  async plan(input, context) {
    const current = await context.services.work.get(input.initiativeId, context.now);

    if (input.to === 'dropped' && input.reason === undefined && current.droppedReason === null) {
      throw new ApiError('unprocessable', 'dropping an initiative needs a reason');
    }

    if (current.status === input.to) {
      return {
        summary: `That initiative is already ${input.to}; nothing would change.`,
        changes: [],
        warnings: [],
      };
    }

    const blocked = current.blockedBy.length > 0 && (input.to === 'now' || input.to === 'next');

    return {
      summary: `Move one initiative from ${current.status} to ${input.to}.`,
      changes: [
        change({
          op: 'status',
          entity: 'initiative',
          id: current.id,
          field: 'status',
          before: current.status,
          after: input.to,
        }),
      ],
      warnings: blocked
        ? [
            `it still waits on ${String(current.blockedBy.length)} unfinished dependency/ies: ${current.blockedBy.join(', ')}`,
          ]
        : [],
    };
  },
  async execute(input, _plan, context) {
    const updated = await context.services.work.transition(
      input.initiativeId,
      input.to,
      input.reason,
      context.identity,
      context.now,
    );
    return brief({ initiative: updated, score: updated.score?.value ?? null, rank: null });
  },
});

// ── propose_now_set ─────────────────────────────────────────────────────────

/** Where an initiative leaving the now set goes. It is queued, not demoted to the backlog. */
const DEMOTED_TO = 'next';

const proposeNowSet = defineWriteTool({
  name: 'propose_now_set',
  title: 'Propose what the now set should contain',
  scope: 'write:initiative',
  description:
    'Replaces the now set with exactly the initiatives listed: anything named that is not `now` moves to `now`, and anything currently `now` that is not named moves to `next`. This is the tool for "here is what the week should be" — it shows the whole change as one diff, which is what makes it reviewable. It does not demote anything to the backlog and it does not drop anything. Every id must exist: one bad id refuses the whole proposal rather than applying part of it, and `list_initiatives` with `search` is how you turn a title into one. It will warn, and not refuse, when the proposal exceeds the work-in-progress limits: those limits are still a candidate rather than a decision (OQ-2 is open), and refusing on an undecided number would be inventing the decision.',
  input: z.strictObject({
    initiativeIds: z.array(entityId).max(20),
  }),
  result: z.object({
    promoted: z.array(entityId),
    demoted: z.array(entityId),
    now: z.array(initiativeBrief),
  }),
  async plan(input, context) {
    const focus = await context.services.work.focus(context.now);
    const desired = [...new Set(input.initiativeIds)].sort();

    const currentlyNow = focus.now
      .filter((entry) => entry.initiative.status === 'now')
      .map((entry) => entry.initiative.id);

    // Read every named initiative, so a bad id is a refusal at plan time rather
    // than a half-applied set at execution time.
    const named = await Promise.all(
      desired.map((id) => context.services.work.get(id, context.now)),
    );

    const promoted = named.filter((initiative) => initiative.status !== 'now');
    const demoted = currentlyNow.filter((id) => !desired.includes(id));

    const changes = [
      ...promoted.map((initiative) =>
        change({
          op: 'status',
          entity: 'initiative',
          id: initiative.id,
          field: 'status',
          before: initiative.status,
          after: 'now',
        }),
      ),
      ...demoted.map((id) =>
        change({
          op: 'status',
          entity: 'initiative',
          id,
          field: 'status',
          before: 'now',
          after: DEMOTED_TO,
        }),
      ),
    ];

    const perArea = new Map<string, number>();
    for (const initiative of named) {
      perArea.set(initiative.areaKey, (perArea.get(initiative.areaKey) ?? 0) + 1);
    }

    const warnings: string[] = [];
    if (desired.length > focus.limits.maxNow) {
      warnings.push(
        `the proposal holds ${String(desired.length)} initiatives and the candidate limit is ${String(focus.limits.maxNow)} (OQ-2 is open on this number)`,
      );
    }
    for (const [key, count] of [...perArea].sort()) {
      if (count > focus.limits.maxNowPerArea) {
        warnings.push(
          `${key} would hold ${String(count)} concurrent initiatives and the candidate per-area limit is ${String(focus.limits.maxNowPerArea)}`,
        );
      }
    }
    for (const initiative of promoted) {
      if (initiative.blockedBy.length > 0) {
        warnings.push(
          `${initiative.id} waits on ${String(initiative.blockedBy.length)} unfinished dependency/ies`,
        );
      }
      if (!initiative.sizedForNow) {
        warnings.push(`${initiative.id} is too large to be started in one sitting`);
      }
    }

    return {
      summary:
        changes.length === 0
          ? 'The now set already holds exactly those initiatives; nothing would change.'
          : `Promote ${String(promoted.length)} into the now set and return ${String(demoted.length)} to ${DEMOTED_TO}.`,
      changes: ordered(changes),
      warnings,
    };
  },
  async execute(input, plan, context) {
    const promoted: string[] = [];
    const demoted: string[] = [];

    // The plan is the instruction list. Re-deriving the moves here would be a
    // second implementation of the same decision, and the confirmation the
    // human read was bound to *this* list.
    for (const entry of plan.changes) {
      if (entry.entity !== 'initiative' || entry.id === null) continue;
      const to = entry.after === 'now' ? 'now' : DEMOTED_TO;
      await context.services.work.transition(
        entry.id,
        to,
        undefined,
        context.identity,
        context.now,
      );
      (to === 'now' ? promoted : demoted).push(entry.id);
    }

    const focus = await context.services.work.focus(context.now);
    return {
      promoted: promoted.sort(),
      demoted: demoted.sort(),
      now: focus.now.map((entry) =>
        brief({ initiative: entry.initiative, score: entry.score, rank: entry.rank }),
      ),
    };
  },
});

// ── start_review ────────────────────────────────────────────────────────────

const reviewSummary = z.object({
  id: entityId,
  cadence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  decisions: z.array(z.string()),
  checklist: z.record(z.string(), z.boolean()),
});

const startReview = defineWriteTool({
  name: 'start_review',
  title: 'Open a review session',
  scope: 'write:review',
  description:
    'Opens a review session of the given cadence. The session is what makes a review a record rather than an afternoon: decisions land on it, and closing it takes a snapshot of per-area capacity as it was at that moment. The dry run reports any session of the same cadence that is still open — a second open weekly review means decisions land on whichever one the caller happened to pick. Use `record_review_decision` to add to it and to close it.',
  input: z.strictObject({
    cadence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  }),
  result: reviewSummary,
  async plan(input, context) {
    const existing = await context.services.ops.reviews(input.cadence, { limit: 20, offset: 0 });
    const open = existing.items
      .filter((session) => session.completedAt === null)
      .map((session) => session.id)
      .sort();

    return {
      summary: `Open one ${input.cadence} review session.`,
      changes: [
        change({
          op: 'create',
          entity: 'review',
          id: null,
          before: null,
          after: { cadence: input.cadence },
        }),
        change({
          op: 'observe',
          entity: 'review',
          id: null,
          field: 'alreadyOpen',
          before: open,
          after: open,
        }),
      ],
      warnings:
        open.length === 0
          ? []
          : [
              `${String(open.length)} ${input.cadence} session(s) are already open: ${open.join(', ')}. Closing one before opening another keeps decisions on the session they were made in.`,
            ],
    };
  },
  async execute(input, _plan, context) {
    const opened = await context.services.ops.openReview(input.cadence, context.now);
    return {
      id: opened.id,
      cadence: opened.cadence,
      startedAt: opened.startedAt,
      completedAt: opened.completedAt,
      decisions: opened.decisions,
      checklist: opened.checklist,
    };
  },
});

// ── record_review_decision ──────────────────────────────────────────────────

const recordReviewDecision = defineWriteTool({
  name: 'record_review_decision',
  title: 'Record a decision on a review session',
  scope: 'write:review',
  description:
    'Appends one decision to an open review session, optionally ticks checklist steps, and optionally closes it. The decision text is appended to what is already there — it never replaces the list. Closing takes the capacity snapshot, and a session that is already closed is not re-snapshotted: what the review saw is part of what the review decided, and recomputing it later would let a review quietly rewrite its own history.',
  input: z.strictObject({
    reviewId: entityId,
    decision: z.string().min(1).max(1000).optional(),
    checklist: z.record(z.string().min(1).max(100), z.boolean()).optional(),
    complete: z.boolean().optional(),
  }),
  result: reviewSummary,
  async plan(input, context) {
    const session = await context.services.ops.getReview(input.reviewId);

    if (session.completedAt !== null && input.complete === true) {
      throw new ApiError('conflict', 'that review session is already closed');
    }

    const changes: Change[] = [];

    if (input.decision !== undefined) {
      changes.push(
        change({
          op: 'update',
          entity: 'review',
          id: session.id,
          field: 'decisions',
          before: session.decisions,
          after: [...session.decisions, input.decision],
        }),
      );
    }

    if (input.checklist !== undefined) {
      const merged = { ...session.checklist, ...input.checklist };
      const moved = Object.keys(merged).some((step) => merged[step] !== session.checklist[step]);
      if (moved) {
        changes.push(
          change({
            op: 'update',
            entity: 'review',
            id: session.id,
            field: 'checklist',
            before: session.checklist,
            after: merged,
          }),
        );
      }
    }

    if (input.complete === true) {
      changes.push(
        change({
          op: 'update',
          entity: 'review',
          id: session.id,
          field: 'completedAt',
          before: null,
          after: 'closed, with a capacity snapshot taken at that moment',
        }),
      );
    }

    return {
      summary:
        changes.length === 0
          ? 'Nothing was asked for that would change this session.'
          : `Change ${String(changes.length)} thing(s) on one review session${input.complete === true ? ', and close it' : ''}.`,
      changes: ordered(changes),
      warnings: [],
    };
  },
  async execute(input, _plan, context) {
    const session = await context.services.ops.getReview(input.reviewId);
    const updated = await context.services.ops.updateReview(
      input.reviewId,
      {
        decisions:
          input.decision === undefined ? undefined : [...session.decisions, input.decision],
        checklist:
          input.checklist === undefined ? undefined : { ...session.checklist, ...input.checklist },
        complete: input.complete,
      },
      context.now,
    );

    return {
      id: updated.id,
      cadence: updated.cadence,
      startedAt: updated.startedAt,
      completedAt: updated.completedAt,
      decisions: updated.decisions,
      checklist: updated.checklist,
    };
  },
});

// ── the reconciler pair ─────────────────────────────────────────────────────

const syncReport = z.object({
  ran: z.boolean(),
  full: z.boolean(),
  counts: z.record(z.string(), z.int()),
  applied: z.int().nullable(),
  conflicts: z.int().nullable(),
  refused: z.string().nullable(),
  failures: z.int(),
  drift: z.int(),
  report: z.string().nullable(),
});

/**
 * What of a reconciler pass is allowed into a diff.
 *
 * `startedAt` and `finishedAt` are dropped deliberately — see the file header.
 * They are the only two fields of a `SyncRunResult` that move between two
 * identical passes, and including them would make every `apply` confirmation
 * stale on arrival.
 */
function reconcilerShape(result: {
  ran: boolean;
  counts: Readonly<Record<string, number>>;
  conflicts: number | null;
  refused: string | null;
  failures: number;
  drift: number;
}): Record<string, unknown> {
  return {
    ran: result.ran,
    counts: result.counts,
    conflicts: result.conflicts,
    refused: result.refused,
    failures: result.failures,
    drift: result.drift,
  };
}

const planPreview = defineReadTool({
  name: 'plan_preview',
  title: 'What the reconciler would do',
  scope: 'write:sync',
  description:
    'Runs a reconciler pass in `plan` mode and returns the rendered plan: what prisme would write to the document tool and the task tool, and what it would refuse. It writes nothing, inward or outward, and it hands back **nothing to execute**. **Use this when you only want to look.** If you intend to go on and apply, skip it and call `apply` without a `confirmationToken` instead — that also runs a `plan` pass, returns the same picture, and additionally gives you the token to confirm it with. Calling both just runs the reconciler twice. It needs the `write:sync` scope despite changing nothing, because running a pass reaches the external tools — the scope `POST /sync` requires for `mode: plan` for the same reason, so the outward kill switch withholds it too. Read `counts.create` first: a plan that would create anything when you expected it to adopt is the failure ADR-0010 exists to catch.',
  input: z.strictObject({
    full: z.boolean().default(false),
  }),
  result: syncReport,
  async run(input, context) {
    const result = await context.services.ops.runSync('plan', input.full);
    return {
      ran: result.ran,
      full: result.full,
      counts: result.counts,
      applied: result.applied,
      conflicts: result.conflicts,
      refused: result.refused,
      failures: result.failures,
      drift: result.drift,
      report: result.report,
    };
  },
});

const apply = defineWriteTool({
  name: 'apply',
  title: 'Apply the reconciler plan',
  scope: 'write:sync',
  description:
    'Executes a reconciler pass against the document tool and the task tool. **This is the one to call when you mean to push changes out** — start with it and no `confirmationToken`: that dry run *is* a `plan` pass, so it returns everything `plan_preview` would and a token besides. Confirm with that token and the diff you were shown is the diff applied; it is refused if a second pass would now do something different. It is the only tool here that writes outside prisme. It writes `deadline` and never `due` (ADR-0003), and it never completes or deletes a task. **What it creates outward, prisme cannot take back** — read `counts.create` before confirming. A refusal in the result — the write freeze, or a plan over the create threshold — means nothing was written, not that some of it was; `sync_status` says in advance whether the freeze is on.',
  input: z.strictObject({
    full: z.boolean().default(false),
  }),
  result: syncReport,
  async plan(input, context) {
    const preview = await context.services.ops.runSync('plan', input.full);

    const warnings: string[] = [];
    if (preview.refused !== null) {
      warnings.push(`this pass would be refused: ${preview.refused}`);
    }
    if ((preview.counts['create'] ?? 0) > 0) {
      warnings.push(
        `the plan would create ${String(preview.counts['create'])} object(s) in the external tools; adopting existing work must never create (ADR-0010)`,
      );
    }
    if (!preview.ran) {
      warnings.push('another pass holds the lock, so this planned against no fresh reading');
    }

    return {
      summary:
        preview.refused === null
          ? `Apply a reconciler pass: ${describeCounts(preview.counts)}.`
          : `The reconciler would refuse this pass: ${preview.refused}.`,
      changes: [
        change({
          op: 'reconcile',
          entity: 'sync',
          id: null,
          field: input.full ? 'full' : 'incremental',
          before: null,
          after: reconcilerShape(preview),
        }),
      ],
      warnings,
    };
  },
  async execute(input, _plan, context) {
    const result = await context.services.ops.runSync('apply', input.full);
    return {
      ran: result.ran,
      full: result.full,
      counts: result.counts,
      applied: result.applied,
      conflicts: result.conflicts,
      refused: result.refused,
      failures: result.failures,
      drift: result.drift,
      report: result.report,
    };
  },
});

function describeCounts(counts: Readonly<Record<string, number>>): string {
  const parts = Object.entries(counts)
    .filter(([tag, count]) => count > 0 && tag !== 'skip')
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([tag, count]) => `${String(count)} ${tag}`);
  return parts.length === 0 ? 'nothing to do' : parts.join(', ');
}

export const writeTools: readonly McpTool[] = [
  capture,
  promoteTakeaway,
  scoreInitiative,
  setStatus,
  proposeNowSet,
  startReview,
  recordReviewDecision,
  planPreview,
  apply,
];
