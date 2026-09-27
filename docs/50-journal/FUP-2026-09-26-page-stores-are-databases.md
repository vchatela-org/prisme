# FUP · 2026-09-26 · A page store is a database, and its templates are the document tool's own

**Agent:** Claude · **Duration:** one session · **PR** [#103](https://github.com/vchatela-org/prisme/pull/103) · **Outcome:** complete

[ADR-0030](../20-decisions/0030-page-stores-are-databases-with-native-templates.md), accepted by the
owner the same day, implemented end to end. The three page stores name **databases**; a new page is
an entry of the store's one data source, created with one of the database's **own templates**, which
the document tool applies after the page exists. The three template roles, and prisme's copy of a
template's top-level blocks, are gone. Stacked on [#102](https://github.com/vchatela-org/prisme/pull/102),
which rewrites the same files.

---

## What was done

- **The vocabulary.** Nine role keys instead of twelve, all of shape `data_source`. `StoreShape`
  narrows to that one member rather than keeping a `page` branch nothing reaches — the ADR rejects a
  second shape for a role by name, so the type says so. `PAGE_TEMPLATE_FOR`, `TEMPLATE_ROLES` and
  `isTemplateRole` are deleted, and the adoption scan loses the one exclusion they existed for.
- **The client.** `createPage` reads the data source's schema, finds the title property **by type**
  and addresses it **by id**, asks the database for a live entry with that title, and — when there is
  none — posts an entry with the title as its only property and `template_id` as the template. No
  `children`, no `default`, no waiting, no read of the body. `listTemplates(role)` pages the template
  list, parses it and sanitises the names.
- **The pass.** A set of addressable kinds computed from the bindings cannot answer ADR-0030's
  question — whether a database holds a template is a fact about the document tool — so the converge
  pass now reads each outstanding kind's template list once, at its start, and a pure
  `resolveTemplate` decides per intent. The plan line names the template it will send.
- **The ledger.** `creation_intent.template_id` records a choice; `NULL` asks for the default. The API
  checks a choice against the live list when the request is made, and the pass checks it again.
- **The screens.** A template select appears where a page is asked for only when the database holds
  several, default pre-selected; the Settings check lists each store's templates and reports *no
  template* beside a store that was found.
- **Migration 0012** deletes the template bindings, forgets the stores' cached checks, and adds the
  two columns.

## Decisions taken, and why

- **The check caches template names, never identifiers.** A cached id is one a later edit could send
  without asking whether it still exists; every creation resolves from the live list instead, and
  the Settings overview only needs names and the default mark.
- **The duplicate guard asks for the title property alone** (`filter_properties`) and returns the
  match without reading its body. ADR-0030 rule 7 grants the creating path entries' *titles*; the old
  guard fetched a matching page in full, body included, which the new capability does not cover.
- **The template list is read once per pass, for plan and apply alike, freeze or not.** "Re-resolved
  when the intent is applied" is met by resolving from a read made at the start of the pass that
  sends; reading it under the freeze is what lets `create --plan` name the template, and a pass with
  no page outstanding asks the document tool nothing.
- **Several templates with no marked default block rather than taking the first**, and so do two
  marked defaults — the tool does not describe that state, and picking one would be the guess the
  pass exists to refuse. The screen, which can ask, waits for a choice instead of sending none.
- **A store whose list cannot be read blocks its pages instead of failing them.** Nothing was
  attempted, so there is nothing to retry into working, and the reason carries the failure kind only.
- **A chosen template that cannot be validated is refused at request time** — no store bound, or its
  list unreadable — rather than recorded and left to block later, further from the mistake.
- **`wrong_kind` exists only where it can be observed.** The tool answers a data-source or database
  read of a page's identifier as it answers one of an object it cannot show, so a page is reported as
  the wrong kind only when a properties-only read of it as a page succeeds. Otherwise it stays
  `refused`, and the advice for `refused` still mentions the wrong kind of link.
- **The initiative's page button keeps the choice offered while the page is requested.** A request
  blocked for want of a choice, or because its template was deleted, needs somewhere a person can
  choose again; asking again rewrites the one waiting intent's choice and adds nothing.
- **The migration is hand-written**, like 0001–0011: the Drizzle schema module is still empty, so the
  generator has nothing to generate from, and every migration here carries a written reversal.

## Surprises

- The template list is under `templates`, not `results`, and carries no `object` discriminant, so it
  has its own wire schema rather than being a variant of a query response.
- No MCP tool asks for a page, so ADR-0030's "the MCP tools that can ask for a page accept an optional
  template identifier" changes nothing: the set is empty. The REST page requests all accept it.
- The quick-capture form has no page choice at all, although the API accepts one; the ADR's "the
  capture form shows a template choice" had nothing to attach to.

## Follow-ups

- **Owner:** re-bind the three stores to databases in Settings → Notion, give each at least one
  template in the document tool, and *Check again* — until then the pass blocks every page with a
  reason naming the screen, which is the intended state of a read-only instance anyway.
- **Unowned:** a page choice on the quick-capture form, and "ask again" for a project's or a capture's
  blocked page, are UI decisions the ADR did not take.
- **Unowned:** the ledger screen still cannot show why a page is blocked — the reason is computed by
  the pass and not stored. Pre-existing, and larger than this change.

## Specs touched

`docs/14-threat-model.md` §5 (the template row goes; `create` states its three reads),
`docs/15-runtime.md` *External bindings*, `docs/17-privacy.md` §1, `docs/18-user-guide.md` (the
Settings table, *Narrative page*, two questions), `packages/connectors/CLAUDE.md`.
