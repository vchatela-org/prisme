# W02 · Schedule and dependency engine

**Depends on:** W01 · **Wave:** 2
**Files you may touch:** `packages/domain/schedule/**`

## Why

Initiatives depend on each other, and when one moves the others must move with it. This is the
engine behind the Timeline surface — and, later, a candidate scoring method that ranks by slack
rather than guessed urgency.

## Read first

- [`../10-model.md`](../10-model.md) — `depends_on`, `earliest_start`, `planned_start/end`, `size`
- [`../12-scoring.md`](../12-scoring.md) — how `size` relates to duration
- [ADR-0005](../20-decisions/0005-allocate-before-ranking.md) — capacity constrains scheduling

## Scope

1. **Duration estimation**: map `size` (Fibonacci) to a working-days estimate through a configurable
   table, calibrated later against observed cycle times.
2. **Forward and backward pass** over the dependency DAG: earliest start/finish, latest start/finish,
   **slack**, and the critical path.
3. **Constraints**: dependency edges, `earliest_start`, and per-area weekly capacity derived from
   that year's weights — an area with 5% of capacity cannot run four initiatives at once.
4. **Deadline feasibility**: for each initiative with a deadline, report slack and flag those that
   cannot be met. **Flag, never silently move a deadline.**
5. **Replanning**: given a moved initiative, recompute dependents and return a diff — what moved, by
   how much, and which deadlines that breaks.
6. **Explainability**: every computed date carries *why* — which constraint bound it. A Gantt chart
   nobody can interrogate is a Gantt chart nobody trusts.

## Out of scope

Rendering (W10) · persistence · scheduling individual tasks — prisme schedules **initiatives**; the
task tool schedules tasks, and due dates stay with the user
([ADR-0003](../20-decisions/0003-deadline-prioritizes-due-plans.md)).

## Contract

```ts
export function schedule(initiatives, areas, config, now): Schedule
export function replan(schedule, move: { id, newStart }): ReplanDiff
export function criticalPath(schedule): InitiativeId[]

interface ScheduledInitiative {
  earliestStart; earliestFinish; latestStart; latestFinish;
  slackDays; onCriticalPath;
  deadlineFeasible: boolean;
  boundBy: 'dependency' | 'earliest_start' | 'capacity' | 'none';   // the why
}
```

Pure, like W01. `now` is an argument.

## Definition of done

- Classic CPM cases from fixtures produce textbook results — verify against hand-computed values,
  not against your own implementation.
- Cycles are rejected with the offending path named.
- Capacity constraint demonstrably delays an initiative in an over-subscribed area, and `boundBy`
  says `capacity`.
- Replanning a move propagates to all transitive dependents, and the diff is exact.
- An infeasible deadline is flagged; no deadline is ever mutated.
- Determinism: identical inputs, identical output, including ordering. Sort explicitly — never rely
  on map or set iteration order.

## Notes

- **Calendar arithmetic is where this will break.** Decide up front whether durations are working
  days or calendar days, put it in the config, and test around weekends, month ends and the
  daylight-saving transitions. Use a date library; do not do arithmetic on `Date` by hand.
- Capacity as a scheduling constraint is the part most likely to be over-engineered. Start with a
  simple weekly budget per area and stop there — the goal is a plausible plan, not an optimiser.
- `boundBy` is not a nice-to-have. Without it the Timeline cannot explain itself, and an
  unexplainable plan gets overridden and then ignored.
