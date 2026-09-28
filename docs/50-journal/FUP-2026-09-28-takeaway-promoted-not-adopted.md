# FUP · 2026-09-28 · A takeaway is promoted, never adopted

**Asked:** close the gap [ADR-0033](../20-decisions/0033-a-store-area-column-names-an-entry-area.md)
left open. PR #115 gave a Notion entry an area, and that made an action takeaway adoptable from the
queue for the first time. Until then *Adopt* had always refused it, for want of an area. The owner
had #115 merged before its fix was pushed, so the fix comes here, ahead of the next release.

## What was there

- **Two paths to an initiative, each unaware of the other.** The Inbox's promotion
  (`services/lanes.ts` → `promoteTakeaway`) makes an initiative with `origin = created_in_prisme`
  and records `takeaway.promoted_to`. That initiative gets its task-tool anchor.
- **Queue *Adopt* on the same page** made a second initiative, with `origin = adopted`, bound by an
  `entity_link` of kind `page`. The reconciler binds `task` links only, and guard 2 forbids a
  `create` for an adopted entity, so that initiative could **never** get an anchor. Nothing stopped
  both paths running on one takeaway.
- **The spec already had an answer:** `13-migration.md` §4, *What becomes what* — an actionable
  takeaway is "promoted, not copied".

## What was done

- **`adoptCandidate` refuses a document-tool page proposed as an initiative**, inside the
  transaction and before any insert, with the same refusal shape as a key result or a ritual. The
  reason points at the Inbox and at *Merge*.
- The route's OpenAPI description says so.
- **Three integration tests:**
  - the refusal and its reason;
  - an adversarial one: no initiative, no link and no decision event are written, including for a
    row scanned before migration 0015, which carries no store;
  - *Merge* onto the initiative a promotion made still works, and takes the row out of the queue.

## Decisions taken

- **The predicate is `external_kind = 'page'` with `proposed_kind = 'initiative'`, not the store.**
  - `external_kind` is never null, whereas `source_role` is null on a row scanned before migration
    0015.
  - The reason holds for a page from any store: a page link cannot anchor an initiative.
  - Today the classifier proposes only an action takeaway as a page-initiative, so the two readings
    agree.
- **Checked before the area.** A takeaway with no area would otherwise be told to "map its
  location to an area", which is the wrong advice for it.
- **No change to the screen.** *Adopt* already shows the server's refusal as a toast, as it does
  for key results and rituals. Hiding the button for every refused kind is a separate improvement.
- **Recorded as an amendment to ADR-0033's point 5, not as a new ADR.** The record had named this
  exact question as its next one, and the answer is the one §4 already gave, so nothing is
  superseded.

## Surprises

- **The first fix never reached #115.** The agent carrying it hit its session limit after writing
  the refusal and before choosing its condition, which was still a placeholder. #115 was merged in
  the meantime. The tests were run against the placeholder first and failed as expected (*Adopt*
  answered 201), which confirmed the trap was live on `main` before the fix went in.

## Follow-ups

- **Leave already-promoted takeaways out of the queue.** A takeaway whose `promoted_to` is set still
  appears until it is merged or ignored.
- **Hide *Adopt* for a row the server will refuse** (key result, ritual, action takeaway), rather
  than letting the click fail.

## Specs touched

- [ADR-0033](../20-decisions/0033-a-store-area-column-names-an-entry-area.md): point 5 amended, and
  its row in the ADR index.
- [`13-migration.md`](../13-migration.md) §4: the *Actionable takeaway* row.
- [`18-user-guide.md`](../18-user-guide.md) §2.3 and §2.6.
