# ADR-0030 · A page store is a database, and its templates are the document tool's own

**Status:** Accepted · 2026-09-26 — supersedes rules 2 and 4 of
[ADR-0025](0025-page-creation-needs-a-role-vocabulary.md) and the template half of
[ADR-0028](0028-capture-pages-get-a-role-pair.md)

## Context

ADR-0025 gave prisme a vocabulary for creating a narrative page: a store role per kind naming where
the page goes, a template role per kind naming what it is a copy of, and a `create` capability. It
chose that shape on a stated premise:

> **And "from the template" is not one API call.** The document tool has no template-instantiation
> operation: duplicating a template means creating a page and then copying the template page's
> blocks into it.

So a store became an ordinary **parent page**, a template became an ordinary **page** whose
top-level blocks prisme copied, and ADR-0028 repeated the pair for a capture. Six bindings for three
kinds.

**The premise is no longer true.** The document tool's API (from `Notion-Version: 2025-09-03`; the
client already sends `2026-03-11`) now instantiates templates itself:

- `POST /v1/pages` takes a `template` parameter — `{ type: "default" }` for the data source's default
  template, or `{ type: "template_id", template_id }` for a named one — **only when the parent is a
  data source**. It cannot be combined with `children`.
- `GET /v1/data_sources/{id}/templates` lists a data source's templates, each with `id`, `name` and
  `is_default`.
- The template is applied **asynchronously**: the create call returns a blank page carrying the
  properties sent, and the tool fills the body and merges the template's properties afterwards.

And the shape ADR-0025 chose does not match how the owner keeps these pages. Binding the three stores
on the live instance, the owner expected **databases** — the role keys are even named `*_pages_db` —
and every check came back `refused`, which is what a check that fetches a *page* answers when it is
given a database's identifier (it answers the same for a page not shared with the integration, and
the screen cannot tell the two apart). The owner's model is a database per kind, with templates kept in the database
as the document tool's own templates, maintained in the tool's own editor. A template kept as a
loose page that prisme copies block-by-block is a second, worse template system beside the one the
tool already has.

## Decision

**Accepted 2026-09-26 by the owner.**

1. **A page store is a database.** `initiative_pages_db`, `project_pages_db` and `capture_pages_db`
   have shape `data_source` in `ROLE_SHAPE`. A pasted database link resolves to the one data source
   inside it, exactly as for the six read roles. A new page is created **as an entry** of that data
   source: `parent: { type: "data_source_id", … }`, with prisme setting the **title property only**,
   addressed by type rather than by name, because the title column's name is the workspace's.
   The three keys are unchanged; the suffix now means what it says.

2. **The template roles are removed.** `initiative_page_template`, `project_page_template` and
   `capture_page_template` leave the vocabulary, `ROLE_ACCESS`, `ROLE_SHAPE` and the Settings screen,
   and their stored bindings are deleted by a migration. There is no longer a link to provide for a
   template: **a store's templates are the ones its database holds.** prisme copies no blocks.

