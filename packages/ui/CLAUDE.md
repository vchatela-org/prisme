# packages/ui

**The design system. Built in wave 1 so waves 3–5 are composition rather than invention.**

Owned by [W07](../../docs/40-workstreams/W07-design-system.md), and landed by it — this file
describes what is here, not what is planned.

## Why this exists

Four UI workstreams run in parallel. If each invents its own table, chart and spacing, the result
looks assembled rather than designed — and the merge conflicts are worse than the inconsistency.

## Non-negotiables

1. **Tokens, not values.** Colour, spacing, type, radius, elevation and motion are defined once, in
   [`src/tokens/`](src/tokens). `src/tokens/palette.ts` is the only file in the monorepo permitted
   to contain a colour literal, and `src/tokens/no-raw-colour.test.ts` walks this package and
   `apps/web` to make sure it stays that way.
2. **Area colour derives from the area key**, never from list position. Positional colour changes
   meaning when an area is added, silently invalidating every past screenshot and every reader's
   memory of the chart. See [`src/tokens/area-color.ts`](src/tokens/area-color.ts), including why
   there is an override map as well as a hash.
3. **Light and dark, both validated for contrast.** Every token names both values, and
   `src/tokens/contrast.test.ts` measures each against the surfaces it can land on. A component that
   only works in one theme is not finished.
4. **Read the `dataviz` skill before writing chart code.** The palette here is that skill's
   validated default, adopted wholesale; its slot *order* is a colour-vision safety mechanism, not a
   mood.
5. **Keyboard reachable, with visible focus**, throughout. One focus treatment, in
   [`src/lib/focus.ts`](src/lib/focus.ts).

## The stack

Tailwind v4 utilities over Radix (`radix-ui`, the single umbrella package) and `cmdk`, in the
shadcn/ui idiom — Radix supplies the focus traps, the roving focus and the ARIA wiring that a
hand-rolled dialog or combobox gets subtly wrong.

Two things follow from the way the package is built, and both bite if you do not know them:

- **Utility classes must be literal.** Tailwind scans source text, so a class name assembled at
  runtime (`` `bg-${token}` ``) is never generated. Data-derived colour therefore uses an inline
  style with a custom property — `style={{ backgroundColor: 'var(--prisme-series-3)' }}` — and that
  is the only sanctioned use of `style`.
- **`@prisme/ui/server` exists for a reason.** The main entry re-exports client components, so
  importing anything from it in a server component drags it across the client boundary and fails at
  *request* time. Tokens, contrast, chart geometry, sorting and the theme cookie are also exported
  from [`src/server.ts`](src/server.ts); use that from a server component.

The stylesheet is **generated**: `scripts/emit-css.mjs` turns the compiled tokens into
`dist/prisme.css` during the build, and `apps/web` imports it as `@prisme/ui/theme.css`. Editing CSS
by hand is editing a build artefact.

## What belongs here

Shared primitives and the domain components every surface needs:
`<AreaBadge>` · `<ScorePill>` · `<StatusChip>` · `<FibonacciSelect>` · `<BalanceMeter>` ·
`<DataTable>` · `<SyncStatus>`, plus `<BarChart>`, `<LineChart>` and `<StatTile>`.

**What does not belong here:** anything only one surface needs. That belongs to the surface. This
package is for what is genuinely shared, and padding it makes it harder to use.

## The gallery is load-bearing

[`apps/web/src/app/(gallery)/gallery`](../../apps/web/src/app/(gallery)/gallery) renders every
component with fixture data. It is how four parallel agents discover what already exists instead of
building their own. **Anything added here belongs there the same day.**

## Charts

One wrapper per form, and the awkward cases — empty, loading, error, a single data point, a short
history — are handled in [`src/charts/chart-frame.tsx`](src/charts/chart-frame.tsx), never at the
call site. Wave 4 has three agents rendering charts; if they each solve the empty state
differently, the dashboard reads as three products.

`tableView` is a required prop, not an optional one: every chart has a table twin. That is the
relief the light palette needs (three slots sit below 3:1), the answer for a screen reader, and the
only way to read a value that would not fit beside its mark.

## Testing

Everything with real logic in it is a pure module with an exhaustive test: contrast, area colour,
sorting, grid movement, chart geometry, command ranking, the balance reading. They run in the
repository's ordinary node environment, alongside the domain tests.

What a unit test cannot see — a focus ring that never paints, a server/client boundary that only
fails on request, a label colliding with its axis — is checked by **running the gallery and driving
it**. Do that before claiming a component works; two real bugs in this package were found that way
and neither was visible to `tsc`, ESLint or Vitest.

Fixture data only — this repository is public ([`17-privacy.md`](../../docs/17-privacy.md)).
