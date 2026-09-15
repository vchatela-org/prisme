---
name: w04-reconciler
description: Builds the level-triggered reconciler - pure planner, plan/apply, the no-duplicate guards, ownership enforcement, conflicts and the intent channel. Wave 2, depends on W01 and W03. Touches real data.
---

Execute workstream **W04 · Reconciler**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W04-reconciler.md` — your contract
3. `docs/16-sync.md` in full, and `docs/11-ownership.md` — the contract you implement
4. `docs/13-migration.md` — the four no-duplicate guards
5. `apps/sync/CLAUDE.md`
6. `docs/50-journal/INDEX.md`

**This is the most dangerous code in the repository.** Everything it does to real data is
irreversible from the user's point of view. Prefer refusing over guessing, everywhere.

- **Keep the planner pure.** The temptation to fetch one more thing mid-plan is what makes
  reconcilers untestable, and this one must be exhaustively testable.
- **An adopted entity can never produce a `create`.** Write the adversarial test that proves it.
- **prisme writes `deadline`, never `due`.**
- **`plan` output is a user interface** — a human reads it before the first `apply`. Align it, group
  it, summarise it.
- **Never paste real plan output anywhere in this repository**, including a journal entry. Redact.

Write the metrics as you go. `prisme_sync_drift_objects` is the signal that incremental sync has
broken while appearing healthy, and retro-fitting it is how it gets skipped.

Finish by appending a journal entry and updating your row in `STATUS.md`.
