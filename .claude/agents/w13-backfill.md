---
name: w13-backfill
description: Backfills completion history into per-area capacity actuals and ritual adherence, so the balance factor and KPI trends have data from day one. Wave 4, depends on W03. Mechanical.
---

Execute workstream **W13 · History backfill**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W13-backfill.md` — your contract
3. `docs/12-scoring.md`, the capacity section including its stated limitations
4. `apps/sync/CLAUDE.md`
5. `docs/50-journal/INDEX.md`

⚠ Wave 4 runs W09, W10 and W11 in `apps/web` alongside you. You are in `apps/sync`, so collision is
unlikely — but coordinate before adding anything shared.

Without this, prisme starts blind and stays blind for a month.

- **The double-count test is the one that matters.** Re-running must produce identical results.
- **Report unattributable completions with counts** rather than swallowing them. An unmapped project
  is a configuration gap, not noise.
- **Carry the known limitation through, do not hide it.** Report what fraction of capacity rests on
  estimates rather than measurements, so W09 can label it on the chart.
- **Resumability matters.** A multi-year backfill will hit a rate limit, and restarting from zero
  each time makes it effectively impossible.

Real completion history is real personal data. Nothing from it goes into a fixture or a journal
entry.

Finish on a branch (`ws/<id>`): the journal entry and `STATUS.md` row first, then a pull request
filled in from `.github/pull_request_template.md` and **green on every check**. Fix what is red and
push again; do not weaken a check to get past it. **Do not merge it yourself** — a human merges.
