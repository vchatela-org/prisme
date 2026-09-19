# W09 · 2026-09-19 · Areas, Balance, Year Review and the KPI dashboard

**Agent:** W09 (Claude Opus 5) · **Duration:** one session · **PR** #30 · **Outcome:** complete

## What was done

Four routes — `/areas`, `/areas/[key]`, `/review/year`, `/kpi` — all server components, all
composing from `packages/ui`, none of which computes a score, a date or a balance factor. Every
number arrives from the API; this tier orders it, labels it and says what it rests on.

The decisions the screens make are extracted into four pure modules in `apps/web/src/lib`, tested
without a browser, as W08 established:

- **`weight-year.ts`** — which year's weights a bucket is drawn against. Weights are held *per
  year* and resolved from the bucket's own start date, so there is deliberately no function that
  takes one set of weights and a whole series.
- **`kpi-view.ts`** — the share arithmetic, ordering, bucket labels and the honesty sentences.
- **`year-review.ts`** — ADR-0007's gate, and what a valid allocation is.
- **`api-origin.test.ts`** — the two functions behind the CSRF fix below.

## Decisions taken

**The year-boundary test was written first**, as the brief asks, and it is the thing the
workstream is really about. Fixture weights differ between the two fixture years precisely so this
is testable; the live run confirmed it end to end, including after a new year's weights were
written (below).

**The observed share is normalised here, and that is not a second `computeCapacity`.** `/kpi`
serves attributed minutes per bucket with the domain's rules already applied — Signals arrive as
zero minutes because the API applies ADR-0014 — so the share is a sum and a division over a series
somebody else shaped. The point-in-time number a reader acts on still comes from `/balance`,
computed by `packages/domain`. The two use different windows and **will not match exactly**, which
is stated under every chart drawn from either.

**A bucket with no minutes at all is a gap, not zero.** Zero would draw six areas collapsing to the
floor and jumping back, which reads as a catastrophe rather than as a holiday.

**`mostStarved` refuses to name an area when the clamp has flattened several.** `balanceFactor` is
`clamp(target / actual, 0.5, 2)`, so every area more than twice under its share reports exactly
2.00 — three of six on the driven dataset. Naming the first of them puts a name on a tile the data
does not single out. The tile reports the count instead.

**Weight entry refuses an allocation that does not add up**, which is the opposite of how W08's
status guardrails behave. The difference is that a guardrail comments on an *observation*, and a
model that refuses to describe reality stops being used; a weight is a *definition* of how one
capacity is split, and there is no reality for the refusal to be wrong about. The running total is
live, so it is never a surprise at submit time.

**Cycle time is not drawn, and the dashboard says so where the chart would be.** prisme records no
moment at which an initiative started. Reconstructing one means pairing `status_changed` events out
of the event log — aggregation the API owns, and a second copy of it in the view layer is how two
parts of one product start disagreeing about the same number. The brief's own instruction points
the same way: resist adding metrics because they are computable.

**The Year Review lives in the `(areas)` route group.** W11 owns `(review)` and its
`/review/[cadence]`; two wave-4 agents in one directory is the conflict the coordination note
warns about. The URL is `/review/year` either way, and Next resolves the static segment ahead of
the dynamic one. **W11 should not add a `/review/year` of its own.**

No ADR was needed and none is contradicted.

## Surprises

Five, and **four of them were invisible to `tsc`, ESLint, Vitest and `next build`**. All were found
by standing up the stack and opening the pages.

1. **Every write from `apps/web` to the API was answered 403.** W14 runs its CSRF origin check on
   every state-changing request on the assertion path, and a missing `Origin` is a refusal by
   design. `apiFetch` sent none. This is not a W09 bug: it silently broke W08's estimate and status
   writes and W12's three adoption decisions. Reads were unaffected, which is why four screens'
   worth of work shipped without anyone seeing it — the pages all worked. Fixed in `apiFetch`,
   sending this tier's own configured origin, never one copied from a request header.

