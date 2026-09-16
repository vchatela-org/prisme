# W02 · 2026-09-16 · Schedule and dependency engine

**Agent:** Claude Opus 5 · **Duration:** one session · **PR** [#19](https://github.com/vchatela-org/prisme/pull/19) ·
**Outcome:** complete

## What was done

`packages/domain/src/schedule/` — the engine behind the Timeline surface (W10), and behind the
slack-based scoring method [`../12-scoring.md`](../12-scoring.md#7-candidate-methods) records as a
candidate.

- **Working-day arithmetic** on whole UTC day numbers: the working week and the holidays are
  configuration, and every search is bounded rather than able to hang.
- **Forward pass** over the dependency DAG, constrained by `earliest_start`, by predecessors, and by
  per-area capacity.
- **Backward pass** giving latest start and finish, slack and the critical path, with an imposed
  deadline bounding the latest finish.
- **Deadline feasibility**, flagged per initiative and collected on the schedule. Nothing writes a
  deadline.
- **`replan`**, which recomputes the whole schedule around a move and returns an exact diff.
- **`boundBy` and `boundByIds`** on every scheduled initiative — which constraint decided the date,
  and which predecessors were behind it.
- `fixtures/schedule/cpm-cases.json`: four networks with **hand-computed** expected results.

319 tests in this package's `schedule/` alone; 726 across the repository.

## Decisions taken

**Day numbers rather than a date library.** The brief says to use a date library and not to do
arithmetic on `Date` by hand. The risk it is naming is arithmetic on *instants* — daylight saving,
month ends, leap years. W01's `entities/calendar.ts` had already removed that class of bug by
reducing every date to a whole UTC day number before anything compares or adds, and integer
arithmetic on day numbers has no hours to lose. A library would add a dependency to the one package
whose defining property is that it has almost none, and would not close a failure mode that day
numbers have not already closed. The transitions are tested explicitly in both hemispheres, in both
directions, so the claim is checked rather than asserted.

**Durations default to the identity map.** `size → working days` is a configurable table, as the
brief requires. Its default is `1·2·3·5·8·13 → 1·2·3·5·8·13`, because the brief also says the table
is calibrated later against observed cycle times: until those exist, any other curve would be a
fabricated calibration that reads like evidence. W13's completion history is what should replace it.
The table is validated as positive and non-decreasing — a table where a bigger slice takes fewer
days would let *raising* an estimate pull a deadline earlier.

**Capacity is a concurrency limit, not a rate model.** `weight% × concurrentInitiatives`, rounded,
**floored at one slot**. The floor is a value judgement made out loud: zero slots would mean an area
can never progress at all, and starving an area to nothing is a decision for a yearly review, not an
arithmetic consequence of a small percentage. An area with 5% still runs one thing at a time — it
simply cannot run four, which is the constraint the brief names. Stretching an initiative's *elapsed*
duration by the days-per-week its area receives was considered and rejected as the over-engineering
the brief's notes warn about.

**Spans are inclusive working days.** Duration `d` from working day `s` finishes at the end of the
`d`-th working day; a dependent starts the next working day after that. It makes a Gantt bar cover
exactly the days worked, with no off-by-one between the bar and the dates under it. Stated once at
the top of the module and once in the fixture, because every number in both depends on it.

**The critical path is the minimum-slack chain, not the zero-slack chain.** The two are the same
whenever every deadline is feasible. When one is not, the minimum goes negative, and the chain
running at that minimum is the one to look at — a definition that reduces to the textbook one
rather than replacing it.

**Ties on `boundBy` prefer the dependency.** When a dependency and an `earliest_start` fall on the
same day both are true, and the dependency is the one whose movement propagates, so it is the one
worth drawing on a Timeline edge.

**A replan is a full recomputation, diffed** — not dates pushed forward from the move. That is the
level-triggered discipline of [ADR-0009](../20-decisions/0009-level-triggered-reconciliation.md)
applied to planning: a diff against a recomputation is exact by construction, where a patch is exact
only for the propagation paths whoever wrote it remembered. It is also what lets the diff report a
*third* initiative moving because an area's slot changed hands — a planner that showed only the
dependency chain would hide half of what a move costs.

**A move is a request.** A dependency or a full area can refuse it; `honoured` and `boundBy` say so
rather than granting a date the plan cannot support.

No ADR was contradicted, and none was needed. Nothing in
[`OPEN.md`](../20-decisions/OPEN.md) blocked this workstream: OQ-2's parallelism appears as
`CANDIDATE_CONCURRENT_INITIATIVES`, doc-commented as deciding nothing, exactly as W01 handled
`CANDIDATE_SELECTION_LIMITS`.

## Surprises

**Slack does not know about capacity, and saying so was better than fixing it.** The forward pass is
capacity-constrained; the backward pass is not. So an initiative can report slack it cannot use,
because the days it would slip into belong to the queue behind it in its own area — visible in the
`area-capacity` fixture, where the first of four queued slices reads as having six days of float.
Fixing it properly means a resource-constrained backward pass, which is an optimiser and is exactly
what the brief says not to build. It is written into the module documentation, the fixture and the
type, in the three places someone would meet it.

**Giving a moved initiative first refusal only works among work that is ready at the same moment.**
Something already placed while the moved initiative was still waiting on a dependency keeps the slot
it took, so a move can be refused by capacity even with priority. Pre-empting a placement would mean
backtracking, and a planner that backtracks produces output nobody can follow. There is a test that
constructs exactly that case, because the first attempt at writing it accidentally constructed the
case where priority *does* win, and passed for the wrong reason.

**The fixtures were right first time, and that is the point.** All four hand-computed networks passed
on the first run. That is only meaningful because the numbers were worked out from the networks
before the engine ran — a golden file recorded from the code under test proves the code has not
changed, never that it was right.

**`latestStart` before the project start is a feature.** In the infeasible-deadline fixture the
predecessor's latest start is two days before today. That is the finding, stated precisely: to meet
that deadline the work would have had to begin before now.

## Follow-ups

- **Calibrate the duration table.** The identity default is a placeholder by design. W13 backfills
  completion history; the first honest `size → days` curve should come from it, and changing the
  default is a configuration change, not a code change. Owner: W13, then whoever runs the first
  yearly review.
- **Capacity in the backward pass** is deliberately absent, above. If the Timeline surface (W10) ends
  up showing float that a user then cannot use, that is the moment to reconsider — with an ADR,
  because it changes what slack means.
- **`schedule()` plans everything it is given that is open, `inbox` included.** Filtering is the
  caller's, because it is a selection decision. W05 and W10 should be explicit about what they pass
  rather than relying on the engine to be opinionated.
- **One line outside the brief's tree.** `packages/domain/src/index.ts` gained an export of the new
  subtree; without it nothing downstream can reach the engine. Noted rather than assumed.
- **No `plan`/`apply` here.** This engine computes; it writes nothing. `planned_start` and
  `planned_end` are returned for W04 to reconcile under its own dry-run rules.

## Specs touched

None. The model was frozen on 2026-09-15 and nothing here needed it to move. `fixtures/README.md`
gains a row for the new fixture, `STATUS.md` its row updates, and the journal index this entry.
