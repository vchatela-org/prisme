# FUP · 2026-09-27 · Ignore every ended adoption candidate in one confirmed action

**Asked:** the owner disagreed with the stance #112 took — "hidden, not ignored" — and decided
that ended rows **should** be ignored. The only case the old argument protected is reviving an old
page by extending its date, which almost never happens for a past objective: a new period is a new
page. Meanwhile a row that is hidden but still counted is still undecided, and a queue that never
reaches zero is the failure `docs/13-migration.md` §4 itself names. But every *Ignore* went row by
row, each behind its own confirmation, which made ignoring dozens of old objectives impractical.

## What was there

- `services/adoption-queue.ts` held the one pure function that filters, counts and pages the queue,
  with `periodOf` deciding *ended* against the instance timezone's today.
- `POST /adoption/ignore` ignored one candidate: `on conflict do nothing`, `decided_by = 'human'`,
  an `adoption_decision` event. `adoption_ignore_is_permanent` refuses UPDATE and DELETE, and
  nothing un-ignores. **Neither was changed.**
- W14's diff-bound confirmation (`auth/confirmation.ts`): `hashPlan` over a canonical plan, and a
  single-use, two-minute token bound to that hash and to the principal. Only the MCP write tools use
  it; no REST route does. No adoption action has an MCP tool.

## What was done

