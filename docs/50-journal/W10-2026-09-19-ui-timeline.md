# W10 · 2026-09-19 · Timeline, dependency edges and drag-to-replan

**Agent:** W10 (Claude Opus 5) · **Duration:** one session · **PR** #31 · **Outcome:** complete

## What was done

One route, `/timeline`: initiatives as bars over a zoomable time axis, grouped by area or by
project, with dependency edges, the critical path, deadline markers, a capacity overlay, and a
table twin carrying every visual encoding as a column.

The requirement the brief states is narrower than "draw a Gantt" — **when one thing moves, the
things that depend on it move too**, and a deadline that becomes impossible is flagged rather than
quietly broken. Both are implemented against the schedule engine and neither is computed here.

The decisions live in two pure modules in `apps/web/src/lib`, tested without a browser as W08
established and W09 continued:

- **`timeline-scale.ts`** — dates to pixels and back. The axis, the zooms, the tick thinning.
- **`timeline-view.ts`** — grouping, ordering, the `boundBy` sentences, the capacity bands, and
  the preview summary.

## Decisions taken

**The API had no replan endpoint, and the workstream could not be delivered without one.** W02
built `replan` and W05 never exposed it, so the drag the brief requires had nothing to ask. This
is the same shape as the missing dependency W12 reported, and it is closed here rather than
reported: `GET /timeline/replan` recomputes the whole plan around one move and answers with the
diff. That is the smallest addition that makes the contract — "ask the API for a replan and render
the answer" — possible at all.

**It is a `GET` on `read:timeline`, and that is a decision rather than a technicality.** A preview
computes a hypothetical plan and writes nothing. Putting it behind `write:initiative` would make it
go dark exactly when W14's kill switch withholds write scopes — which is the moment somebody most
wants to know what they are about to be unable to do. It is also what `routes/contract.test.ts`
requires: that test refuses any non-`GET` route on a read scope, and it is right to, so a POST here
would have meant either a write scope on a read or a weakened gate. Neither was acceptable.

**A drag writes `earliest_start`, and there is nowhere for it to write anything else.** That is the
only scheduling date a human owns (`docs/11-ownership.md`); `planned_start`/`planned_end` are
derived, so writing one from a browser would be the UI claiming a field it does not own and the
next schedule run would overwrite it. The action's body names one field. **No deadline is written
from this screen**, and there is no path to one (ADR-0003).

**The preview is asked for, never guessed.** Nothing is drawn differently until the answer arrives:
no optimistic local placement "while the request is in flight", because a preview the browser
worked out is a preview that can disagree with what gets saved, and the disagreement only surfaces
once somebody has committed it. What holds the two together is an integration test that commits a
previewed move against a real PostgreSQL and asserts the plan served afterwards carries exactly the
dates the preview promised. It was also confirmed by hand: the committed plan matched the preview
bar for bar, and `boundBy` changed from `capacity` to `earliest_start`, which is the plan correctly
reporting that the constraint is now the human's.

**A move is a request, and the screen says so when it is refused.** A dependency or a full area can
refuse the day a bar was let go over. The panel then reads *"Draught-proofing done cannot start
2026-10-05. The plan puts it at 2026-10-12, held by something it depends on"*, and **Apply** is
disabled, because there is nothing to commit. Drawing the bar somewhere other than where it was
dropped without saying so would be the worst available answer.

**`boundBy` is rendered as a sentence, and that is not the paraphrasing `apps/web/CLAUDE.md`
forbids.** That rule is about the *score*, which arrives with a sentence the method wrote. A date
arrives with an enum, and an enum has to become English somewhere; it becomes English once, in a
tested function, rather than in four places in the markup. It is on every row of the rail, in every
row of the table, and in the panel — never only in a tooltip, which is what the brief is explicit
about.

**Hand-drawn rather than a library.** The brief asks for one to be evaluated and names the check
that rules them out: dependency edges *and* custom markers, both first-class. What is on offer
treats edges as an add-on and expects to own its own colour and interaction — which here would mean
a second design system inside one screen, `style` attributes the content security policy refuses,
and retro-fitting `boundBy` into a tooltip slot. What is left is a few hundred lines of SVG over
tested geometry.

