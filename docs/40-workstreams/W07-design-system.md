# W07 · Design system and application shell

**Depends on:** W00 · **Wave:** 1
**Files you may touch:** `packages/ui/**`, `apps/web/src/app/layout.tsx`,
`apps/web/src/styles/**`, `apps/web/src/app/(gallery)/**`, `apps/web/src/fixtures.ts`

> The two web paths above were written before W00 existed and named directories it did not create:
> the app lives under `apps/web/src/`. The gallery route and its fixture reader are listed because
> the *Contract* below requires a gallery route, which cannot live in `packages/ui` — it needs the
> app's router. W07 also touched four files outside this list, each recorded in
> [its journal entry](../50-journal/W07-2026-09-16-design-system.md): `apps/web/package.json`,
> `apps/web/postcss.config.mjs`, `apps/web/Dockerfile` and `.dockerignore` (the gallery imports
> `fixtures/`, which was excluded from the build context), and `eslint.config.mjs`.

## Why

Four UI workstreams run in parallel in wave 4. If they each invent their own table, chart and
spacing, the result looks assembled rather than designed — and the merge conflicts are worse than
the inconsistency.

Shipping this in wave 1 means everything after it is composition.

## Read first

- [`../10-model.md`](../10-model.md) — the surfaces listed there are what this must support
- The `dataviz` skill — **read it before writing any chart code or choosing any chart colour**

## Scope

1. **Foundations**: colour (light *and* dark, both validated for contrast), type scale, spacing,
   radii, elevation, motion. Tokens, not values scattered through components.
2. **Primitives** on shadcn/ui: button, input, select, combobox, dialog, sheet, popover, tooltip,
   toast, tabs, badge, skeleton, empty state.
3. **Domain components** — the ones every surface needs and none should re-invent:
   - `<AreaBadge>` — consistent colour per area, **derived from the area key** so it is stable
     everywhere
   - `<ScorePill>` — value plus an explain-on-hover
   - `<StatusChip>` — the eight initiative statuses
   - `<FibonacciSelect>` — 1·2·3·5·8·13, the only way to set a score input
   - `<BalanceMeter>` — target versus actual for one area
   - `<DataTable>` — sorting, filtering, column visibility, keyboard navigation
   - `<SyncStatus>` — last sync, duration, conflicts, force button
4. **Charts**: one wrapper per chart type used, sharing tokens, tooltips, empty and loading states.
   Follow the `dataviz` skill for form and colour.
5. **Shell**: navigation, command palette (`⌘K`), breadcrumbs, the year-weights-stale banner, toasts.
6. **States**: loading, empty, error and permission-denied treatments, defined once.
7. **Accessibility**: keyboard reachable throughout, visible focus, sensible landmarks, contrast
   checked in both themes.

## Out of scope

Any specific screen (W08–W11) · data fetching · business logic.

## Contract

- `packages/ui` exports every primitive and domain component with typed props.
- A tokens module both the web app and any chart imports — **no hard-coded colour anywhere else.**
- A component gallery route so wave 4 agents can see what exists before building their own.

## Definition of done

- Every component renders in light and dark, with contrast checked.
- The gallery route shows all of them with realistic props from `fixtures/`.
- Keyboard-only navigation works across the shell and the command palette.
- The Focus screen sketch can be assembled **entirely from these components**, with no new
  one-off styling. If it cannot, this workstream is not finished.
- Chart wrappers handle empty, loading, error and single-datapoint cases without special-casing at
  the call site.

## Notes

- **Read the `dataviz` skill first.** Charts appear across three surfaces; if their colour and form
  are decided per-screen, the dashboard reads as four unrelated products.
- Area colour must be derived from the area **key**, not from list position. Positional colour
  changes meaning when an area is added, which silently invalidates every past screenshot and every
  reader's memory.
- Resist building screen-specific components here. If only one surface needs it, it belongs to that
  surface — this package is for what is genuinely shared.
- The gallery is not a nicety. It is how four parallel agents avoid re-inventing a table.
