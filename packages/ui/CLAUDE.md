# packages/ui

**The design system. Built in wave 1 so waves 3–5 are composition rather than invention.**

Owned by [W07](../../docs/40-workstreams/W07-design-system.md).

## Why this exists

Four UI workstreams run in parallel. If each invents its own table, chart and spacing, the result
looks assembled rather than designed — and the merge conflicts are worse than the inconsistency.

## Non-negotiables

1. **Tokens, not values.** Colour, spacing, type, radius, elevation and motion are defined once. No
   hard-coded colour anywhere in the monorepo.
2. **Area colour derives from the area key**, never from list position. Positional colour changes
   meaning when an area is added, silently invalidating every past screenshot and every reader's
   memory of the chart.
3. **Light and dark, both validated for contrast.** Not an afterthought — a component that only
   works in one theme is not finished.
4. **Read the `dataviz` skill before writing chart code.**
5. **Keyboard reachable, with visible focus**, throughout.

## What belongs here

Shared primitives and the domain components every surface needs:
`<AreaBadge>` · `<ScorePill>` · `<StatusChip>` · `<FibonacciSelect>` · `<BalanceMeter>` ·
`<DataTable>` · `<SyncStatus>`, plus one wrapper per chart type.

**What does not belong here:** anything only one surface needs. That belongs to the surface. This
package is for what is genuinely shared, and padding it makes it harder to use.

## The gallery is load-bearing

The component gallery route is how four parallel agents discover what already exists instead of
building their own. Keep it current — every component, with realistic props from `fixtures/`.

## Chart wrappers must handle the awkward cases

Empty, loading, error, single data point, and short history — handled **in the wrapper**, not
special-cased at each call site. Wave 4 has three agents rendering charts; if they each solve the
empty state differently, the dashboard reads as three products.

## Testing

Render every component in both themes and check contrast. Fixture data only — this repository is
public ([`17-privacy.md`](../../docs/17-privacy.md)).
