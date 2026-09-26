# FUP-2026-09-26 · The adoption queue refreshes itself, and takeaways reach the Inbox

**Date:** 2026-09-26 · **Branch:** `fup/2026-09-26-adoption-scan-and-takeaways` · **Kind:** follow-up

## Why

Three gaps found while writing a user guide from the code:

- **G9** — the adoption scan ran only as `prisme-sync adopt --plan`, a Job somebody launches. A task
  labelled in the task tool, or an area mapping changed, left `/adoption` unchanged until then. The
  restore-rehearsal entry had already measured the effect: one scan, days old, taken before any area
  existed, so no candidate carried an area.
- **G6** — `adopt()` accepted a `takeawayTypeProperty`, and nothing passed one. Every takeaway was
  therefore untyped, and an untyped takeaway is never proposed as an initiative.
- **G10** — nothing wrote the `takeaway` table, so the Inbox's "from readings" half was always empty
  and *promote takeaway* was unreachable.

## What changed

- `DOCTOOL_TAKEAWAY_TYPE_PROPERTY` (sync and API) names the takeaways store's type property, and both
  places that run the scan pass it.
- The scan mirrors typed, open takeaways into `takeaway` after a **successful** read of the store:
  insert or refresh the kind; a row whose page has gone is removed **unless promoted** — the link is
  prisme's. No text is stored, as `docs/10-model.md` §8 requires.
- The scan runs **once a day** in the first full pass (beside the capacity refresh, under the same
  lock; a failure is logged and does not fail the pass), and **on demand**: `POST /adoption/scan`
  (`write:adoption`) behind the reconciler's lock, answering counts only, and a *Rescan* button on
  `/adoption`. All three are one function.

## Decisions worth keeping

- The API answers with counts, never the report: the rendered scan carries real titles.
- An unread takeaways store leaves the mirror alone. "Could not read" is not "holds nothing".
- The scan stays plan-only. It writes the candidate list and the takeaway mirror — prisme's own
  tables — which is why the daily pass may run it with the write freeze on.

## Verified

Unit project (2003) and integration project (210, dedicated database) green locally. New: the scan
mirrors only typed open takeaways and nothing when the store was unread; the SQL inserts, refreshes,
forgets, and keeps a promoted row; the route answers counts and needs `write:adoption`.

## Specs touched

`docs/10-model.md` §8 (how the mirror is filled), `docs/13-migration.md` §4 (when the queue is
re-read), `docs/15-runtime.md` §2 (the new variable).

## Not done

- Guard 4's `mappingProperty` is still unconfigured; nobody has an earlier automation's id column to
  name yet.
