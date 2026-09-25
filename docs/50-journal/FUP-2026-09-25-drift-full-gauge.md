# FUP · 2026-09-25 · The drift alert gets the series it needed

**Agent:** Claude · **Duration:** one session · **PR** [#87](https://github.com/vchatela-org/prisme/pull/87) · **Outcome:** complete

The shape [decided on 2026-09-24](FUP-2026-09-24-drift-provenance-decision.md) is built: the last
**full** pass's drift gets its own column and its own gauge, so `docs/15-runtime.md` §5's *"above 0
on two consecutive daily full passes"* can be written as an expression that means it. **No real
value appears in this entry** — the gauge carries counts, and nothing here reads an instance.

## The defect, restated in one line

The reconciler runs every fifteen minutes and one pass a day is full. `prisme_sync_drift_objects`
carries the last pass **of any kind**, so it is 0 for almost every sample on a healthy instance, and
`min_over_time(prisme_sync_drift_objects[48h]) > 0` is reset by the incremental samples *between*
two full passes — false even when both of those full passes drifted. The rule was right and only its
expression was missing.

## What was built

- **`sync_run_state.last_drift_full_objects`** (migration 0010) — written only by a full pass, so it
  stands still across the incremental passes in between.
- **`prisme_sync_drift_full_objects`** — the gauge, republished continuously by the API from the
  stored row on every scrape, which is what supplies the samples a windowed minimum needs. The
  CronJob pod is never scraped, so without the republishing the series would exist only in the
  minutes after a full pass and the expression would mean *the last one* rather than *two
  consecutive*.
- **`docs/15-runtime.md` §5** — a new row carrying the alert and its expression; the paragraph now
  says why the alert is on the second series, and keeps the measured-zero-is-not-silence property
  stated for both.
- **`docs/16-sync.md`** — the full-pass sentence names the series the alert reads rather than the
  per-pass one.

The `coalesce` in the upsert is the load-bearing line: an incremental pass carries `null` in that
column, so the stored full-pass value survives it. Without it the gauge would be reset every
quarter hour, which is precisely the defect.

## Three properties, asserted rather than hoped

1. **An incremental pass does not move the series** — the test a full pass, then an incremental pass
   with `drift: 0`, and reads both gauges back: the per-pass one follows to 0 and the full-pass one
   stays at 4. This is the whole reason the column exists, and nothing else in the suite could see
   it.
2. **A measured zero is a sample** — a full pass that found no drift publishes `0`, which is a
   different fact from no measurement.
3. **No full pass is an absence** — an instance that has only run incremental passes serves no
   sample at all, and `absent()` keeps its meaning.

## The migration's reversal was rehearsed, not asserted

On a throwaway database, created for it: the whole set applied forward (0010 present, its ledger row
present), the exact reversal in the migration's own comment run (`DROP COLUMN`; `DELETE FROM
prisme_migration WHERE version = '0010'`), both gone, and then the migrations re-applied to prove the
reversal is complete enough to redo. The throwaway was dropped afterwards. This is written down
because "rehearsed" is a claim, and the repository's own rule is that a claim of that kind gets
checked rather than copied.

## Surprises

**The repository already had the provenance and did not publish it.** `SyncRunState.drift` carries
`full: boolean` and has since W04 — the API reads it into the struct and then ignores it. So the
information needed to *label* a series was there all along; the decision to use a second series
rather than a label was about sample continuity, not about missing data. Worth knowing before
anybody proposes collapsing the two gauges into one with a label.

**Two gauges are cheaper than one labelled series, and for a reason that is easy to get wrong.** A
labelled series looks like the tidier fix and is not: `{pass="full"}` is emitted only when a full
pass writes it, so its samples are sparse and a 48-hour minimum over it means "the last one". The
second gauge is continuous because the *stored row* is, and that is the property being bought.

**Setting one in-process gauge and not the other is an asymmetry a reader trips on.** `main.ts` sets
`syncDriftObjects` on the hand-run path; it now sets the full-pass one too, guarded by `result.full`,
because an incremental pass must leave it alone. Those gauges are still never scraped in a
deployment — recorded, not removed.

## Follow-ups

- **The deployment repository's half remains.** Its drift alert was removed rather than repaired;
  re-pointing it at `prisme_sync_drift_full_objects` is that side's change and is not done here.
- **The in-process gauges in `main.ts` are vestigial** — the API republishes from the row. Recorded
  rather than removed, because deleting them is its own decision and not this one's.
- **`DOCTOOL_DURATION_PROPERTY` remains unset**, and the two 🟡 rows that are not this one — the
  deployment's §6e colour pinning, and the outward-write gate — are untouched.

## Specs touched

- [`docs/15-runtime.md`](../15-runtime.md) §5 — the new row and the explanation of why the alert is
  on the full-pass series.
- [`docs/16-sync.md`](../16-sync.md) — the full pass names the series the alert reads.
- [`STATUS.md`](../../STATUS.md) — the register row, corrected in place.
