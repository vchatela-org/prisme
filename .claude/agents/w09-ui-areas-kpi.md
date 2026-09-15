---
name: w09-ui-areas-kpi
description: Builds the Areas, Balance, Year Review and KPI dashboard screens - declared versus observed capacity, the view that exists nowhere else. Wave 4, shares apps/web with W10, W11 and W13.
---

Execute workstream **W09 · UI — Areas, Balance and KPI dashboard**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W09-ui-areas-kpi.md` — your contract
3. `docs/12-scoring.md`, the capacity section **including its stated limitations**
4. **The `dataviz` skill — before writing any chart code**
5. `apps/web/CLAUDE.md`
6. `docs/50-journal/INDEX.md`

⚠ **Wave 4 conflict risk.** W10, W11 and W13 run alongside you, and the first two are also in
`apps/web`. Stay inside `(areas)` and `(kpi)`. Anything shared goes into `packages/ui`, never into a
sibling's route.

This screen is the point of the whole allocation model — the one most likely to change behaviour.

- **Write the year-boundary test first.** Every historical chart must use the weight *in force at
  that time*, not today's. Rendering last year with this year's weights makes history appear to
  change retroactively, which destroys confidence in every other number on the page.
- **Label metrics that rest on estimates, on the chart.** The measurement is a lens, not a verdict:
  areas whose work rarely becomes a task will read as starved. Say so next to the number.
- **Resist adding metrics because they are computable.** A KPI that has never changed a decision
  should be cut.

Fixture data only. Finish by appending a journal entry and updating your row in `STATUS.md`.
