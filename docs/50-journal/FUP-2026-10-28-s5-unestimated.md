# FUP · 2026-10-28 · S5: an initiative nobody estimated says so, and waits for it

**Agent:** Claude · **Duration:** one run · **PR:** _pending_ · **Outcome:** `initiative.estimated` marks
the placeholder that adoption and a capture write; the estimates read *Unestimated* wherever they
are shown, and selection holds such an initiative out of `now`. S5 is closed.

## What was found first

Two writers put the placeholder in: adoption in the API (`ADOPT_ESTIMATE`) and the intent channel's
capture in the sync (`CAPTURE_ESTIMATE`, the `prisme` label). Both write 3 for all four estimates,
because the columns are NOT NULL. Nothing recorded that they had done so, and estimate edits write no
event, so there was no way to tell a placeholder from a choice afterwards. The placeholder size also
passed `isSizedForNow` (`size ≤ 8`), so an adopted initiative moved to `next` was as selectable for
`now` as one somebody had sized.

## What was done

- **Migration 0021** adds `initiative.estimated` (default `true`) and marks unestimated every adopted
  initiative whose four estimates are all 3. Its reversal and backfill were rehearsed in a
  rolled-back transaction on a throwaway database.
- **Both writers** insert `estimated = false`. The API's `update` sets it `true` when any of the four
  is in the write, whatever its value.
- **`isEstimated` in `@prisme/domain`**, and a selection reason, `unestimated`, checked before
  `too_large`: the candidate keeps its place and the next one takes the slot.
- **The API** carries `estimated` on the initiative DTO and the MCP brief (the tool manifest is
  regenerated), and `propose_now_set`'s plan warns about an unestimated promotion instead of calling it
  small enough.
- **The web.** `EstimateEditor` shows *Unestimated* instead of `V3 · T3 · R3 · S3`, on the Inbox, the
  Backlog and Focus; the popover and the initiative page say why, with **Keep these estimates**. The
  page has an *Unestimated* badge in place of *Larger than a now slot*. Moving one to `now` by hand
  warns (`unestimated` guardrail). Focus words the reason.

## Decisions taken

- **A flag, not empty columns.** The finding's *Explore* said "leave estimates empty". Every scoring
  method, the schedule, the score history and the MCP tools read the four numbers. Making them
  nullable would have changed each of them to carry one signal that a boolean carries. The score of
  an unestimated initiative is still computed; it is just not presented as a judgement.
- **Any write is an estimate, the same value included.** That is what *Keep these estimates* sends,
  and it is how someone says the middle values are right.
- **The backfill is a heuristic, and its error is the visible one.** An adopted initiative somebody
  deliberately set to 3, 3, 3, 3 reads as unestimated after the migration. One click restores it.
  The opposite error — a placeholder read as a judgement — is the one S5 is about.
- **Held out of the selection, not out of the ranking.** The readiness gate (`docs/10-model.md` §5)
  is about entering `now`; the Backlog still ranks it, with the mark beside it.

## Checks run locally

Node 24.21.0 (the repo pins 26; CI runs that): root `pnpm typecheck`; the whole `unit` project (2292),
including a selection test and a guardrail test; the whole `integration` project (380), including an
adoption test from `estimated: false` through a title change to *keep*; eslint and prettier on the
changed files; the privacy scan with the local supplement.

## Not done

- Estimate edits still write no event, so *when* something was first estimated is not recorded.
- The ranking does not sort unestimated work after estimated work; it is marked, not demoted.

## Specs touched

- `docs/10-model.md` §5 (the field and the readiness gate), `docs/11-ownership.md` (a new row),
  `docs/12-scoring.md` §5 (rule 6), `docs/13-migration.md` (adopting links), `docs/18-user-guide.md`
  (Inbox, Backlog), `docs/19-how-it-works.md` S5.