2. **`<LineChart>` and `<BarChart>` could not be rendered by a server component at all.** `format`
   is a function prop, functions cannot cross the server/client boundary, and every screen here is
   a server component by convention. The page 500s on first open after everything green. Fixed
   additively with `formatAs`, a serialisable descriptor; the function prop is untouched and still
   wins, so the gallery — itself a client component, which is why it never saw this — is unchanged.
   **W10 and W11 would each have hit this.**

3. **Two axis defects on every chart.** A stepped label adjacent to the always-drawn last one
   rendered on top of it (37 monthly buckets step by 5: label 35 against end 36), and the last
   label was centred on the plot edge and clipped by the viewBox — `Sep 26` rendered as `Sep 2(`.
   `packages/ui/CLAUDE.md` names "a label colliding with its axis" as exactly what only running
   finds; it was right. Both fixed, the first as a pure tested rule over every bucket count from 2
   to 60.

4. **The stale-weights banner claimed weights were "carried from 0's weights".** A three-year
   window reaches back past the first weights that ever existed; the API reports such a year as
   stale with a null source, and "carried from nowhere" is not a sentence. `staleYears` now reports
   only genuinely carried years, and the banner is keyed to the year *under way* rather than to any
   year the window touches — a year before prisme knew anything is not an open gate, and warning
   about it teaches a reader to dismiss the banner that matters.

5. **The weight form's rows were right-aligned with a gap down the left.** `<Field>` is
   `flex flex-col`; passing it a row class merges into `flex-col … items-end`. Replaced with a
   plain row. Trivial, invisible to every check, and ugly enough to undermine the one screen where
   a decision gets typed.

## Follow-ups

- **Area colour collides, on every screen, for every instance.** `areaColorSlot` hashes six area
  keys into eight slots and the birthday problem does the rest: the fixture set produces two
  collisions, and two pairs of areas render in the same hue on Focus, Backlog, Areas and KPI.
  `packages/ui` has the fix — `AreaColorProvider` with a pinning map — and **nothing in `apps/web`
  mounts it except the gallery**, because the map is meant to come from instance configuration and
  nothing loads one. Needs a configuration key and one mount in the shell. Affects W08's screens as
  much as these. Owner: W07 with W00. This is the most visible defect left.
- **W08's harness follow-up is still open, and a third workstream has now paid for it.** There is
  still no committed way to see a populated screen locally; I built the same throwaway W08 built
  (a local identity provider minting an assertion against a generated keypair, a fixture seeder,
  and a proxy that injects the assertion) and threw it away again. Four of the five findings above
  needed it. W10, W11 and W15 will each need it. Owner: W00 or W07.
- **The API's SSRF guard refuses a loopback JWKS URL**, correctly, which means a local identity
  provider needs a hostname rather than `127.0.0.1`. Worth knowing before the next person spends
  twenty minutes on it. Not a defect.
- **The CSP inline-style situation is narrower than "closed".** Every one of these screens carries
  exactly one violation — Radix's toast viewport, from the shared `AppFrame` — and Focus and
  Backlog carry nine and sixteen, all from Radix's `VisuallyHidden`. W07 closed prisme's own
  `style` attributes; the Radix ones reach every application screen and not only the gallery, which
  is a wider blast radius than [that entry](W07-2026-09-19-csp-inline-style.md) recorded.
- **`pnpm lint` went red on `seed/`**, the directory the repository designates for local-only
  things. Closed here by ignoring it.

## Specs touched

None. The brief's contract — four routes, charts from W07's wrappers, weights editable only from
the Year Review — is implemented as written. `apps/web/CLAUDE.md`'s route-group convention is
followed, with the one documented exception of `/review/year` sitting in `(areas)` to keep out of
W11's tree.

## Checks

`typecheck`, `lint`, `test` (1 487 unit + 101 integration against a real PostgreSQL), `build` and
the privacy deny-list scan all green locally before the pull request. Every screen was driven in a
browser, in both themes, against a fixture-derived dataset — including the weight write, end to
end, verified in the database.

## Privacy

Fixture data only. The dataset behind every screenshot and every observation here is
`fixtures/areas.json` and `fixtures/initiatives.json`, whose areas, titles and weights are
invented. The harness that served them is gitignored and is not in this repository. No real goal,
project, task, weight or workspace identifier appears in this entry or in the diff.
