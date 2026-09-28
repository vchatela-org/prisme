# FUP · 2026-09-28 · Linking a processes row to a ritual sets the ritual's page

**Asked:** the owner is bringing rituals in from the processes store. *Adopt* refuses a ritual row,
because a candidate carries no cadence and no target. So the path is to create the ritual on
Rituals, *Rescan*, then *Link* the row. The owner asked that *Link* also attach the page, so its link
need not be pasted on Rituals as well.

## What was there

- **Link wrote `entity_link` and nothing else.** No code bound a page link for a ritual. The
  reconciler binds task links, and only for initiatives. `ritual.external_page_id` was set by the
  Rituals form alone. So a ritual linked from the queue kept no page, and the declared-duration
  tier, which joins through that column, had nothing to read.
- **Two specs said otherwise.** [`13-migration.md`](../13-migration.md) §4 says *Merge* "binds an
  additional external reference", and the user guide said *Link* "joins them". For a ritual, neither
  was true.

## What was done

- **The domain** gains `ritualPageLink(heldKey, linkedKey)`. A ritual with no page gets the linked
  page (`attach`). One that already names that page is left unchanged (`already`). One that names
  another page is refused (`other_page`).
- **The store.** `decideAdoption` is now one transaction. For a page linked to a ritual, it locks the
  ritual's row and compares both identifiers through `docIdKey`. It then sets `external_page_id`, or
  refuses before inserting anything. The rule lives in the domain, like `adoptRefusal`; the store
  only applies it.
- **The API** answers the refusal with `409`. Its message points at `PATCH /rituals/{id}`, or at
  ignoring the row. The route description says so too.
- **The web.** *Link*'s `409` is worded on screen (*That ritual has another page*). The Rituals
  screen is redrawn after a link. The refusal sentence on a ritual row now says *Link* makes the
  page the ritual's process page.
- **Tests:**
  - three domain units, one per outcome;
  - four API integration tests, against PostgreSQL:
    - a link attaches the page, and the row leaves the queue;
    - the same page, written bare on the ritual and dashed on the row, is accepted and left as
      written;
    - another page is a `409`, and nothing is written: no link, no event, the page unchanged, the
      row still queued;
    - a task link leaves the ritual's page alone.

## Decisions taken

- **A different page is refused, not replaced and not kept.** Replacing it would undo a choice made
  on Rituals. Keeping it would record a link the ritual does not honour, which is the gap this
  closes. Only a person knows which page is right, and the refusal says where to decide.
- **The page is stored as the row gives it.** `docIdKey` is for comparing only, as its own comment
  says.
- **No ADR.** The ritual's page is prisme's own field. Setting it on a human decision writes nothing
  to either tool; the page stays read-only (ADR-0016). *Merge* onto a ritual was already open, per
  [ADR-0033](../20-decisions/0033-a-store-area-column-names-an-entry-area.md) point 5. Adopting a
  ritual stays refused, as that point says.
- **No second event.** The link's `adoption_decision` event already records the decision. A page
  edited on Rituals records no event either.
- **The ritual is found by `id::text`.** `prismeId` can name any kind of entity, and casting a
  non-ritual identifier to `uuid` would fail the whole decision.

## Follow-ups

- **Merge onto an objective still does not set its page** (#118's follow-up). It was left alone
  here on purpose. Under [ADR-0034](../20-decisions/0034-an-open-objective-moves-and-its-page-follows.md)
  a linked objective page gets its date column written on every pass. Linking would therefore start
  outward writes, and that is a decision, not a fix.
- **A ritual is still not joined to its recurring task.** A task link onto a ritual is recorded and
  never bound, so adherence is still recorded by hand.
- **Adopting a processes row as a ritual** was offered to the owner and not decided. It would seed
  the cadence from a frequency column chosen on Settings → Notion, with its option names matched to
  cadences there, and ask for the target on *Adopt*. It would amend ADR-0033 point 5 and
  [`11-ownership.md`](../11-ownership.md) §8.
- **A ritual that already names the row's page still waits for a click.** The scan could treat it
  as an existing mapping (rule 1), so the row would leave the queue on its own. Not done: rule 1
  applies automatically, and widening what applies automatically is a decision.
- **The declared-duration tier reads a number property only.** A formula whose result is a number is
  mapped as `unsupported` and counted as unreadable. Found while answering the owner, not changed.

## Specs touched

- [`11-ownership.md`](../11-ownership.md) §8: a row for the ritual's process page.
- [`13-migration.md`](../13-migration.md) §4: a *What becomes what* row for a page in the processes
  store.
- [`18-user-guide.md`](../18-user-guide.md) §2.6: what *Link* does for a ritual, and its refusal.

## Privacy

Fixture titles and invented identifiers only. The identifier-shaped value in the integration test
is built at run time, as the privacy scan requires.
