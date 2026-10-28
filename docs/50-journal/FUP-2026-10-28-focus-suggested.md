# FUP · 2026-10-28 · Focus shows a proposal as work in flight

**Agent:** Claude · **Duration:** one run · **PR:** this entry's own · **Outcome:** `GET /focus` and
the `focus_now` tool separate work in flight from suggestions; Focus gains a *Suggested* section

The owner imported initiatives as `next` and found them listed under *Now* on Focus. The stored
statuses were right — nothing was `now` — so the question was where the screen got *Now* from.

## What was found

- `selectNowSet` returns one `now` list holding two kinds of entry: `in_flight` (status `now`,
  keeps its slot) and `selected` (a `next` or `later` initiative proposed for a free slot).
- `GET /focus` returned that list as `now`, and every consumer read it as *in flight*: Focus's
  *Now* section and its "N of M slots in flight" header, the Review's now-set panel ("Nothing is in
  flight"), the area page's `inFlight`, the KPI idle-days figure, and the WIP counts behind the
  status menu's guardrails.
- `slotsByArea.used` counted proposals too. A suggested initiative's own slot made its area look
  full, so moving it to `now` warned that the area was at its cap — the warning was about itself.
- The reconciler was never affected: `apps/sync/src/reconcile/priority.ts` already writes anchor
  priority from the status as it is, and says why. `propose_now_set` had already worked around the
  mix by filtering `status === 'now'`.

## What was done

- `apps/api/src/services/work.ts`: `focus()` splits selection's `now` by reason — `now` is
  `in_flight`, `suggested` is the rest — and counts only in-flight work in `slotsByArea.used`.
- `apps/api/src/dto/views.ts`, `apps/web/src/lib/contracts.ts`: the `suggested` field, and the
  meaning of `now` and `used` written on the schema.
- `apps/api/src/mcp/tools/reads.ts`: `focus_now` returns `suggested` and its description says a
  suggestion is still `next` or `later`; `tool-manifest.json` regenerated. `propose_now_set` no
  longer needs its filter.
- Focus: a *Suggested* section between *Stale* and *Up next*, each card with a **Start** button
  (`start-button.tsx`) that moves it to `now`; the header adds "· N suggested"; the empty *Now*
  state no longer says Focus "fills" itself.
- Review's refill step lists the suggestions before the queue under *What the ranking would put
  there*, since the free slots it shows now include the ones a suggestion would take.
- `docs/18-user-guide.md` §3 describes *Suggested*.
- An integration test: with nothing in flight, `now` is empty, every suggestion is `selected` and
  still `next`, no slot is used; promoting one moves it to `now` and fills its slot.

## Decisions taken

- **Fixed at the API, not on the screen.** Five screens and an MCP tool read `focus.now` as in
  flight. Filtering by reason on each would have left the contract meaning two things and every
  future consumer to rediscover it.
- **Selection is unchanged.** `selectNowSet` proposing free slots is the specified behaviour
  (`docs/12-scoring.md` §5); `docs/19-how-it-works.md` already gives `next` → `now` to the person,
  following the proposal. Only the presentation of the proposal was wrong.
- **Start asks nothing.** Selection only proposes work that is unblocked, sized for `now` and in an
  area with a free slot, so every guardrail the status menu could raise is already answered. The
  status menu stays on the card for any other move.

## Not done

- No change to selection, scoring, the reconciler or any stored status.
- The staleness badge still shows on suggested and queued cards, as it did on queued ones before.
- Not verified in a browser against the deployed instance; that needs a release.