3. **Which template is applied**, read from the database's own template list:

   | The database holds | What happens |
   |---|---|
   | exactly one template | it is applied — no choice is shown |
   | several templates | **the app proposes the choice** where the page is asked for, with the database's default pre-selected when it marks one |
   | no template | the kind is **not addressable** — see rule 5 |

   The choice, when one is made, is recorded on the page's creation intent as the template's
   identifier. A request that makes no choice — an MCP call, an API caller, a request made before a
   second template existed — means **the default**: the one template if there is one, the database's
   marked default if there are several, and a `blocked` intent naming the missing choice if there are
   several and none is marked. The request is validated against the list when it is made (an
   identifier that is not one of that database's templates is refused), and **re-resolved when the
   intent is applied**: a chosen template that has since been deleted blocks the intent with that
   reason rather than falling back silently to another.

4. **The template is applied by the document tool, not by prisme.** The create call sends
   `template: { type: "template_id", template_id }` with the resolved identifier — never `default`,
   so that what the plan showed is what is sent — and no `children`. prisme records the new page's
   identifier from the response and **does not wait for, read or verify** the body: the page belongs
   to the document tool the moment it exists ([`11-ownership.md`](../11-ownership.md) §3), and ADR-0025's
   rule that prisme never edits a page after creating it is unchanged.

5. **A kind is addressable when its store is bound and its database holds at least one template.**
   ADR-0028's *the pair is the unit* becomes *the store is the unit, and a store without a template is
   not yet one*. An unbound store and a store with no template each block the intent with a sentence
   naming Settings → Notion, and the two sentences differ, because the fixes differ. The Settings
   check reports *no template* as its own outcome rather than as a failure of the binding.

6. **The duplicate guard queries the database.** Before creating, prisme queries the store's data
   source for a live entry whose title equals the requested title, and returns it instead of creating
   a second — the level-triggered existence check ADR-0025 made against a parent page's children,
   now made against the database. It is the same guard, and it is stronger: a database query filters
   by title where a child-block scan had to page through everything under the parent.

7. **`create` stays the verb, and says honestly what it reads.** On a store, prisme may **add an
   entry** and may **read the store's schema, its template list and its entries' titles** — the last
   two because rules 3 and 6 cannot be kept otherwise. It may edit nothing that exists, including the
   entry it created. [`14-threat-model.md`](../14-threat-model.md) §5 loses its template row and states
   the reads.

## Consequences

- **Three bindings instead of six**, and each is the thing the owner already has: a database. The
  refused checks that prompted this record pass once the databases are shared with the integration.
- **Templates are edited where they live.** A new template, a renamed one or a changed default is a
  change in the document tool, picked up on the next list — nothing in prisme to re-bind.
- **The body arrives a moment after the page.** Anybody opening the page in the same second can see
  it blank. That is the tool's behaviour, not prisme's, and prisme does nothing to hide it, because
  waiting for it would mean reading a body prisme has no business reading.
- **An entry can carry more than a title.** The template may set other properties of the database —
  a status, a relation, a date. Those are the template's and the document tool's; prisme writes the
  title and nothing else, and does not read them back. Writing a relation from the entry to prisme's
  own object is **not** part of this decision: it would give prisme a field in somebody else's
  database, and that is an ownership question ([`11-ownership.md`](../11-ownership.md)) to be raised on
  its own if it is ever wanted.
- **The chosen template's identifier is stored in prisme**, on the intent. It is instance data like
  every other external identifier — in the database, never in git ([`17-privacy.md`](../17-privacy.md)).
- **The creation surfaces grow one control.** *Create page* on an initiative, the new-project form and
  the capture form show a template choice when, and only when, the kind's database holds several. The
  API grows a read that lists a kind's templates, and the MCP tools that can ask for a page accept an
  optional template identifier.
- **The document-tool client loses code**: the template-children fetch and the block copy go, and
  with them ADR-0025's "top-level blocks only" limit, which existed because prisme was reimplementing
  a feature it can now call.
- **Nothing to migrate in the document tool.** The instance is read-only and no page has been created
  under the old shape; the stored template bindings are deleted, and a store binding that names a page
  now fails its check as the wrong kind of object — which is the truth.

## Alternatives

**Keep a template role, and pass it as `template_id`.** One binding per template, as today, but
applied natively. Rejected by the owner: it keeps a link to maintain for something the database
already knows, and it cannot express "several templates, choose when creating".

**Always send `{ type: "default" }`.** The smallest change. Rejected: it cannot offer a choice, it
fails with a validation error on a database whose only template is not marked default, and it sends
a *reference* to a template rather than the one the plan showed — a default changed between plan and
apply would apply something nobody saw.

**Create an entry with no template when the database has none.** It would keep a kind addressable
with less setup. Rejected for the reason ADR-0011 and ADR-0028 give: a page's existence should signal
that something is written in it, and an entry with a title and nothing else is the empty page those
records refuse. A database with no template is one template away from working, and the Settings
check says so.

**Keep parent pages and add databases as a second option.** Rejected: two shapes for one role is the
ambiguity [ADR-0008](0008-field-level-ownership.md) exists to prevent, one level up — a binding whose
meaning depends on what kind of object it happens to name.

## Revisit when

- the document tool's template API changes shape, or begins applying templates synchronously — rule 4
  is written around the asynchronous behaviour;
- an owner wants prisme to write a property other than the title on the entries it creates. That is
  a new ownership row, not an extension of this record.
