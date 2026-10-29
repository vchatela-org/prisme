# FUP · 2026-10-29 · The core loop is not fed: nudges for a starved area, a key result, a first review

**Agent:** Claude · **Duration:** one run · **PR:** pending · **Outcome:** S16, recorded and closed.
Focus and Areas name a starved area with nothing queued and link a pre-filled *New initiative*; a key
result of an open objective offers *Create an initiative that serves this*; Focus points at the
weekly review until one is closed. No ADR: nothing is created, owned or written outward.

## What was found first

- **The owner's instance showed the loop with nothing to turn.** Areas whose balance factor sat at or
  near the clamp's ceiling held no queued work, so the lift had nothing to act on; no initiative
  served any key result; no review session had ever been closed. Every screen was correct and none
  said what to do. Counts only here — no area, key result or session is named.
- **`servedBy` could only be replaced wholesale.** `PATCH /key-results/:id` deletes and re-inserts the
  set. Appending from a creation flow would have been a read-modify-write that loses a link added in
  another tab, so an endpoint that adds one was the honest shape.
- **Nothing refused a key result served from another area.** The *Served by* editor offers only the
  objective's own area and says why (allocation before ranking); the API did not enforce it. The new
  endpoint refuses (409). The wholesale `PATCH` is left as it was — changing it is a separate
  decision, recorded below.
- **No `1.5` existed anywhere.** The clamp is 0.5–2 and `mostStarved` reasons about the ceiling.
  The threshold is new, and lives in the domain as `STARVED_BALANCE_FACTOR`.
- **`apps/web` cannot test a `.tsx` component.** Its tsconfig keeps JSX as `preserve`, so Vitest does
  not transform it. The shared piece became a `packages/ui` primitive (`Notice`) with its own render
  test, and the web side is a thin wrapper over pure, tested wording.

## What was done

- **Domain.** `starvedWithNothingQueued` and `STARVED_BALANCE_FACTOR` (1.5) in `selection/starved.ts`:
  rankable areas at or above the threshold holding no initiative in `inbox`, `later`, `next`, `now` or
  `waiting` that is under way (ADR-0035's `notUnderWay`, not re-derived). Ordered by key.
- **API.** `GET /focus` gains `starvedAreas` (from the ranking's own capacity, the factor that lifts
  scores) and `lastReviewClosedAt` (`max(completed_at)`, null when none ever closed).
  `POST /key-results/:id/served-by` adds one initiative, idempotently, refusing another area (409).
- **UI.** `Notice` in `packages/ui` (`role="status"`, no dismiss), in the gallery and the inline-style
  guard.
- **Web.** `lib/nudge-view.ts` words the notices and builds the pre-filled link; `components/nudges.tsx`
  renders them. Focus shows the starved notices and the first-review pointer; Areas shows the starved
  notices on this year's view only. Every key result row of an open objective (list and detail) links
  *Create an initiative that serves this*. *New initiative* reads `?area=`, `?objective=&keyResult=`
  and offers **Serves**, limited to the chosen area's key results of open objectives; the action
  adds the link after the creation.
- **Docs.** `18-user-guide.md` §3 and §4, `19-how-it-works.md` §5 and S16.

## Decisions taken

- **"Nothing queued" counts `inbox`, `now` and `waiting`.** An area with work in its Inbox needs
  triage, not another initiative; one with work in flight is being served. Only `review`, `done` and
  `dropped` leave an area empty. Work not under way does not count, because the lift cannot act on it
  today.
- **The notice is computed once, in the API, from the ranking's capacity.** Areas already reads
  `/focus`, so it reuses the list rather than recomputing from `/balance`, whose window can be another
  year's. On a past year's view the notice is not shown, because it describes today.
- **A key result fixes the area.** The form's area changes drop a key result of another area, and
  the API refuses one anyway.
- **A link that fails after the creation still navigates away.** The initiative exists; staying on
  the form invites a second *Create*. The toast says the link was not made and where to make it.

## Not done

- The wholesale `PATCH /key-results/:id` still accepts an initiative of another area. Making it refuse
  would change an existing write's contract; worth deciding with the owner.
- No MCP tool for adding a served-by link.
- The first-review pointer names the weekly review only; it does not track monthly or yearly closes
  separately.

## Specs touched

`docs/18-user-guide.md`, `docs/19-how-it-works.md` (S16).
