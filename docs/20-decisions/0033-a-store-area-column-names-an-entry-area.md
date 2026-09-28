# ADR-0033 · Read a document-tool entry's area from its store's area column, by the area's own page

**Status:** Accepted · 2026-09-27 · decided by the owner, 2026-09-27 — settles the *mapping
vocabulary* question recorded on 2026-09-26 and 2026-09-27 · amended 2026-09-28: point 5 decides that
a takeaway is promoted, never adopted · amended 2026-09-28 by the owner: point 5 decides that an
objectives page is adopted as an objective

## Context

**A document-tool row never carries an area.** `area_mapping` names locations by
`external_project_id` and `external_section_id` — the task tool's vocabulary — so the adoption scan
(`apps/sync/src/adoption/adapt.ts`) gives a task or a project an area and gives a page none. Three
things follow, each verified in the code:

1. **An action takeaway can never be adopted.** It is proposed as an initiative, and *Adopt* refuses
   any candidate whose `area_key` is null — an entity in no area cannot be allocated to.
2. **Identity resolution cannot match a page.** Rules 2 and 3 of
   [`13-migration.md` §3](../13-migration.md#3-identity-resolution) require the same area on both
   sides, and "no area" matches only "no area" (`resolve.ts`, `comparable`). A key result inherits
   its objective's area, which is never null, so an objectives row was never proposed against one.
3. **The queue's Area filter never reaches a Notion row.**

The 2026-09-26 restore rehearsal measured it — 79 of the 82 unattributed candidates were pages, and
none *could* carry an area — and recorded it as a question about the mapping vocabulary rather than
the instance. The 2026-09-27 adoption-dates entry found it again. Both said it needed an ADR.

The workspace already answers the question. The owner keeps a **Life areas** database — the store
bound to `areas_db`, one page per area — and every other store points at it through a **relation**
property. The connector already parses a relation as the related pages' identifiers
(`{ kind: 'relation', ids }`, `packages/connectors/src/doc-tool/types.ts`). And each prisme area
already has a column for its page: `area.external_page_id`, since migration 0002
([`10-model.md` §3](../10-model.md#3-area): *optional link to the narrative page*). The API accepts it
on `POST /areas` and `PATCH /areas/{key}` and the store writes it — but **no screen sets it**: the
Settings forms send a name, a colour, *Active* and a run budget, and nothing else.

What writes the relation today, checked before deciding who owns it: **nothing.** The document tool's
only writing call is `createPage` (`POST /v1/pages`), which adds an entry to a *page store* and sets
its title and template (ADR-0025, ADR-0030). No code sends a `PATCH` to a page. `objectives_db` is
declared `read_write` in `role-key.ts`, but no writer uses it, and the reconciler writes to the task
tool only. So no field of an objectives, takeaways or processes page is written by prisme, the
relation included.

## Decision

**A bound store may name one of its relation properties as its area column. An entry related to
exactly one page that is exactly one area's own page belongs to that area. Anything else belongs to
none.**

1. **The setting: `role_binding.area_property`.** Optional, per bound store, chosen on **Settings →
   Notion** from the store's relation properties as its last check listed them
   (`role_binding.relation_properties`) — never typed, the date column's rule (#112, migration 0015).
   It is offered for **Objectives, Takeaways and Processes**, the three stores the date column is
   offered for, because theirs are the entries that reach Adoption. Not for Life areas, whose entries
   *are* the areas' pages, nor the media library, nothing of which is proposed. The API accepts it on
   any store prisme reads, as it does the date column, and the screen offers the three. A re-check
   keeps the choice while the store still has a relation of that name and drops it once it does not;
   a failed check keeps it.

2. **An area is recognised by its own page.** `area.external_page_id` is the area's page — an entry
   of the store bound to `areas_db`. **Settings → Areas** picks it from that store's entries
   (`GET /document-tool/area-pages`), by title on the screen and by identifier underneath; it is
   never typed or pasted. **Matching is on page identifiers, never on titles**: a title is a word two
   areas can share, and a renamed page would otherwise move work between areas without a trace.
   **One page names one area**: the API refuses (`409`) a page another area already names, and the
   scan treats a page two areas name, if one ever exists, as naming neither.

3. **The resolution rule.** Exactly one related page, and it is exactly one area's page → that area.
   No relation, several related pages, or a page no area names → **no area**. Never the first of
   several, never a majority, never a title: the same refusal to guess as
   [ADR-0029](0029-one-area-per-project.md)'s one area per project. Identifiers are compared in one
   normalised form (`docIdKey`, `packages/connectors`): the tool writes one page dashed in a relation
   and bare in a copied link, so a 32-digit identifier is compared as its lower-case bare digits and
   anything else as it is. Inactive areas are included — an area is retired, not deleted. The rule is
   a pure function, `apps/sync/src/adoption/area-relation.ts`, and the scan applies it in
   `adaptDocRecords`, so the candidate carries an `area_key` and the adopt path, the resolution rules
   and the Area filter work **unchanged**.

4. **Ownership — who is right when prisme and the relation disagree.** It depends on the store, and
   that is the point of this record:

   | Store | The area's owner | What the relation is to prisme |
   |---|---|---|
   | Takeaways | **D ←** — like everything on a takeaway ([`11-ownership.md` §7](../11-ownership.md#7-takeaway-and-media)) | The value itself. Read on **every** scan into the candidate and into the takeaway mirror (`takeaway.area_key`), and cleared there when the relation stops naming one area. prisme writes nothing |
   | Objectives | **P →** — `objective.area_key`, authored in prisme ([§6](../11-ownership.md#6-objective-and-key-result)) | A **seed**: taken into prisme **once, at adoption** — the precedent of a task's deadline ([`13-migration.md` §4](../13-migration.md#adopting-links-and-does-not-rewrite): *a value prisme already holds wins, as the owner of the field*). After that prisme's value wins, and a differing relation is a **conflict, not an update**. It is also the outward form of `area_key`: **if an outward write of an objective's area is ever built, it writes this relation column** and records it in `last_applied` like every outward field |
   | Processes | **P** — a ritual's area ([§8](../11-ownership.md#8-run-signals-ritual)) | A **seed**, once, at adoption, as for objectives. But the relation is part of a process page, which the document tool owns outright ([ADR-0016](0016-document-tool-owns-processes.md)) and prisme never writes: so after adoption it is **not read again**, a difference is neither an update nor a conflict, and it is never an outward target |

   Before adoption, on every store, the scan reads the relation into the **candidate** — prisme's own
   derived mirror, replaced wholesale each scan — to match and to filter. A candidate whose relation
   disagrees with an existing entity's area simply does not match it by rules 2–4 and falls to the
   manual remainder: prisme's value wins by construction, and nothing is updated from Notion.

5. **Not decided here.**
   - **Adopting a `key_result` or `ritual` candidate is still refused**: the first needs an
     objective and the second a cadence and a target, and no candidate carries either. Objectives
     and processes rows can be *merged* onto an entity that exists, and with an area they can now be
     *proposed* against one. So the "seed" in point 4 is the rule for the day that refusal is lifted,
     and no code takes an objective's or a ritual's area from Notion today.
   - **Adopting an action takeaway from the queue, and promoting it from the Inbox, are two paths
     that do not know about each other.** Now that a takeaway can carry an area, the first is
     reachable. It creates an initiative with `origin = adopted` and an `entity_link` of kind
     `page` — which the reconciler never binds (it binds `task` links only), so by guard 2 that
     initiative never gets a task-tool anchor. The second creates one prisme made, which does. Nothing
     stops both being used on one takeaway. This record changes neither path; which one a takeaway
     should take is the next question, and it is recorded as a follow-up.

     **Amended 2026-09-28 — decided: a takeaway is promoted, never adopted.** *Adopt* refuses a
     document-tool page proposed as an initiative, before it inserts anything, and its reason points
     at the Inbox, whose promotion makes an initiative that gets its anchor — the rule
     [`13-migration.md`](../13-migration.md) §4 already stated (*promoted, not copied*). The
     predicate is the candidate's external kind (`page`), not its store: a page link cannot anchor an
     initiative whichever store it came from, and a row scanned before migration 0015 has no store
     recorded. *Merge* stays open, so a queue row can be linked to the initiative its promotion
     made. The queue does not yet leave out a takeaway that has already been promoted; that is
     recorded as a follow-up, not decided here.

     **Amended 2026-09-28, by the owner — decided: an objectives page is adopted as an objective.**
     The first bullet's refusal left the objectives store with no way into prisme at all: the scan
     proposed every page there as a `key_result`, *Adopt* refused it, and *Merge* had nothing to
     link to, because a page was matched against key results only and an instance that has adopted
     nothing holds none. It was met on the live queue, where most rows were objectives pages and the
     refusal read as an outage. But the model already said what such a page is — an **Objective**,
     its narrative in the document tool and its `external_page_id` the link to it
     ([`10-model.md` §7](../10-model.md#7-objective-and-key-result)) — and point 4 already wrote the
     rule for its area "for the day that refusal is lifted". So:

     - The scan proposes an objectives page as an **`objective`** (migration 0017 widens
       `adoption_candidate.proposed_kind`), and matches it against objectives that have no page and
       no link yet — never against key results.
     - *Adopt* creates one, **seeded once** from the candidate and never re-read: the page's title,
       the area its relation names (point 4), and a `type` and `period` read off the store's date
       column — exactly one calendar year is `annual` (`YYYY`), exactly one calendar month is
       `monthly` (`YYYY-MM`), and any other span, or none, is **refused** rather than rounded to the
       nearest shape. Status `active`; `external_page_id` is the page. Nothing is written to the
       document tool, and the reconciler reads no objective, so nothing outward is planned for one.
       A person whose objective runs a quarter corrects the dates in the document tool, or creates it
       on the Objectives screen and merges the row onto it.
     - **A key result and a ritual are still refused**, for the reason the first bullet gives.
     - **The refusal is one rule, stated twice.** `adoptRefusal` (`@prisme/domain`) is what the write
       applies and what the queue returns on each row (`adoptRefusal`), so the screen leaves out
       *Adopt* where the write would refuse it and says why instead — a deliberate refusal no longer
       reaches a person as "the API did not answer".

## Consequences

- **Migration 0016** adds `role_binding.area_property` and `role_binding.relation_properties`, with
  the constraints and the written, rehearsed reversal `date_property` has, and says in
  `area.external_page_id`'s comment what the column now means.
- **The binding check lists relation columns** beside date columns (`describe` reads each property's
  type, as it already did for dates, and still reads nothing of a property's configuration).
- **Settings reads rows of one store for the first time.** `GET /document-tool/area-pages` queries the
  store bound to `areas_db` — a store prisme already reads — and returns each entry's identifier and
  title and nothing else. It is `admin:areas`, like the task tool's locations the same screen lists.
- **Nothing changes until the owner configures it**: choose an area column per store (after *Check
  again*), give each area its page, then *Rescan*. Until then every page is read exactly as before.
- **The costs, said plainly.** Two pieces of configuration where there were none — a column per
  store and a page per area. An entry deliberately related to two areas sits outside every area; that
  is the rule, not a defect, and the Area filter's *outside every area* count is where it shows.
  Renaming the relation property in Notion drops the choice at the next check, as a date column's
  rename does. And the takeaway mirror's `area_key`, which the Inbox already displayed as *No area
  yet*, now carries a value — the document tool's, refreshed every scan.

## Alternatives

- **Match the related page's title, or a select option, against the area's name.** Rejected: a title
  is a word, two areas can share one, and renaming either side would move work between areas without
  anything recording it. The identifier is what the relation holds, so it is what is compared.
- **A new location column in `area_mapping` for document-tool pages.** Rejected: `area_mapping` is a
  many-to-one table of places work *lives*, and an area's page is one-to-one with the area — the
  column for it, `area.external_page_id`, already exists and already means "this area's page". Two
  places saying which page is an area's would be the ambiguity
  [ADR-0008](0008-field-level-ownership.md) exists to prevent.
- **Find the relation automatically** — the one property whose target is the Life areas data source.
  Rejected for now: it needs a property's *configuration* read, which the wire schema deliberately
  does not read; a store may hold two relations to that database; and a column a person chose is
  visible on the screen and reversible, where a discovered one is a guess nobody sees. It could be a
  convenience later, pre-selecting the choice.
- **Take the first related page, or the one most entries use.** Rejected: a guess recorded as a
  decision, which [ADR-0029](0029-one-area-per-project.md) already refused for projects.
- **Make a takeaway's area prisme's, seeded once like an objective's.** Rejected: §7 gives the
  document tool everything on a takeaway, and prisme only mirrors it. A seed would give the field a
  second owner the first time the owner moved a takeaway to another area in Notion.
- **Re-read an objective's area on every scan and update prisme's.** Rejected: `objective.area_key` is
  the allocation decision prisme exists to hold (§6), and letting a relation overwrite it would make
  it a field with two owners — the failure this repository was started to avoid.
