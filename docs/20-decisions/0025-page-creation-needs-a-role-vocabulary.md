# ADR-0025 · Creating a page needs role keys that do not exist yet

**Status:** Accepted · 2026-09-20, accepted 2026-09-21

## Context

[ADR-0011](0011-optional-narrative-page.md) is Accepted and says an initiative's narrative page is
**created on demand**: the detail panel offers *Create page*, which "creates one from the template
and links it". [ADR-0019](0019-project-as-optional-container.md) says the same for a project —
creating one "creates a page in the document tool from the project template".

W15 built both buttons and found that prisme cannot address either target.

**The role vocabulary has no slot for them.** External stores are named by role key, never by name
or identifier ([`17-privacy.md`](../17-privacy.md) §1), and there are six:
`objectives_db`, `takeaways_db`, `media_db`, `areas_db`, `processes_db`, `reviews_db`. None of them
is where an initiative's or a project's narrative page lives, and none is a template. There is no
identifier prisme could resolve, so there is no parent to create a page under.

**The capability table has no slot either.** [`14-threat-model.md`](../14-threat-model.md) §5 grants
the document-tool integration `read` on four roles, `read/write` on `objectives_db` — "prisme owns
specific fields" — and `write` on `reviews_db` for review summaries. Creating a page somewhere else
is outside every line of that table. Widening it is a threat-model change, not an implementation
detail.

**And "from the template" is not one API call.** The document tool has no template-instantiation
operation: duplicating a template means creating a page and then copying the template page's blocks
into it. What "from the template" *means* is therefore also undecided — a title and an empty body,
or a structural copy, and if a copy then how deep.

Three unknowns, none of which a workstream should settle by picking one.

## Decision

**Accepted 2026-09-21**, and implemented in the same pull request that accepted it. W15 had recorded
the intention and refused to execute it — a page's `creation_intent` row written, the converge pass
reporting it `blocked` with the reason — because nothing could guess a parent honestly. The four
rules below are now the vocabulary:

The four rules:

1. **Two new role keys** — `initiative_pages_db` and `project_pages_db` — naming where each kind of
   narrative page is created. They may be bound to the same identifier in an instance that keeps
   both in one store; the distinction is prisme's, and binding is instance data.
2. **A template binding per kind**, resolved the same way: `initiative_page_template` and
   `project_page_template`. A role key that names a page rather than a database is a small widening
   of what a role key *is*, and it is the honest one: a template is addressed exactly as a store is.
3. **`create` capability, not `write`.** A new verb in `ROLE_ACCESS`, narrower than `write`: it
   permits adding a page under the bound parent and permits nothing to existing content. Read-only
   wherever prisme owns nothing is the existing rule, and "may add, may not edit" is the smallest
   capability that satisfies ADR-0011.
4. **"From the template" means a structural copy of the template page's top-level blocks**, and
   nothing deeper. Anything more is a document tool feature prisme would be reimplementing, and the
   page body belongs to the document tool the moment it exists ([`11-ownership.md`](../11-ownership.md)
   §3).

**What acceptance changed, and what it did not.** *Create page* works for an initiative and for a
project: the page is created under the bound store's identifier and its body is a copy of the bound
template's top-level blocks. Two things remain outside it, and both are stated rather than absorbed:

- **A capture's page is still blocked.** The vocabulary names an initiative's page and a project's
  page, and a capture is neither. Guessing which of the two it meant is the class of guess this
  repository refuses everywhere else, so the intent is recorded, the plan says which vocabulary is
  short, and the gap is a follow-up rather than a silent approximation.
- **An instance that has not bound the four roles is unaddressable.** That is a deployment step, not
  a decision: `prisme-sync bindings --from <path>` binds them, and until it runs the plan blocks
  each page with a sentence naming the command.

**Link existing page** continues to work throughout, and it always did.

## Consequences

- **ADR-0011 and ADR-0019 are implementable for an initiative and a project**, and the code did not
  approximate a third case: a capture's page stays blocked with the reason, on a screen, in the
  ledger.
- **The document-tool token gains a capability it has never had.** It is the first outward write to
  the document tool in the project, and it is the reason this is an ADR rather than a commit. A bug
  in it adds pages to somebody's workspace; that is recoverable, unlike an edit, which is why
  `create` is proposed instead of `write`.
- **Two more bindings to load at deployment**, and nothing in this repository loads role bindings at
  all yet — the missing dependency W12 and W13 both recorded. Accepting this does not by itself make
  page creation work; it makes it *expressible*.
- The intents already in the ledger become runnable the day the bindings exist. Nothing has to be
  re-requested, because the intention was recorded rather than refused.

## Alternatives

**Create the page under the initiative's area page.** `areas_db` is bound and readable, so a page
could be nested under the area it belongs to. Rejected: `areas_db` is granted **read-only**
deliberately, and quietly creating children under an archive prisme is not supposed to touch is the
exact shape of "a bug corrupting an archive" that the least-privilege table exists to prevent.

**One `pages_db` role for everything prisme creates.** Simpler, one binding. Rejected: an initiative
page and a project page have different templates and, in a real workspace, usually different
parents — and a single role would make "which template" a second undeclared decision made in code.

**Drop page creation and keep only *Link existing*.** Honest, and it is the state W15 ships. Rejected
as a permanent answer because it contradicts an Accepted ADR: ADR-0011 chose create-on-demand over
"never create pages" explicitly, and the reason it gave still holds — "forcing the user to create
and link it manually is friction at exactly the wrong moment". This record proposes how to honour
it; it does not propose abandoning it.

**Grant plain `write` on the new roles.** One fewer concept. Rejected: `write` would let a bug edit
a page a human has been writing in for months, and nothing prisme does needs that. The page body is
the document tool's outright the moment the page exists.
