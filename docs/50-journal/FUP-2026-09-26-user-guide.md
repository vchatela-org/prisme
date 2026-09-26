# FUP-2026-09-26 · A user guide for using prisme, not for building it

**Date:** 2026-09-26 · **Branch:** `docs/user-guide` · **Kind:** follow-up

## Why

The owner asked for a guide to **use** the app. The first draft of `docs/18-user-guide.md` was a
developer guide: environment variables, Jobs and seed files, in the order the code needs them. It
answered *how is this deployed* and left *what do I do on Monday* unanswered. Writing it also
surfaced ten gaps (G1–G10) where the guide would have had to describe a workaround instead of a
screen; those were fixed first, in four pull requests, so the guide could describe the product
rather than apologise for it.

## What changed

- `docs/18-user-guide.md`, rewritten for the person using prisme: setup once (areas, where each
  area's work lives in the task tool, which document-tool store fills which role, the year's
  weights, rituals, adoption), the daily loop (Focus, capture, Inbox, Backlog, an initiative's
  page), the three reviews, reading the numbers, what is changed where and what prisme writes once
  the freeze lifts, a short FAQ and a glossary. Every example is invented.
- Linked from `README.md`'s document table and from the layout block in `CLAUDE.md`.

It documents the state **after #94–#97**. Before the commit it was proof-read against `main` with
all four merged: palette entries, statuses, the estimate scale, review step titles, the priority
mapping, the label vocabulary, the default task duration and the on-screen button texts. Two
sentences were wrong and were corrected: work in a project mapped to no area is not shown under an
*unattributed* heading (it counts toward no area and the backfill report lists the project), and a
candidate with no area cannot be adopted until its location is mapped.

## Where the gap list went

The first draft's §10 listed G1–G10. It was not carried into the guide — a user guide is no place
for a backlog — and each gap is recorded in the journal entry of the pull request that closed it:
G1–G3 in [adoption-keeps-task-fields](FUP-2026-09-26-adoption-keeps-task-fields.md), G6, G9 and G10
in [adoption-scan-and-takeaways](FUP-2026-09-26-adoption-scan-and-takeaways.md), G8 in
[rituals-dependencies-conflicts](FUP-2026-09-26-rituals-dependencies-conflicts.md), and G4 with
G8's mapping and area-edit half in [settings-screens](FUP-2026-09-26-settings-screens.md).

## Not done, deliberately

- **G5** — one planned `create` refuses the whole plan while `SYNC_CREATE_THRESHOLD=0`. That is
  ADR-0010's guard 3 as written; changing it would contradict an Accepted ADR. The guide tells the
  operator to raise the threshold once adoption is over.
- **G7** — writes to the objectives and reviews stores are unimplemented. That is roadmap phase P7,
  and it needs a decision on which document-tool properties receive progress — an ADR, not a fix.
  The guide's role table says *nothing yet* for the reviews store.
