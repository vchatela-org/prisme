# W13 · History backfill

**Depends on:** W03 · **Wave:** 4
**Files you may touch:** `apps/sync/backfill/**`

## Why

The balance factor needs observed capacity, and the KPI dashboard needs trends. Both require history
that exists in the task tool's completion record but has never been analysed. Without a backfill,
prisme starts blind and stays blind for a month.

## Read first

- [`../12-scoring.md`](../12-scoring.md#4-measuring-capacity) — the duration preference order and the
  stated limitations
- [ADR-0014](../20-decisions/0014-lanes-outside-the-backlog.md) — Run counts toward capacity,
  Signals do not
- [ADR-0016](../20-decisions/0016-document-tool-owns-processes.md) — where recurring durations come
  from

## Scope

1. **Fetch completion history** from the task tool, as far back as it provides, with pagination and
   rate-limit handling.
2. **Attribute each completion to an area** using the area mapping. Report anything unattributable
   rather than silently dropping it — an unmapped project is a configuration gap, not noise.
3. **Estimate duration** in the documented order: recorded duration, then the declared duration of
   the matching process page for recurring work, then the configured default.
4. **Classify lanes**: Change, Run, Signals, Ritual. Signals are excluded from capacity; Run is
   included.
5. **Ritual adherence**: reconstruct the series for recurring work tied to a habit.
6. **Materialise** weekly per-area capacity so the dashboard does not recompute years of history on
   every load.
7. **Idempotence**: re-running produces the same result and never double-counts.

## Out of scope

Displaying any of it (W09) · the scoring computation (W01) · adopting entities (W12).

## Contract

- `prisme-sync backfill --from <date>` — idempotent, resumable, reports coverage and gaps.
- Materialised weekly capacity rows, recomputable from source at any time.

## Definition of done

- Re-running over the same period produces identical results — the double-count test is the one that
  matters.
- Unattributable completions are **reported with counts**, not swallowed.
- Recurring work picks up its declared duration; the fallback is used only where nothing better
  exists, and the proportion is reported.
- Signals are excluded from capacity; Run is included — verified with fixtures.
- Materialised rows match an on-the-fly computation over the same window.
- Runs to completion over a multi-year history without exhausting rate limits.

## Notes

- **The known limitation must be carried through, not hidden.** Recurring work is under-represented
  in completion history, and much of what matters in some areas never becomes a task at all. Report
  what fraction of capacity rests on estimates rather than measurements, so W09 can label it.
- Resumability matters: a multi-year backfill will hit a rate limit, and restarting from zero each
  time makes it effectively impossible.
- Mechanical and well-specified — a good candidate for a cheaper model.
- **Wave 4 conflict risk**: you touch `apps/sync`, the UI agents touch `apps/web`, so collision is
  unlikely — but coordinate before adding anything shared.
- Real completion history is real personal data. Nothing from it goes into a fixture or a journal
  entry.
