# W10 · UI — Timeline / Gantt

**Depends on:** W02, W05, W07 · **Wave:** 4 — ⚠ shares `apps/web` with W09, W11, W13
**Files you may touch:** `apps/web/app/(timeline)/**`

## Why

Dependencies only matter if you can see them move. The requirement is specific: **when one thing
moves, the things that depend on it move too**, and any deadline that becomes impossible is flagged
rather than quietly broken.

## Read first

- [`W02-schedule-engine.md`](W02-schedule-engine.md) — the engine you render; especially `boundBy`
- [`../10-model.md`](../10-model.md) — `depends_on`, `earliest_start`, `planned_start/end`
- [ADR-0003](../20-decisions/0003-deadline-prioritizes-due-plans.md) — initiatives are scheduled here;
  tasks are not

## Scope

1. **Timeline**: initiatives as bars over a time axis, grouped by area or project, zoomable from
   weeks to a year.
2. **Dependencies**: edges drawn between bars, with the **critical path** highlighted.
3. **Deadlines**: markers distinct from bars. An infeasible deadline is visibly flagged.
4. **Drag to move**: dragging an initiative triggers a replan. Show the resulting diff **before**
   committing — what moved, by how much, what it breaks.
5. **Explain any date**: clicking a bar says why it starts when it does, using `boundBy` —
   dependency, earliest start, capacity, or unconstrained.
6. **Capacity overlay**: where an area is over-subscribed in a period, show it.

## Out of scope

The scheduling algorithm (W02) · task-level scheduling — prisme schedules initiatives, the task tool
schedules tasks · editing dependencies in bulk (the initiative detail screen owns that).

## Contract

Route `/timeline`. Reads the schedule from the API; **never** computes dates in the browser.

## Definition of done

- Moving an initiative visibly moves its transitive dependents, and the preview diff matches what is
  committed.
- The critical path is correct against fixture cases hand-verified in W02.
- An infeasible deadline is flagged; **no deadline is ever mutated by a drag**.
- Clicking any bar explains its date in one sentence.
- Usable at realistic volume — 50+ initiatives — without the interface becoming unreadable.
- Keyboard alternative exists for every drag interaction.

## Notes

- **Do not compute dates in the UI.** The temptation is strong during drag, and it produces a
  preview that disagrees with what gets saved. Ask the API for a replan and render the answer.
- A Gantt chart that cannot explain itself gets overridden once and then ignored forever. `boundBy`
  is the difference between a plan and a decoration — render it prominently, not in a tooltip nobody
  finds.
- Evaluate a library before building bar-and-edge rendering by hand, but check it supports dependency
  edges and custom markers first; retro-fitting either is usually worse than starting over.
- Dense time-series rendering: the `dataviz` skill applies here too.
- **Wave 4 conflict risk**: coordinate with W09, W11, W13.
