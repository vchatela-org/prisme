# FUP-2026-09-26 · Adopting a task no longer clears its deadline, resets its priority or moves it

**Date:** 2026-09-26 · **Branch:** `fup/2026-09-26-adoption-keeps-task-fields` · **Kind:** follow-up

## Why

Reading the planner to write a user guide found that ADR-0010's promise — *adoption creates nothing*
— held, and a weaker one did not: adoption could **erase**. It copied a task's title and area, set
the initiative to `inbox` with estimates of 3, and linked it. On the pass after the link, every
prisme-owned field that differed was classified as prisme stating its own value for the first time
(`last_applied` empty ⇒ `update`, never `conflict`), so it would have been applied silently:

- **G1** the task's deadline **cleared** — the initiative had none;
- **G2** its priority **reset to the lowest** — `inbox` maps there;
- **G3** the task **moved** to the area's first mapping, when it was filed in another location of
  the same area.

The write freeze meant none of this had happened. It would have, on the first pass after the freeze
lifted, to every task adopted during the functional phase.

## What changed

- **G1**: the `adopt` action that binds a decided link now carries an `adopt_deadline` operation
  when the task has a deadline and the initiative has none; the intent channel's capture carries the
  deadline into the insert. prisme-side only — no outward write. `adoptDeadline`'s SQL repeats the
  planner's rule (`where deadline is null`), so a deadline prisme holds is never replaced.
- **G2**: priority is asserted only from `next` on, **or** once prisme has written it — so an adopted
  task at `inbox`/`later` keeps its hand-set priority, and a demoted initiative is still lowered.
- **G3**: a linked anchor already in *any* location its area maps to stays there. The area's home is
  where an anchor is *created*, not a claim that the area's other locations are wrong. An anchor
  outside its area is still moved, and an initiative's **project** location is still enforced
  (`DesiredAnchor.locationSource` says which one the location came from).

## Verified

`plan.adoption.test.ts` runs the planner over **two passes** — link, then the pass after — because
the damage was always in the second: 8 tests, **3 of which fail against the previous planner**
(checked by swapping it back). `adoption-deadline.integration.test.ts` covers the SQL half against
PostgreSQL. Whole sync unit project green.

## Specs touched

`docs/12-scoring.md` (the priority rule's one exception), `docs/13-migration.md` §4 (*Adopting links,
and does not rewrite*).

## Not done

- **G5** — one `create` in a plan refuses the whole plan while `SYNC_CREATE_THRESHOLD` is `0`. That is
  guard 3 of ADR-0010 working as written, and changing it would contradict an Accepted ADR. After
  adoption, the operator raises the threshold; the user guide says so.
- The anchor label and the backlink line are still added to an adopted task on the first writing
  pass. They are what makes a task an anchor, and the notes below line one are kept.