- **`POST /adoption/ignore-ended`** (`write:adoption`, the single ignore's scope). The body takes
  `source`, `areaKey` and `kind` — the queue's vocabulary — and `expected: { count, digest }`. It
  names **no candidate**: `when`, `candidates`, `externalIds`, `reason`, `decidedBy` and
  `decidedAt` are refused by name (`read_only_field`), each with its sentence.
- **The set is the server's.** `endedSelection` in `services/adoption-queue.ts` reuses the queue's
  own predicate with `when` pinned to `ended` *after* the caller's filter is read, so no filter can
  widen it. The shared predicate was lifted out of `queueView` so the list, the facet counts and the
  bulk ignore read one function; the selection's count is the *Ended* facet's count by
  construction. Already-linked and already-ignored rows never reach it, because it starts from the
  same undecided set the queue does.
- **`GET /adoption/queue` gained `ignoreEnded: { count, digest }`** — the ended set under the view's
  source, area and kind, whatever `when` is.
- **One transaction.** The store's `ignoreEndedCandidates` inserts every row with one `decided_at`,
  `decided_by = 'human'`, the reason *"ignored in bulk with every other ended entry in view: its
  period ended before YYYY-MM-DD"*, and `on conflict do nothing`; then one `adoption_decision` event
  per row, in the same transaction. Its `where` clause re-checks, per row, that the candidate is
  still mirrored, adoptable, unlinked and **ended before today** — it cannot choose anything, only
  drop a row, and a dropped row rolls the whole set back as stale. The response is
  `{ ignored, today }`: counts only, never a title.
- **The screen.** Under *Ended*, with at least one row, a line says ignoring is how these leave the
  queue for good, beside **Ignore all N ended**. One dialog, in the single *Ignore*'s style, states
  the count, the filters in force (`Date: Ended · From: … · Area: …`), how many lie beyond the 100
  the page lists, and that it is permanent — including the revived-page case. Success or refusal,
  the page is redrawn. A 409 reads *"The queue changed … Nothing was ignored. Check the new count
  and confirm again."*
- **Specs.** §4's paragraph now says ended rows are hidden by default and that ignoring them, one by
  one or all at once, is the intended way to close them out — keeping the caveat and the sentence on
  the source and area filters. The user guide's §2.6 says the same in the owner's terms.
- **Tests.**
  - `endedSelection`, pure: ended only; a period ending today has not ended (and has the next day);
    each of source, area, no-area and kind respected; a caller's `when: 'all'` does not widen it;
    its rows and count equal the *Ended* view's under seven filter combinations; the digest ignores
    order and titles and moves on one more, one fewer, a kind change, or the day turning over.
  - The route, against PostgreSQL: the offer matches the *Ended* facet; exactly the three ended rows
    are ignored, with one `decided_at` and the bulk reason, leaving the one ending today, the
    running and future ones, the linked one, and the earlier ignore's own reason alone; one event
    each; source and area respected. **Stale views refused, nothing written:** a rescan adding an
    ended row, a swap that keeps the count and changes the rows, the day turning over, and a
    replay. **Adversarial:** a body naming candidates or `when: 'all'` is a 400; a digest forged
    over a running row and the one ending today, with the right count, is a 409; the store itself,
    handed a not-ended or a linked row, rolls back and writes no event; a read-scoped identity gets
    403.
  - The web helpers: offered only under *Ended* with a count of at least one (and not against an API
    that sends no offer); the label; the confirmation's count, filters, permanence, the unmapped
    bucket, and the rows beyond the page.

## Decisions taken

- **The confirmation is a digest the server issued, not a W14 token.** The pattern is reused —
  `hashPlan` is the hash, and the write re-derives the set and refuses when it no longer matches,
  which is the property the W14 mechanism exists for. The token issuance is not, because it does
  not fit a person reading a page:
  - The queue read *is* the dry run. The count on the button came from the server, and the digest
    names exactly that set; a separate dry-run round trip would only fetch the same thing again.
  - A two-minute token expires under somebody reading a long list, and would refuse a view that is
    still true. The digest stays valid exactly as long as the view does, however old.
  - Single use comes free: once the set is ignored it is gone, so a replay's digest no longer
    matches. Binding to the principal adds nothing when the set is computed, not supplied — a
    caller holding the digest could equally read the queue.
  - Tokens are wired into the MCP mount only; a REST route using them would need new plumbing
    through the services for no added property.
- **The digest names the set and nothing else** — `adoption:ignore-ended` and the sorted
  `kind:id` list. No title (a rename is not a different set), no filter (two filters giving one set
  ignore the same rows), no day (the day matters only through the set it produces).
- **`count` and `digest`, both required.** The digest is the check; the count makes the refusal
  readable (*"it showed 3 ended, and 4 match now"*) and is refused at zero, since there is nothing
  to confirm.
- **Offered only under *Ended*.** Elsewhere it would ignore rows the reader is not looking at. The
  API does not care which view the caller is on — the set is ended either way — but the screen does.
- **`kind` is accepted** though the screen sends none, so the equality "what the *Ended* filter
  shows is what this ignores" holds for any API caller of the queue, not only for the screen.
- **No MCP tool.** No neighbouring adoption action has one.
- **No migration, no ADR.** The table, its trigger and its constraint are untouched; this writes
  the rows a single ignore writes, many at a time. The ownership matrix does not move.

## Surprises

- **The client could not have digested what it showed.** The screen reads 100 rows and the ended
  set can be larger, so a digest of the ids on the page would have named the wrong set exactly when
  the bulk action is most useful. So the digest is the server's, over the full set, delivered with
  the queue read beside the count; and the dialog says how many lie beyond the page.
- **`queueView`'s predicate was a closure over the filter**, so reusing it meant lifting it into a
  module function first. Nothing in the queue's behaviour changed; its existing tests pass as they
  were.

## Follow-ups

- **Close out the ended rows** — the owner's, on `/adoption?when=ended`, after choosing the date
  columns and a *Rescan* (#112's own follow-ups).
- **Not run in a browser.** The harness needs a `next build`, which this machine's memory cannot
  take beside a parallel build, and `harness/up.sh` stops every `next-server` on the machine. The
  API was exercised end to end against PostgreSQL; the screen by its helpers, the typecheck and the
  lint. The first real use is the check.
- **Not done, deliberately:**
  - an un-ignore — permanence is what makes the queue converge;
  - a bulk ignore for anything but ended rows;
  - an MCP tool, since no adoption action has one.

## Specs touched

`docs/13-migration.md` §4 (the *What has ended* paragraph) · `docs/18-user-guide.md` §2.6.
