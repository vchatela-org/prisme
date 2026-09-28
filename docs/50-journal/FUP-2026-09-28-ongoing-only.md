# FUP · 2026-09-28 · Only what is under way is prioritized or measured

**Asked:** after #122 kept future objectives out of sight, the owner made it the rule everywhere:
*every process, prioritization and KPI included, applies only to what is active and under way,
whatever its form.* Recorded as
[ADR-0035](../20-decisions/0035-only-what-is-under-way-is-prioritized-or-measured.md), accepted on
the owner's decision.

## What was there

The audit went form by form: objective, initiative, project, area and ritual.

- **Selection did not know about dates or projects.** `selectNowSet` read status, blockers and size.
  `earliest_start` was read by the schedule engine alone. A project's status was read by nothing at
  all, so `paused` changed nothing anywhere. Work that could not start before next year, or sat in
  a paused project, could be offered a slot and was queued in *Up next*.
- **The ranking numbered every scored initiative**, so the same work took a Backlog rank among work
  under way.
- **KPI attainment listed every objective, whatever the window.** The Year Review's table said *for
  2026* while showing three years of objectives, since its window runs 36 months back for the
  charts, and next year's objectives with them.
- **Already fine:** a retired area is not ranked. Capacity and adherence only count what happened.
  A ritual has no start and no status. The anchor priority reads statuses as they are, not selection.

## What was done

- **The domain.**
  - `notUnderWay(initiative, { today, projectStatusById })` returns `not_started` or
    `project_inactive`.
  - `selectNowSet` takes that context as a **required** fourth argument. Work not under way is
    placed `unchanged` in `untouched` with its reason, and work in flight keeps its slot.
  - `objectiveCountsIn(objective, from, to)`: the period overlaps the window and the objective is
    not a draft.
- **The API.**
  - `buildRanking` reads the projects and the instance's day, passes them to selection, and ranks
    only work under way (or `now`). Positions stay contiguous and in the method's order.
  - `GET /backlog` returns `notUnderWay` on each row.
  - `GET /kpi` reports attainment only for objectives counted in the window.
  - The two reasons are added to the view DTO and to the MCP `focus_now` manifest (regenerated).
- **The web.**
  - The Backlog's rank column says *Not started* or *Project not active*, with a tooltip.
  - Focus's wording covers both reasons.
  - The Year Review's attainment table keeps the year it reviews.
  - The in-flight orphans on the Objectives screen and in the review leave out work not under way.
- **Docs.**
  - ADR-0035.
  - A fifth rule in [`12-scoring.md`](../12-scoring.md) §5.
  - The `earliest_start` and project `status` rows in [`10-model.md`](../10-model.md).
  - A principle row in `CLAUDE.md`.
  - [`18-user-guide.md`](../18-user-guide.md) §3 and §5.
- **Tests:**
  - domain: selection with a later `earliest_start`, on its first day, with paused and done
    projects, in flight, and with an unknown project; `objectiveCountsIn` on overlap, drafts, judged
    objectives and an unreadable period;
  - web: the wording for both reasons;
  - API integration: Focus neither offers nor queues either case, the Backlog gives no rank and the
    reason while the others keep a contiguous ranking, the work is ranked again on its first day,
    and KPI attainment is shown for this year, the first half-year and next year.

## Decisions taken

- **Scored, not ranked.** The score describes the initiative, so it is kept, and the plugin
  contract and the score history stay as they are. The rank is today's prioritization, so it is
  withheld.
- **Work in flight is never taken out.** A person put it in `now`, and §5.1 already says demotion
  belongs to a review.
- **Draft objectives are not measured, and judged ones are.** A met, missed or dropped objective was
  under way in its period. The Year Review is where it is read.
- **Nothing is stored or rewritten.** *Under way* is read from dates and containers on every
  request, so it corrects itself on the day with no job to run.
- **`paused` joins the rule.** The owner said *active*, and a paused project whose work still
  competes for `now` is the same mismatch.

## Surprises

- **A project's status was never read.** `paused` had been in the model since P0 and meant nothing.
  It now takes the project's queued work out of selection and ranking.
- **The Year Review's attainment was mislabelled** before any of this: *for 2026* over three years
  of objectives.

## Follow-ups

- **The MCP `propose_now_set` does not warn** when it names work not under way. It warns about
  blockers and size, and a warning for this would join them.
- **The web's `today` is UTC** on the Objectives screen and in the review (#122). The API uses the
  instance's timezone. They can differ for an hour or two after midnight.

## Specs touched

- [ADR-0035](../20-decisions/0035-only-what-is-under-way-is-prioritized-or-measured.md), and its row
  in the ADR index.
- [`12-scoring.md`](../12-scoring.md) §5, [`10-model.md`](../10-model.md) §4 and §5,
  [`18-user-guide.md`](../18-user-guide.md) §3 and §5, and `CLAUDE.md` §2.
