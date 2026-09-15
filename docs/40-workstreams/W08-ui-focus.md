# W08 · UI — Focus, Backlog, Inbox

**Depends on:** W05, W07 · **Wave:** 3
**Files you may touch:** `apps/web/app/(focus)/**`, `apps/web/app/(backlog)/**`, `apps/web/app/(inbox)/**`

## Why

These are the screens used daily. If "what should I work on now?" is not answerable in three seconds
without thinking, nothing else in prisme matters.

## Read first

- [`../10-model.md`](../10-model.md) — initiative statuses, the `now` set
- [`../12-scoring.md`](../12-scoring.md) — what the score means and how it is explained
- The component gallery from W07 — **build from it, do not re-invent**

## Scope

1. **Focus** — the default landing screen:
   - the `now` set, ranked, grouped by area, showing score with an explanation on demand;
   - today's tasks from the task tool for those initiatives;
   - what is stale — in `now` with no activity for a configured number of days;
   - sync status, and the force-sync button.
2. **Backlog**:
   - ranked table across all areas, filterable by area, status, objective and deadline;
   - inline re-scoring with `<FibonacciSelect>`, recomputing immediately;
   - status transitions by drag or menu, with **WIP guardrails that warn and explain** rather than
     silently refuse;
   - bulk selection for review work.
3. **Inbox / triage**: unpromoted captures, actionable takeaways, and anything with status `inbox`.
   Promote, schedule, or drop — each in one action.
4. **Initiative detail**: all fields, score breakdown, dependencies, linked tasks, the Notion page
   button in its three states ([ADR-0011](../20-decisions/0011-optional-narrative-page.md)), and
   activity history.
5. **Explainability everywhere**: every score is hoverable to reveal its factors. A ranking that
   cannot be interrogated stops being trusted.

## Out of scope

Areas and KPI screens (W09) · Timeline (W10) · Objectives and Reviews (W11) · creation flows (W15) —
build the entry points as disabled affordances and let W15 wire them.

## Contract

Routes: `/` (Focus) · `/backlog` · `/inbox` · `/initiative/[id]`. Server components for reads,
optimistic updates on score and status changes.

## Definition of done

- Focus loads and is readable in under a second against fixture data at realistic volume.
- The score explanation matches `explain` from the domain package exactly — no re-derivation in the
  UI. If the UI computes a score anywhere, that is a bug.
- Inline re-scoring persists and re-ranks without a full reload.
- A WIP guardrail explains *why* it fired and what to do instead.
- Keyboard-first throughout: navigate, re-score, change status, all without a mouse.
- Empty states are useful — a first-run empty backlog explains how to fill it.
- Works in light and dark.

## Notes

- **Never recompute a score in the UI.** It will drift from the domain package, and the two will
  disagree in front of the user. Display what the API returns.
- Staleness is one of the more valuable signals here — an initiative sitting in `now` untouched for
  a week is usually blocked or wrongly sized, and surfacing that early is most of what a weekly
  review is for.
- Guardrails should warn, not block. A hard refusal gets worked around, and then the model no longer
  describes reality.
- Fixture data only, in every screenshot and story.
