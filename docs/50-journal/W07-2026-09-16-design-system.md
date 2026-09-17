# W07 · 2026-09-16 · Design system and application shell

**Agent:** w07-design-system (Claude Opus 5) · **Duration:** one session · **PR** #20 ·
**Outcome:** complete

## What was done

`packages/ui` went from an empty slot to the design system the four wave-4 workstreams compose
from, and `apps/web` gained the shell, the stylesheet and the component gallery.

- **Tokens.** One palette file, one semantic token table, both themes named explicitly for every
  token. The stylesheet is generated from the tokens during the package build rather than
  maintained beside them.
- **Primitives** on Radix and cmdk in the shadcn/ui idiom: button, input, textarea, label, field,
  select, combobox, dialog, sheet, popover, tooltip, toast, tabs, badge, skeleton, and the four
  states (empty, error, permission-denied, loading).
- **Domain components:** `<AreaBadge>`, `<ScorePill>`, `<StatusChip>`, `<FibonacciSelect>`,
  `<BalanceMeter>`, `<DataTable>`, `<SyncStatus>`.
- **Charts:** a frame that owns the awkward states and the table twin, plus a bar chart, a line
  chart and a stat tile, drawn as SVG against a tested geometry module.
- **Shell:** navigation with landmarks and a skip link, breadcrumbs, the year-weights banner,
  toasts, the ⌘K command palette, and a theme that survives the first paint without an inline
  script.
- **Gallery** at `/gallery`, rendering every component with fixture data.

## Decisions taken

**The palette is the `dataviz` skill's validated default, adopted wholesale.** Both modes were
re-validated with the skill's own validator rather than trusted: light passes every check with a
documented contrast WARN on three slots; dark passes all five. Inventing a palette would have meant
re-deriving a colour-vision-safe hue *order*, which is the part of a categorical palette that
actually does the work.

**There is no in-fill label anywhere in the system, and no helper to make one.** The obvious
luminance-picking helper was written, tested and deleted: measured against the palette, the best
available ink on the slot-1 blue reaches 4.46:1 in light mode, so a label inside a mark misses AA
whichever ink it picks. Values ride outside the mark, and the table twin keeps every value
reachable. Dark mode would have carried it comfortably — which is the trap, and the reason one
failing theme forbids a pattern everywhere.

**The accent is two tokens, not one.** `accent` paints marks; `accent-solid` is the fill behind
text. The contrast test found white-on-slot-1 at 4.42:1 — a mark colour is tuned to sit on the
surface, not to carry a label. A measurement, not a preference.

**Initiative status does not wear the status palette.** `good`/`warning`/`serious`/`critical` are a
severity scale with reserved meaning; `later` is not a warning and `dropped` is not a failure.
Spending those four colours on the eight statuses would leave nothing to say "this deadline is at
risk" with, and would make every backlog look like an incident board. Chips are ink and surface,
with `now` alone carrying the accent, and every chip pairs an icon with its label.

**Lanes have no hue.** Run and Signals wear the de-emphasis neutral. They count toward capacity and
never toward ranking (ADR-0014), so on a capacity chart they are context; painting upkeep in a
categorical hue makes it compete with the areas on the one chart where the areas are the subject.

**The balance meter is scaled to the target, not to 100%.** An area on 5% and an area on 30% are
both right when they get their agreed share, and on a 0–100% track they look nothing alike. The
track runs 0 to twice the target — the same ceiling the balance factor already clamps to — so
"on its share" is always the midpoint. The meter fill also keeps the *area's* colour rather than
carrying severity as the skill's meter spec suggests: these render as a list of six, and
recolouring a row by how well it is doing is the recolour-on-filter anti-pattern in disguise.
Severity is carried by an arrow, a word and the number.

**The theme is a cookie read on the server, not an inline script.** The usual anti-flash trick is a
blocking inline `<script>`; W14 is bringing a content security policy whose whole purpose is to
refuse those. The server stamps `data-theme` while rendering, and a reader who has chosen nothing
is served by the `prefers-color-scheme` media query with no JavaScript at all.

**Charts are hand-drawn SVG rather than a charting library.** The mark specs the skill fixes — a 2px
surface gap, a 4px rounded data-end square at the baseline, hairline solid gridlines — are each
something a library has to be fought for, and the awkward states have to live in our wrapper
anyway. The geometry is a pure module with 32 tests; the components are thin.

**Area colour: a hash, with an override map, and the reason is arithmetic.** Six areas hashed into
eight slots collide most of the time — the birthday problem, not a bad hash. Both FNV-1a and djb2
were measured over the fixture keys and both collide. So the hash is the fallback and an instance
pins its areas explicitly, keyed by area key so it is still never positional. The map lives in
instance configuration, never here: area keys are instance data and this repository is public. A
`areaColorCollisions()` reporter exists so a clash is found before a reader finds it.

## Surprises

**Two bugs were invisible to every static check and only appeared when the application was run.**
Both are the reason the gallery was started and driven rather than merely built:

1. `parseThemePreference` lived in a `'use client'` module, so the server layout calling it threw
   at *request* time — `tsc`, ESLint, Vitest and `next build` were all perfectly happy. The fix is
   the `@prisme/ui/server` entry point, and the same trap is waiting for every future server
   component that reaches for a helper from the barrel.
2. `<DataTable>`'s key handler never read `event.ctrlKey`, so Ctrl+Home could not reach the header.
   The pure `moveFocus` had the behaviour and was tested for it; the component simply never passed
   the modifier. A test of a pure core does not test its wiring.

**The brief's *Files you may touch* named paths that do not exist** — `apps/web/app/layout.tsx` and
`apps/web/styles/**`, written before W00 created `apps/web/src/`. Corrected in the brief, with the
four files touched outside the list named there and below.

**`fixtures/` was excluded from the Docker build context.** The gallery imports it, so the web
image failed to build. Un-excluded, with the reasoning in `.dockerignore`: fixtures are invented
data and the exclusion that matters is `seed/`.

**Every route is now dynamic.** Reading the theme cookie in the root layout opts the whole
application out of static rendering. Acceptable here — every surface is personal data behind auth —
but worth knowing before someone wonders where the static pages went.

## Follow-ups

- **`next.config.mjs` still carries an `eslint` key** that Next 16 no longer recognises, and warns
  about it on every build. Left alone: it is W00's file and outside this workstream's tree. One
  line to delete, in a `ci/` or `fix/` branch. **Owner:** whoever touches the web config next.
- **A ninth chart series throws** from `seriesVar`, and the two chart components catch it and
  render their error state. If a surface ever legitimately needs more, the answer is folding into
  "Other" or faceting — not a ninth hue. **Owner:** W09/W10/W11.
- **No visual regression test.** The contrast arithmetic is tested, but nothing would catch a
  layout that breaks at 320px. A Playwright screenshot job is a reasonable later addition; it was
  not in scope here. **Owner:** unassigned.
- **The gallery ships in the production image.** One build everywhere was the simpler choice; if
  that becomes unwanted, the route group is `(gallery)` and is easy to lift out. **Owner:** W14,
  when it decides what is behind auth.

## Specs touched

- `docs/40-workstreams/W07-design-system.md` — *Files you may touch* corrected to the paths that
  exist, with the gallery route and the four out-of-tree files named.
- `packages/ui/CLAUDE.md` — rewritten to describe what landed: the stack, the two traps (literal
  utility classes, the server entry point), and the testing expectation that a component is not
  finished until it has been run.