**Three encodings that are not a ninth hue.** Bars wear their area's colour; the critical path is a
stroke, an impossible deadline is a marker shape in the status colour, and a saturated area is a
wash. The palette has eight categorical slots and a generated ninth is indistinguishable under
colour-vision deficiency. Each is also a column in the table twin, so nothing is readable by colour
alone.

**The capacity overlay reports the constraint binding, not an overrun.** The engine enforces
capacity, so a plan is never over-subscribed; what is worth showing is where an area was running
every slot it has, which is what makes a `boundBy: 'capacity'` delay legible rather than
mysterious. The slot counts are served with the plan rather than re-derived here — deriving them
would be a second copy of `slotsForWeight`.

Two small additions to the timeline payload went with that: `areaSlots`, and `projectId` on each
entry so the brief's "grouped by area or project" needs no second request and a join.

No ADR was needed and none is contradicted.

## Surprises

**Five defects, none of which any check could see.** All of them passed typecheck, lint, 1 600
tests and the build; all were found by standing the stack up and opening the page.

1. **The bar's hit area was the width of the plot.** The selected row's highlight rect lived inside
   the bar's interactive group, so a pointer-down in empty space hundreds of pixels from the bar
   began a drag of it. The bar still looked and behaved correctly everywhere anybody would think to
   look.
2. **A bar's group stretched as far as its deadline marker**, which put the focus ring around half
   the plot and the element's own centre in empty space — a bar with a deadline two months out
   could not be clicked in the middle of itself. Markers are now their own non-interactive layer,
   and each bar carries an explicit 24px hit target, which it needed regardless: a bar is 3px wide
   at the year zoom, and the `dataviz` skill lists the pinpoint target as an anti-pattern.
3. **Weekend shading at the month zoom** stopped being two shaded days and became a full-height
   stripe every week. Restricted to the zoom where a day is wide enough for the shading to mean
   anything.
4. **Two axis label defects — the same class W09 found on the KPI charts, in a new axis.** `today`
   is drawn in the tick band and nothing about a tick knew it was there, so it overprinted its
   nearest neighbour; and the **left** edge clipped the opening month, because the first version of
   the thinning guarded only the right. Both are now rules over the whole tick list, asserted at
   every zoom over spans from a fortnight to three years. Writing the right-edge test and not its
   mirror is the specific mistake worth remembering.
5. **"every one of relationships's 1 slots"** — wrong twice in six words, on the one screen whose
   entire job is explaining itself. The band's sentence is now a tested function.

**The harness cost most of the session, for the fourth time.** W08 built one and threw it away; W09
built the same one and threw it away, and said W10 would need it. It did. Three details that cost
time and are worth writing down, because the next person will hit all three:

- **The assertion header is configuration** (`AUTH_ASSERTION_HEADER`, defaulting to
  `X-authentik-jwt`), not a fixed name. Guessing it produces a silent `401` from the middleware
  with nothing in any log saying which of the six possible reasons applied.
- **Next compares `x-forwarded-host` with `origin` on a server action** and aborts when they
  disagree. A proxy that does not set it makes every action `500` while every page still renders —
  and this is a *deployment* obligation as much as a harness one: a gateway that forwards the
  public host incorrectly breaks every write in the application and nothing else.
- **The identity provider's keypair must outlive the tiers that cached it.** A harness restart
  mints new keys, and the web tier holds a resolved key set for ten minutes; the symptom is a
  `401` that looks like the assertion is wrong.

**The local test database is easy to break from a harness.** Truncating every table to reseed took
the migration ledger with it, and the next integration run tried to re-apply all five migrations
and failed on a function that already existed — five suites red, in a tree where nothing had
changed. Worth knowing before the failure is diagnosed as somebody's bug.

## Follow-ups

