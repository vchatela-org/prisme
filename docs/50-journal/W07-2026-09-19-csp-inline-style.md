# W07 · 2026-09-19 · Colour without a style attribute

**Agent:** Claude Opus 5 · **Duration:** one session · **PR** #28 · **Outcome:** complete

Closes the cross-workstream defect W08 found by running the screens
([its entry](W08-2026-09-19-ui-focus.md), finding 1): the design system painted data-derived colour
with a `style` attribute, and the policy W14 sends refuses every one of them.

## What was done

`packages/ui` no longer emits a `style` attribute anywhere, and neither does `apps/web`.

Colour now travels two ways, and which one applies is a property of the element rather than a
judgement call:

| Where | How | Why |
|---|---|---|
| HTML | a literal utility class — `colorSlotClass(slot)` → `bg-series-3` | Tailwind resolves it to the same custom property through `@theme inline`, so the theme still switches |
| SVG | a `fill` / `stroke` / `width` attribute | CSP governs the `style` attribute, not presentation attributes — which is why the charts never had this bug |

The currency between them is the **slot** (`1`–`8`, or `lane`), which is what an area's key already
hashes to. `colorSlotVar` and `colorSlotClass` both derive from it, so a bar and its tooltip key
cannot disagree — previously the chart props carried a CSS colour string, which only one of the two
could use.

- `<AreaBadge>`, `<AreaSwatch>` and `<BalanceMeter>`'s dot: a class.
- `<BalanceMeter>`'s fill: an **SVG `rect`**. Its width is a percentage from data, so it can be
  neither a utility class nor a pre-generated one without rounding the reading; as an attribute it
  needs neither.
- Chart legends and tooltips: `LegendItem.color` became `colorClass`, and `BarDatum.color` /
  `LineSeries.color` became `slot`. Wave 4 has not started, so this is the cheap moment to change it.
- `<DataTable>`'s `column.width` became `widthClass`. It was a CSS length in a `style` attribute,
  which means **column widths have silently done nothing since the policy landed**; nothing passes
  one yet.
- The gallery's token demos: literal classes, and an SVG swatch for the colour grid, since the token
  to paint is chosen at runtime there.
- Two SVG `<text>` elements carried `font-variant-numeric` inline for no reason. They are
  `tabular-nums` now.

`ColorVar` is a template literal type (`var(--prisme-${string})`), so the values that reach an SVG
attribute are token references by construction rather than by review.

## Decisions taken

**The policy does not move.** `style-src` without `unsafe-inline` is the difference between an XSS
being a bug and being a total compromise of an application holding read/write tokens to an entire
personal workspace (docs/14-threat-model.md). `'unsafe-hashes'` would have made the old code work
and is the same concession wearing a disguise.

**A quantised width was considered and rejected.** Pre-generating `.prisme-fill-0…100` would have
kept the meter a `div`, at the cost of rounding a reading the component states numerically beside
itself. The SVG rect is exact, adds no CSS, and matches how `<BarChart>` has drawn bars since W07.

**The guard is a render test, not only a grep.** `no-inline-style.test.tsx` renders thirteen
component cases with `react-dom/server` and asserts the markup carries no `style="…"`. That is the
first component test in the repository, so `vitest.config.ts` now includes `*.test.tsx`; they run in
the same node project, because `react-dom/server` needs no browser. A source-level sibling walks
`packages/ui` and `apps/web` for the same rule, since `apps/web` still has no component harness.
Both were watched fail against a reinstated `style={{ … }}` before being trusted.

## Verified by running

Built, served, and driven in a browser through a throwaway local identity provider — the same
harness shape W08 described and threw away, thrown away again. On `/gallery`, which renders every
affected component:

- **12 CSP style violations, down from ~100.** Every one of the twelve is Radix's own markup: the
  hidden `<select>` behind `<Select>`, the six hidden radio inputs behind `<FibonacciSelect>`, two
  roving-focus `outline:none`s, a tab panel's `animation-duration:0s`, and the toast region's
  `pointer-events:none`. None is prisme's, and none can be fixed from this repository.
- Area colour is **present in the first paint** rather than arriving at hydration, and the balance
  meters fill to the right fractions — a quarter for an area on half its share, exactly half for one
  on target, full for one past twice it.
- `/` logs exactly one violation (a Radix roving-focus `outline:none` in the theme toggle).

Also settled while in there, because it looked wrong and is not: the middleware sets the nonce on
the **response** only, not on the forwarded request as Next's own CSP documentation shows — and
Next 16 applies it to all ten script tags and the stylesheet link regardless. Nothing to fix.

## Surprises

**The remaining twelve are all from the primitive library.** A strict `style-src` and Radix are not
fully compatible, and the residue is not cosmetic everywhere: the hidden `<select>` and the hidden
radio inputs are hidden *by an inline style*, so under this policy they are visible. They sit behind
the component they belong to and read as stray controls. No fix from here short of patching the
dependency; recorded rather than solved.

## Follow-ups

- **Radix's inline styles, above.** Owner: W07 with W14. The options are a `pnpm patch`, replacing
  the two primitives that carry visible residue, or accepting it; none should be `'unsafe-hashes'`.
- **`apps/web` still has no component harness.** The render guard covers `packages/ui` only; the web
  tree is covered by the source walk, which cannot see what a dependency emits. Unchanged from W08.
- **A committed fixture harness** — a local keypair, a minted assertion, a seeded database — is now
  the third session to be rebuilt and thrown away. Owner: W00 or W07.
- `next.config.mjs`'s unrecognised `eslint` key and the deprecated `middleware` convention still
  warn on every boot. Pre-existing, W00's.

## Specs touched

None. `packages/ui/CLAUDE.md` changed: it documented the inline style with a custom property as
"the only sanctioned use of `style`", which the policy had already made untrue.
