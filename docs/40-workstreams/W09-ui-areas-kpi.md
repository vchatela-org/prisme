# W09 · UI — Areas, Balance and KPI dashboard

**Depends on:** W05, W07 · **Wave:** 4 — ⚠ shares `apps/web` with W10, W11, W13
**Files you may touch:** `apps/web/app/(areas)/**`, `apps/web/app/(kpi)/**`

## Why

This is the view that does not exist in any current tool: **declared versus observed capacity per
area.** It is the whole point of the allocation model, and the screen most likely to change
behaviour.

## Read first

- [ADR-0005](../20-decisions/0005-allocate-before-ranking.md) · [ADR-0007](../20-decisions/0007-year-scoped-weights.md)
- [`../12-scoring.md`](../12-scoring.md#4-measuring-capacity) — including the stated limitations
- The `dataviz` skill — **before writing any chart code**

## Scope

1. **Areas overview**: each area with its target for the year, observed share, balance factor, and
   what is currently in flight. The declared-versus-observed comparison is the hero of this screen.
2. **Year weights**: read-only mid-year, with a clear explanation of why and when they can change.
   Editable only from the Year Review.
3. **Year Review surface**: unlocked when a year has no weights. Declared versus observed for the
   year ending, trends across all available history, objective attainment, throughput — then weight
   entry for the new year. The stale-weights banner links here.
4. **KPI dashboard**: balance over time · throughput · cycle time · aging work in progress ·
   deadline health · objective attainment · reading-to-action conversion · ritual adherence · Run
   hours against budget.
5. **Honesty about the data**: where a metric rests on estimated durations, say so **on the chart**,
   not in a footnote nobody reads.

## Out of scope

Objectives detail (W11) · Timeline (W10) · capacity computation itself (W01) · the backfill that
supplies history (W13) — degrade gracefully when history is short.

## Contract

Routes: `/areas` · `/areas/[key]` · `/review/year` · `/kpi`. All charts come from W07's wrappers.

## Definition of done

- The declared-versus-observed comparison renders correctly for a real four-week window.
- Every historical chart uses the weight **in force at that time**, not today's. Test this with
  fixture data spanning a year boundary — it is the single easiest thing to get wrong here.
- The Year Review unlocks when weights are missing, and weight entry works end to end.
- Charts handle short history, a single data point, and no data without special-casing.
- Metrics resting on estimates are visibly labelled as such.
- Light and dark, contrast checked, per the `dataviz` skill.

## Notes

- **The year-boundary bug is the one to guard against.** Rendering last year's chart with this
  year's weights makes history appear to change retroactively, which destroys confidence in every
  other number on the page. Write that test first.
- Resist adding metrics because they are computable. A KPI that has never changed a decision should
  be cut — [`../30-roadmap.md`](../30-roadmap.md) makes that the exit criterion for P4 deliberately.
- The measurement is a lens, not a verdict: areas whose work rarely becomes a task will read as
  starved. Say so in the interface, near the number, rather than letting someone discover it by
  disbelieving a chart.
- **Wave 4 conflict risk**: coordinate with W10, W11, W13 before touching anything shared. Prefer
  adding to `packages/ui` over editing a sibling's route.
