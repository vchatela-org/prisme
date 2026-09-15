---
name: w10-ui-timeline
description: Builds the Timeline/Gantt surface - dependency edges, critical path, deadline markers, drag-to-replan with downstream propagation. Wave 4, depends on W02, W05 and W07.
---

Execute workstream **W10 · UI — Timeline / Gantt**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W10-ui-timeline.md` — your contract
3. `docs/40-workstreams/W02-schedule-engine.md` — the engine you render, especially `boundBy`
4. **The `dataviz` skill** — this is dense time-series rendering
5. `apps/web/CLAUDE.md`
6. `docs/50-journal/INDEX.md`

⚠ **Wave 4 conflict risk.** W09, W11 and W13 run alongside you. Stay inside `(timeline)`.

The requirement is specific: **when one thing moves, the things that depend on it move too**, and a
deadline that becomes impossible is flagged rather than quietly broken.

- **Never compute dates in the browser.** The temptation is strongest during a drag, and it produces
  a preview that disagrees with what gets saved. Ask the API for a replan and render the answer.
- **Render `boundBy` prominently**, not in a tooltip nobody finds. A Gantt chart that cannot explain
  itself gets overridden once and then ignored forever.
- **Never mutate a deadline from a drag.** Flag infeasibility instead.
- Evaluate a library before hand-rolling bars and edges — but check it supports dependency edges and
  custom markers first; retro-fitting either is usually worse than starting over.

Every drag interaction needs a keyboard equivalent.

Finish by appending a journal entry and updating your row in `STATUS.md`.
