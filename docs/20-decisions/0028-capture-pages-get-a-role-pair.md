# ADR-0028 · A capture's page gets its own role pair

**Status:** Accepted · 2026-09-24 · extends [ADR-0025](0025-page-creation-needs-a-role-vocabulary.md)

## Context

ADR-0025 accepted the vocabulary that lets prisme create a narrative page: two role keys naming where
an initiative's page and a project's page are created, two naming the templates they copy, and a
`create` capability deliberately narrower than `write`. It closed with a gap stated out loud rather
than absorbed:

> **A capture's page is still blocked.** The vocabulary names an initiative's page and a project's
> page, and a capture is neither. Guessing which of the two it meant is the class of guess this
> repository refuses everywhere else, so the intent is recorded, the plan says which vocabulary is
> short, and the gap is a follow-up rather than a silent approximation.

That is the state this record closes. A capture's page intent is *already reachable*: the capture
form offers **Create one** (`PageChoice`), the API records the intent (`planCapture` pushes a page
intent when the mode is `create`), and the ledger holds it. What it could not do was run — the
converge pass blocked it with `a capture's page has no role key in ADR-0025's vocabulary`, and an
instance binding every role ADR-0025 names would still have blocked it. Two kinds of page were
addressable; the third was a promise the screens were making and the planner could not keep.

## Decision

**A capture gets its own pair of role keys** — `capture_pages_db`, naming where its page is created,
and `capture_page_template`, naming what that page is a copy of — at `create` and `read`
respectively, and `capture` joins `PageKind` beside `initiative` and `project`.

Everything else about ADR-0025 is unchanged, and deliberately:

1. **The pair is the unit.** A kind is addressable only when *both* its store and its template are
   bound. One without the other is not a half-working feature — a page with no parent has nowhere to
   go, and a page with no template is the empty page ADR-0011 says is worse than no page.
2. **`create`, not `write`.** The new store joins the same narrow verb: prisme may add a page under
   the bound parent and may read or edit nothing. The new template is `read`, like the other two,
   because prisme copies its blocks and writes none of them.
3. **An unbound kind blocks with the bindings sentence**, not with a silence. That sentence now names
   three kinds instead of two, because there is no longer a second, unfixable reason for a page to be
   blocked — which is the whole point of this record.

## Consequences

- **The document-tool token gains a third `create` grant.** That is a widening of the least-privilege
  table in [`14-threat-model.md`](../14-threat-model.md) §5, which is what makes this an ADR rather
  than a commit — the same reason ADR-0025 gave for being one. The blast radius is unchanged in kind:
  a bug here adds a page a person deletes in a second, rather than editing one somebody has been
  writing in for months.
- **An instance must bind two more roles** for a capture's page to work, and binding them to the same
  identifiers as an initiative's is supported and expected where a workspace keeps them together. The
  distinction is prisme's; the identifiers are instance data.
- **A compile error now guards the correspondence ADR-0025 could only describe.** `PageKind` and the
  page-bearing members of `IntentEntityKind` coincide, so `resolveCreation` maps an entity kind to a
  page kind without a cast, and `addressablePageKinds` derives its kinds from `PAGE_ROLE_FOR` rather
  than from a list repeated at the call site. A fourth entity kind added without a page kind stops the
  build; a hardcoded triple at that call site would instead have bound the roles and still planned the
  page as unbound, with nothing failing.
- **The plan has one block reason left, and it is one a human can act on.** Every remaining `blocked`
  page is an unbound role, and `prisme-sync bindings --from <path>` is the fix. A reason nobody can
  act on is worse than no reason, because it teaches a reader to skip the column.
- **The screens stop promising a stall that no longer exists.** The ledger, the page button, the
  capture choice and the request toast all said a page "waits on a decision rather than on a pass".
  That was true before ADR-0025 and stale after it; they now say what actually blocks one — the
  bindings — and the creations screen no longer counts page intents apart from ordinary queued work.

## Alternatives

**Route a capture's page through `initiative_pages_db`.** The obvious shortcut, since a capture is
usually promoted into an initiative. Rejected for the reason ADR-0025 already gave: it is a guess
about what the work will become, and the two templates exist precisely because the parents differ.
A page created under the wrong parent is not a small error — it is content in a place the person did
not choose, and moving it afterwards is manual work in another tool.

**No page for a capture — remove the option.** Honest and smallest, and it removes a control that
silently did nothing. Rejected as a regression rather than a simplification: the intent is recorded
today, the ledger holds it, and the model has no rule that says a page may only be asked for after
promotion. Withdrawing a control people have been told to use is a feature removal, and ADR-0011
chose create-on-demand over "never create pages" for reasons that do not change with the entity kind.

**Leave it blocked until an instance needs one.** Rejected for the reason ADR-0025 rejected leaving
`create` unimplemented: a recorded intention that can never be satisfied is a screen that lies, and
this repository's rule is that a gap is recorded *and* closed rather than recorded and forgotten.

**One `pages_db` role for all three kinds.** Rejected by ADR-0025 already, and this record does not
reopen it: three kinds with three templates and, in a real workspace, three parents is three roles,
and a single one would make "which template" a second undeclared decision made in code.

## Revisit when

- an instance binds all three kinds to one identifier. That is supported today and needs no change —
  it is evidence the *distinction* is unused, not that it is wrong, and collapsing it would re-derive
  the parent from the entity kind in code rather than from the bindings;
- a fourth kind of page appears. The vocabulary is a `Record<PageKind, RoleKey>` precisely so that
  adding one is a compile error at every site that must know, rather than a role that exists and is
  never addressable.
