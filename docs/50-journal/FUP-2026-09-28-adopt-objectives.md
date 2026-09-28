# FUP · 2026-09-28 · An objectives page is adopted as an objective

**Asked:** the owner reported that *Adopt* on objectives rows of the live queue answered "this
candidate could not be read. The API did not answer, or answered with something this page could
not parse", with a correlation id. They chose to adopt objectives pages as objectives, and to fix
the message in the same change.

## What was there

- **Not an outage — a refusal, worded as one.** The web tier logged `api request refused` with
  status **400** on every click. The API answers a refusal as a `400` with its reason, but
  `failureCopy` words every status other than 401, 403 and 404 as "could not answer", and the web
  tier never shows an API message (`lib/api.ts` rule 3). So a deliberate *no* read as a broken API,
  and its reason was dropped.
- **Every objectives page was proposed as a `key_result`** (`classify.ts`), and *Adopt* refuses a key
  result: it needs an objective and a target, and a candidate carries neither. ADR-0033 point 5 had
  left that refusal *not decided here*.
- **And *Merge* had nothing to link to.** A page was matched against key results only, and an
  instance that has adopted nothing holds none. So the objectives store had no way into prisme at
  all. On the live queue that was 64 of the 82 undecided rows. Most of them had ended; the few
  running this year were what the owner wanted to bring in.
- **The model already said what such a page is**: an Objective whose narrative stays in the page,
  linked by `external_page_id` (`10-model.md` §7). And `11-ownership.md` §6 already described an
  objective's area as "taken into prisme only at adoption".

## What was done

- **`@prisme/domain` holds the rule, once.**
  - `objectivePeriodOf` turns exactly one calendar year into `annual`/`YYYY` and exactly one
    calendar month into `monthly`/`YYYY-MM`. Anything else, or no dates, is nothing.
  - `adoptRefusal` returns a code for each refusal: `promote_takeaway`, `needs_objective`,
    `needs_cadence`, `not_adoptable`, `no_area` or `period_not_calendar`.
  - `ADOPTABLE_KINDS` is the one list of queueable kinds.
- **The scan** proposes an objectives page as `objective`. It matches it against objectives with no
  page and no link yet (the reconciler never binds an objective, so `entity_external_ref` cannot say
  it is answered). Migration **0017** widens `adoption_candidate.proposed_kind`.
- **The API.**
  - *Adopt* reads `adoptRefusal` before any insert, and creates an objective seeded once from the
    candidate: its title, its area, its type and period from the dates, status `active`, and
    `external_page_id` set to the page.
  - The service words each code for an API client.
  - Every candidate row now carries `adoptRefusal`.
  - The queue SQL, the bulk ignore and both `kind` enums read `ADOPTABLE_KINDS`. Before, four
    hand-written lists each had to learn the new kind, and the queue's own list would have dropped
    `objective` rows silently.
- **The screen.**
  - A refused row has no *Adopt* button and says why, with what to do instead.
  - `failureCopy` words a `400`, `409` or `422` as **Refused**, "a decision, not an outage", on
    every surface.
  - A refused *Adopt* redraws the queue, so a row that moved since the page was drawn explains
    itself.
- **Tests.**
  - Domain units for the period's edges (leap February, a quarter, a year starting mid-year, a
    day, undated) and for the refusal order.
  - API integration: annual, monthly, a refused span inserts nothing, a body naming `period` is
    refused, the row leaves the queue.
  - One property test: **for every row the queue shows, the write refuses exactly the rows whose
    `adoptRefusal` is set, and adopts the rest.**
  - The date-filter and bulk-ignore suites now seed objectives rows as `objective`, so the kind
    passes through that SQL.

## Decisions taken

- **Exact calendar bounds, and refuse the rest.** The owner chose deriving the type over asking for
  it. Rounding a quarter up to a year would be a guess recorded as a decision. Measured on the live
  queue first: every running objectives row was an exact year or an exact month, so the strict rule
  refuses nothing that is wanted.
- **Kinds before area in the refusal order.** "Give it an area" is the wrong advice for a key result
  or a ritual, which no area makes adoptable. The period comes last, since it is fixed in the
  document tool.
- **A code in the DTO, not a sentence.** The API and the screen address different readers, so each
  words the same code for its own. It also keeps rule 3 intact: the screen still displays nothing
  the API wrote.
- **Status `active`, even for a period that has ended.** Ended rows are hidden by default and meant
  to be ignored in bulk. Anyone who adopts one sets met or missed by hand.
- **An amendment to ADR-0033's point 5**, like the takeaway one. The record had written this rule
  "for the day that refusal is lifted", so nothing is superseded.

## Surprises

- **The takeaway entry of the same day says *Adopt* "already shows the server's refusal as a
  toast".** It never did: the toast was the generic "could not answer", because no API message
  reaches the screen. Nothing in the web tests read a refusal's copy, so nothing caught it.
- **The API logs no 4xx.** The correlation id was in no log line. What placed the failure was the
  *web* tier's `api request refused` line, which carries the path and the status.

## Follow-ups

- **Merging a page onto an existing objective does not set its `external_page_id`.** *Merge* writes
  the ledger row only, whatever the entity, so the objective's own page link stays empty.
- **Leave already-promoted takeaways out of the queue.** This is still open from the takeaway entry.
  The other follow-up there, hiding *Adopt* on refused rows, is done here.
- **After this rolls out:** *Rescan*. Mirrored rows stay `key_result` until the next scan, and
  *Adopt* refuses them with the key-result reason until then.

## Specs touched

- [ADR-0033](../20-decisions/0033-a-store-area-column-names-an-entry-area.md): point 5 amended,
  and its row in the ADR index.
- [`13-migration.md`](../13-migration.md) §3 and §4, where *What becomes what* gains the
  objectives-page row.
- [`11-ownership.md`](../11-ownership.md) §6, and [`10-model.md`](../10-model.md) §7.
- [`18-user-guide.md`](../18-user-guide.md) §2.3 and §2.6.