- **The harness is still nobody's.** This is the third workstream to build and discard one, and the
  fourth to need one. It is not a large piece of work — a local identity provider, a fixture
  seeder, a proxy that injects the assertion — and it is now the single biggest recurring cost in
  this repository. W11 and W15 will each pay it again. Owner: W00 or W07, and it should carry the
  three notes above.
- **Area colour still collides on every screen**, exactly as W09 left it: `AreaColorProvider`
  exists in `packages/ui` and nothing outside the gallery mounts it. On this screen two pairs of
  areas share a hue, which on a Gantt is worse than on a list — the eye groups bars by colour
  before it reads a label. Still owned by W07 with W00.
- **The Radix toast viewport's `style` attribute reaches this screen too**, one violation per page,
  as W09 recorded. Nothing in this workstream adds a second.
- **Cycle time is still not drawn anywhere**, and this screen does not add it either. For the same
  reason W09 gave: prisme records no moment at which an initiative started.

## Specs touched

None. The brief's contract — route `/timeline`, reads the schedule from the API, never computes
dates in the browser — is implemented as written, with the one addition it could not be delivered
without, recorded above. `apps/web/CLAUDE.md`'s route-group convention is followed: everything this
workstream owns is under `(timeline)`, with new files only in `lib/` and `contracts.ts` and a single
navigation entry in the shared frame.

## Checks

`typecheck`, `lint`, `test` (1 636, including the five new integration tests against a real
PostgreSQL) and `build` all green locally before the pull request, plus the privacy deny-list scan.
Every screen state was driven in a browser — both themes, all four zooms, a keyboard move, a
refused move, and a commit verified against the plan served afterwards.

On the pull request, **fifteen of the sixteen checks are green and `dependency audit` is red for a
reason that is not this branch's**: npm's advisory endpoint is answering `503 — "We are currently
performing maintenance"`, so `pnpm audit` cannot reach it at all. It is not reporting a
vulnerability; it is failing to ask. Confirmed three ways — the job's own log, a re-run of it, and
`pnpm audit --audit-level=moderate` failing identically on a local machine against `main`'s
dependency set, which this branch does not change (no dependency is added, removed or bumped).

Recorded rather than worked around, per
[`docs/40-workstreams/README.md#where-you-stop`](../40-workstreams/README.md#where-you-stop): the
gate is not disabled, no `continue-on-error` is added, and the run is not looped against an outage.
It needs one re-run once npm's status page is clear, which is a human's call.

**Worth deciding separately:** a required check that depends on a third-party endpoint being up is
a check that turns every outage into a blocked merge. That is arguably correct for a security gate
— failing closed is the right default — but it is a choice nobody has made out loud, and the
alternative (an offline advisory database, or a cached one) exists. Not raised as an ADR here
because it is W14's gate and not this workstream's to decide.

### Resolution, later the same day

npm's advisory endpoint recovered. The endpoint was probed directly and answered `200` while the
status page still read *Service Under Maintenance* — the status page lagged the recovery, so the
probe rather than the page is what settled it. `pnpm audit --audit-level=moderate` then returned
`No known vulnerabilities found` locally, and re-running only the failed job turned it green in
24 s against the same commit. **All seventeen checks are green at `353e585`**, read back from the
pull request; no dependency, workflow or gate was changed to get there.

The counting in the paragraph above is left as it was written, which is why it says sixteen: the
`CodeQL` umbrella check reports alongside its three language jobs, so the check set is seventeen,
not sixteen. Worth knowing before claiming a total.

The separate question is now recorded as
[OQ-10](../20-decisions/OPEN.md) rather than left in this entry, because a journal entry is not
where someone looks for what is undecided. It is still W14's to decide; nothing here changed it.

## Privacy

Fixture data only. The dataset behind every observation here is `fixtures/areas.json` and
`fixtures/initiatives.json`, whose areas, titles and weights are invented; the two titles quoted in
this entry are from that file. The harness that served them is gitignored and is not in this
repository, and no screenshot is committed. No real goal, project, task, weight or workspace
identifier appears in this entry or in the diff.
