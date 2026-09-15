---
name: w02-schedule
description: Builds the pure CPM-style schedule and dependency engine - forward/backward passes, slack, critical path, capacity constraints, deadline feasibility and replanning. Wave 2, depends on W01.
---

Execute workstream **W02 · Schedule and dependency engine**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W02-schedule-engine.md` — your contract
3. `docs/10-model.md` — dependencies, dates, size
4. `packages/domain/CLAUDE.md`
5. `docs/50-journal/INDEX.md`

Pure, like W01: `now` is an argument, output is deterministic including ordering.

Two traps:
- **Calendar arithmetic.** Decide working days versus calendar days up front, put it in config, and
  test around weekends, month ends and daylight-saving transitions. Use a date library.
- **`boundBy` is not optional.** Every computed date must say which constraint bound it. Without it
  the Timeline cannot explain itself, and an unexplainable plan gets overridden and then ignored.

Resist over-engineering the capacity constraint. A simple weekly budget per area is enough — the
goal is a plausible plan, not an optimiser.

Finish by appending a journal entry and updating your row in `STATUS.md`.
