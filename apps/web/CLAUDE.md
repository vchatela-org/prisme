# apps/web

**The Next.js application. Four workstreams share this tree — read the coordination note.**

Owned by [W08](../../docs/40-workstreams/W08-ui-focus.md) (Focus, Backlog, Inbox),
[W09](../../docs/40-workstreams/W09-ui-areas-kpi.md) (Areas, KPI),
[W10](../../docs/40-workstreams/W10-ui-timeline.md) (Timeline),
[W11](../../docs/40-workstreams/W11-ui-objectives-reviews.md) (Objectives, Reviews),
[W15](../../docs/40-workstreams/W15-creation-flows.md) (creation flows).

## ⚠ Coordination

Wave 4 runs W09, W10, W11 and W13 in parallel, and the first three all live here. **Stay inside your
route group.** If you need something shared, add it to `packages/ui` rather than editing a sibling's
route — a component in the shared package merges cleanly; an edit to someone else's screen does not.

## Non-negotiables

1. **Never compute a score, a date or a balance factor in the browser.** Ask the API. UI-side
   computation drifts from `packages/domain`, and the two then disagree in front of the user.
2. **Build from `packages/ui`.** The gallery route shows what exists. Re-inventing a table is how
   four parallel agents produce four different tables.
3. **No hard-coded colour.** Import tokens. Area colour is derived from the area **key**, never from
   list position — positional colour changes meaning when an area is added.
4. **Read the `dataviz` skill before writing any chart code** or choosing any chart colour. Charts
   appear on three surfaces; decided per-screen, the dashboard reads as unrelated products.
5. **Fixture data in every screenshot, story and example.** This repository is public
   ([`17-privacy.md`](../../docs/17-privacy.md)).

## Conventions

- Server components for reads; optimistic updates for score and status changes.
- Route groups per surface: `(focus)`, `(backlog)`, `(inbox)`, `(areas)`, `(kpi)`, `(timeline)`,
  `(objectives)`, `(review)`, `(adoption)`, `(create)`.
- Every screen needs loading, empty, error and permission-denied states. The empty states matter
  most — a first-run empty backlog should explain how to fill it.
- Keyboard-first: every action reachable without a mouse, and every drag interaction has a keyboard
  equivalent.

## Explainability is a product requirement

Every score is hoverable to reveal its factors; every computed date says which constraint bound it.
A ranking or a plan that cannot be interrogated gets overridden once and then ignored — at which
point prisme is decoration.

Display `explain` from the API. Do not paraphrase it in the UI; the two will drift.
