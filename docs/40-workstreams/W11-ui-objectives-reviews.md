# W11 · UI — Objectives, Key Results and Reviews

**Depends on:** W05, W07 · **Wave:** 4 — ⚠ shares `apps/web` with W09, W10, W13
**Files you may touch:** `apps/web/app/(objectives)/**`, `apps/web/app/(review)/**`

## Why

The review is where decisions are actually made; automation only removes the copying. And objectives
have never been connected to the work — this is the screen that closes that loop.

## Read first

- [ADR-0012](../20-decisions/0012-key-results-first-class.md) ·
  [ADR-0013](../20-decisions/0013-self-assessed-progress.md)
- [`../10-model.md`](../10-model.md) — objectives, key results, review sessions
- [`../30-roadmap.md`](../30-roadmap.md) — P3's exit criterion is what you are building toward

## Scope

1. **Objectives**: annual and monthly, by period and area. Key results with target, unit and
   progress.
2. **Progress entry**: `progress_self` set by hand, with `progress_computed` shown **beside** it.
   Where the two diverge materially, say what that means — the divergence is the finding, not a
   display artefact.
3. **Orphan detection**: an objective with no initiative behind it, and an initiative serving no
   objective. Both are worth seeing; neither is automatically wrong.
4. **Key result detail**: measurement history as a trend, the anchor task, its subtasks, and whether
   this ought to be a Ritual instead.
5. **Review wizard** — weekly first, then monthly, quarterly, yearly:
   - follows the existing checklists, one step at a time;
   - each step shows the data the step is about, so nothing needs looking up elsewhere;
   - decisions are recorded as they are made, not retyped at the end;
   - produces a written artefact and pushes the narrative outward;
   - resumable — a review interrupted halfway is not lost.
6. **Review history**: past sessions, what changed at each, and the KPI snapshot at that moment.

## Out of scope

KPI dashboard (W09) · Year Review weight entry (W09 owns that screen) · the write-back mechanism
(W04).

## Contract

Routes: `/objectives` · `/objectives/[id]` · `/review` · `/review/[cadence]` · `/review/history`.

## Definition of done

- A weekly review can be completed end to end, in the time it is meant to take, without opening
  another tool.
- An interrupted review resumes exactly where it stopped.
- Decisions taken during a review are visible in the event log and reflected immediately.
- Self-assessed and computed progress are both shown, and their divergence is explained rather than
  averaged.
- Orphan detection is correct in both directions.
- The generated artefact is worth reading a month later.

## Notes

- **The review wizard is the highest-value screen in prisme and the easiest to get wrong.** A
  checklist that merely shows steps is no better than the paper version. Each step must bring its
  own data — the whole benefit is not having to go and look.
- Never average or reconcile the two progress numbers. They measure different things, and the gap
  between them is the signal (ADR-0013).
- Resumability is not optional. Reviews get interrupted, and losing one twice means it stops
  happening.
- **Wave 4 conflict risk**: coordinate with W09, W10, W13.
