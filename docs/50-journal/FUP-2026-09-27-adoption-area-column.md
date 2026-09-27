# FUP · 2026-09-27 · A Notion entry's area comes from its store's area column

**Asked:** the owner decided, on 2026-09-27, how a document-tool row gets an area. Their workspace
has a Life areas database, and every other store points at it through a relation property. So a
store may name that relation as its *area column*, each prisme area names its own page in Life
areas, and the scan resolves one against the other. The decision is
[ADR-0033](../20-decisions/0033-a-store-area-column-names-an-entry-area.md), written Accepted on the
owner's word. It closes the *mapping vocabulary* question that
[FUP-2026-09-26-restore-rehearsal](FUP-2026-09-26-restore-rehearsal.md) ("79 of the remaining 82
cannot carry one at all") and
[FUP-2026-09-27-adoption-dates-and-filters](FUP-2026-09-27-adoption-dates-and-filters.md) (*Surprises*)
left open. `OPEN.md` never listed it as a numbered question, so it has nothing to close there.

## What was there

- `adaptDocRecords` set no area on a page. `area_mapping` names only task-tool locations, so every
  Notion candidate had a null `area_key`.
- *Adopt* refused a null area, so an action takeaway could not be adopted. Rules 2 and 3 treat "no
  area" as matching only "no area", and a key result always has one, so an objectives row was never
  proposed against one. The queue's Area filter never reached a Notion row.
- The connector already parsed a relation into the related pages' identifiers.
- `area.external_page_id` existed from migration 0002. The API accepted it and the store wrote it,
  but **no screen set it**: the area forms send a name, a colour, *Active* and a run budget.
- The takeaway mirror already had an `area_key` column, and the Inbox already showed it as *No area
  yet*. Nothing ever filled it.

## Who writes the relation: checked before the ADR was written

The ADR's ownership split depends on prisme writing nothing to these stores, so that was checked
first. The document tool's only write is `createPage` (`POST /v1/pages`), into a page store. No code
`PATCH`es a page. `objectives_db` is declared `read_write` in `role-key.ts`, but nothing uses the
write half. The reconciler writes to the task tool only. So the ownership the owner described holds,
and the ADR is Accepted rather than Proposed.

## What was done

- **Migration 0016.** `role_binding.area_property`, the chosen relation, and
  `role_binding.relation_properties`, the relation columns the last check found. Constraints, comments
  and a written reversal follow 0015's pattern, and `area.external_page_id`'s comment now says what
  the column means. The reversal was **rehearsed** on this session's own test database, never a
  shared or live one: 0016 applied, the written reversal run (both columns gone, the comment back to
  null, the version row deleted), then the migrator run again (0016 re-applied).
- **The check lists relation columns.** `describe` names a store's `relation` properties beside its
  `date` ones, sorted. It still reads each property's *type* only. A rollup is not a relation.
- **Settings → Notion** shows an *Area column* select under the *Date column* one, for Objectives,
  Takeaways and Processes. The date picker became one `ColumnPicker` used twice.
  `PUT /bindings/{role}/area-property` accepts only a name from the last check's list. A re-check
  keeps the choice while the store still has that relation (`carriedDateProperty`, now used for both
  columns).
- **Settings → Areas** has a new *Its page in Notion* section on each area's page. Its select lists
  the Life areas entries, which a new `GET /document-tool/area-pages` (`admin:areas`) returns. That
  endpoint queries the `areas_db` store and returns an identifier, a title and which area already
  holds each page, and nothing else. A page another area holds is shown and disabled. `PATCH
  /areas/{key}` refuses it anyway (`409`), comparing identifiers dashed or bare alike.
- **The scan.** `area-relation.ts` is the pure rule: `indexAreaPages` and `areaOfRelation`.
  `adaptDocRecords` applies it to each store's chosen column, so a page carries an `area_key` and its
  lane. The adopt path, rules 2 to 4 and the Area filter use that key without any change of their own.
  A takeaway's area also goes into the takeaway mirror, and is cleared there when the relation stops
  naming one area.
- **`docIdKey`** lives in `packages/connectors`. It reduces a 32-digit identifier, dashed or bare, to
  lower-case bare digits, and leaves any other identifier as it is. The scan and the API's uniqueness
  check both use it.
- **Tests:**
  - the connector contract: relation names only, sorted, no rollup, and the database path;
  - `docIdKey`: dashed equals bare, case, opaque identifiers left as they are, near misses;
  - the rule: exactly one, none, several, an unknown page, a page two areas name, a non-relation
    property, dashed against bare in both directions, and one page written two ways;
  - the adapter: area and lane, only the record's own store's column, nothing when none is chosen;
  - the scan end to end: an objectives row proposed by rule 2 against a key result in its area, a
    takeaway's area reaching the mirror, and nothing proposed when no column is chosen;
  - the store against PostgreSQL: `loadAreaProperties`, the page index, a blank name refused by the
    CHECK, a page candidate's area written, and the takeaway area written and cleared;
  - the Settings routes against PostgreSQL: choose, refuse a non-relation, refuse an unbound or
    create-only store, keep across a re-check, drop on re-pointing, and scope. Also an area's page
    set, cleared and refused when another area holds it (dashed and bare), and the Life areas list:
    unbound, listed with holders, unreadable, and scope;
  - the web helpers: both choices, including a page that is no longer in the store.

## Decisions taken

- **The same three stores as the date column.** Not Life areas, whose entries *are* the areas'
  pages. Not the media library, which nothing proposes. The API accepts any readable store, as the
  date column's does, and the screen narrows it.
- **The page is picked, not pasted.** A pasted identifier can name a page that is not in Life areas
  and nothing would say so. Picking from the store's own entries makes that visible, and the screen
  says so when a page an area already has is no longer listed.
- **Ownership differs per store, and the ADR's table says how.** A takeaway's area is the document
  tool's, re-read every scan. An objective's area is prisme's: the relation is its outward form, only
  a seed at adoption, and a difference after that is a conflict. For processes, the ADR refines the
  brief. The relation there sits on a process page, which ADR-0016 gives to the document tool
  outright, so it can seed a ritual's area but can never be an outward target. A later difference is
  therefore not a conflict, just a different field. In both cases prisme's value wins, and nothing is
  updated from Notion.
- **Inactive areas are still recognised.** An area is retired, not deleted, and its entries are
  still its own.
- **No outward write.** Nothing writes an objective's page today, and this change adds nothing that
  does. The ADR names the relation column as the target if one is ever built.

## Surprises

- **Adopting a takeaway from the queue does not do what promoting it from the Inbox does.** Now that
  a takeaway can carry an area, *Adopt* works on it. It creates an initiative with
  `origin = adopted` and a `page` link that the reconciler never binds, because it binds `task` links
  only. By guard 2, that initiative can never get a task-tool anchor. *Promote* on the Inbox creates
  one prisme made, which can. Nothing stops both being used on one takeaway, which would give it two
  initiatives. ADR-0033 records this as open and changes neither path.
- **`STATUS.md`'s decision count was one behind.** It said 30 accepted while the index held 31. It
  now says 32, matching the index after 0033.

## Follow-ups

- **For the owner, in order:** *Check again* on Settings, since stored bindings were checked before
  the check listed relations. Choose the *Area column* for Objectives, Takeaways and Processes. Give
  each area its page on Settings → Areas. Then *Rescan* on Adoption.
- **Which path an action takeaway takes into the backlog**: queue adoption, Inbox promotion, or one
  that knows about the other. See *Surprises*.
- **Adopting a key result or a ritual** is still refused. The seed rule in ADR-0033 point 4 is for
  the day that changes.
- **Not done, deliberately:**
  - finding the area relation automatically, which would need a property's configuration read;
  - an outward write of an objective's area;
  - a conflict reader for an objective whose relation moved after its link;
  - a harness run in a browser. The screens are covered by the view helpers' tests, and CI's `next
    build` compiles them.

## Specs touched

[ADR-0033](../20-decisions/0033-a-store-area-column-names-an-entry-area.md) (new) · `docs/10-model.md`
§3, §8 · `docs/11-ownership.md` §1, §2, §6, §7, §8 · `docs/13-migration.md` §3 · `docs/15-runtime.md`
§2 *External bindings* · `docs/18-user-guide.md` §2.2, §2.3 · `docs/20-decisions/README.md`.
