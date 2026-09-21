# FUP · 2026-09-21 · *Create page* works

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes the last of the three things the document-tool gap gated. [ADR-0025](../20-decisions/0025-page-creation-needs-a-role-vocabulary.md)
is **Accepted**, and the vocabulary it proposed is implemented: an initiative's and a project's
narrative page is created under the store the instance bound, and its body is a copy of the bound
template's top-level blocks.

This is the second of two pull requests closing gap 1, and it stacks on the first — the role
bindings are what make any of this addressable.

## What was done

- **ADR-0025 Accepted**, with `docs/14-threat-model.md` §5's least-privilege table widened to match
  it and `docs/20-decisions/README.md` updated.
- **Four role keys and a new capability verb.** `initiative_pages_db`, `project_pages_db`,
  `initiative_page_template`, `project_page_template`, and `RoleAccess` gains **`create`** —
  narrower than `write`, and deliberately *not* readable.
- **`assertCreatable`**, the mirror of `assertReadable`: a creation against a role prisme only reads
  is refused by capability rather than by a 403 from the tool.
- **`DocToolClient.createPage`** — the first writing method on a document-tool client.
- **`DocumentCreationWriter`**, a second creating port beside the task tool's, with a live
  implementation and a frozen one.
- **The converge pass creates pages**: `resolveCreation` resolves them, `orderConvergence` plans
  them once the instance has bound them, and `perform` sends them through the document writer.
- **The page intent's draft is now a title and nothing else**, and `PagePlanInput` is one field.

## Decisions taken

**`create` is not readable, and that is the verb's whole content.** ADR-0025 rule 3 says it "permits
adding a page under the bound parent and permits nothing to existing content". A verb that implied
reading too would be `write` with a nicer name, so `isReadable` now means *read or read-write* and a
creating role fails it. There is a test that says so, because the tempting simplification is to make
`create` a synonym.

**The existence check is the idempotency key the document tool does not have.** The tool has no
idempotency parameter and a page under a page has no custom field prisme could put a marker in — and
ADR-0025 rule 4 forbids writing into the body, so there is nowhere. What prisme *can* do is ask the
world: `createPage` looks for a `child_page` under the bound parent with the requested title first,
and returns it if it is there. That is the same level-triggered shape every other pass has
(ADR-0009), and it is why the operation is safe to run twice. The limitation is stated where it is
implemented: two pages with one title under one parent are indistinguishable to it.

**Nothing of prisme's own goes into the page body.** No backlink block, no managed-fields marker,
no heading. The document tool owns the body outright the moment the page exists
([`11-ownership.md`](../11-ownership.md) §3), and a test asserts the request carries no URL and no
`prisme` string. This cost the page intent its `backlink` field, which W15 had written for it.

**The template copy is top-level blocks only, and read-only fields are stripped.** The document tool
has no template-instantiation operation, so "from the template" means creating a page and copying
the template's blocks. Sending a fetched block back verbatim would include its `id`, its timestamps
and its children — asking the tool to *reproduce* an object rather than create one. Only `object`,
`type` and the type's payload are sent.

**A capture's page stays blocked, and says why.** ADR-0025's vocabulary names an initiative's page
and a project's page; a capture is neither, and which of the two it "meant" is the kind of guess this
repository refuses everywhere. The plan blocks it with `PAGE_KIND_UNSUPPORTED`, which names the gap
rather than the bindings — because binding the roles would not help it, and a message that said so
would send an operator to run `bindings` twice.

**The two writers are two ports, not one port with four methods.** A single port would force the
task-tool writer to implement an operation it cannot perform, which is the shape that ends in a
method that throws at run time. It also keeps the freeze symmetric: `createFrozenDocumentCreationWriter`
is what a deployment with `SYNC_WRITE_ENABLED=false` is handed, so the freeze is the object rather
than a check somebody could forget.

## Surprises

**The recording writer needed a second recorder, and the shared options type had to split.** The
document recorder's `failOn` receives a page, which is not a member of `RecordedCreation` — the
existing union. Widening that union was the obvious move and the wrong one: every existing
assertion about a draft's shape would have had to narrow a union first. Two recorders with two
option types is more code and less coupling, and the compiler said so before a test did.

**A stray page-intent field made it into the ledger and out again.** W15's drafts carried
`fromTemplate`, which looked like it decided the template — and by the time this landed it decided
nothing, because the kind comes from the ledger row's `entity_kind`. It is gone from the API's
planner. `backlink` is gone with it, since ADR-0025 gives prisme nowhere to write one. Both had been
written into `creation_intent.draft` for a month; nothing read either.

**The machine this was developed on has 5 GB of RAM and a load average that reached 44.** One full
test run reported eleven failures — hook timeouts, a `deadlock detected` — and the identical run on
a settled machine was **1965 passed, 113 files, zero failures**. Worth recording because the
failure mode is convincing: it looks exactly like a suite that has been broken by the change, and
the only thing that distinguishes it is re-running when nothing else is. W08 recorded the lint
OOM-kill on this machine; this is the same constraint arriving through the test suite.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| A capture's page has no role key | ADR-0025's vocabulary names two kinds of page and a capture is neither. Either a third pair of roles or a decision that captures do not get pages — a human's call, not a workstream's | a later follow-up |
| The page's title is the only identity a re-run has | Two pages with one title under one parent are the same page to the existence check. An instance that legitimately has two would get one | a later follow-up, if it recurs |
| Nothing opens the created page | `PageButton`'s *Open page* stays disabled: the document tool's base URL is instance configuration the web tier is not given. `DOCTOOL_BASE_URL` would close it | a later follow-up |

## Checks

Locally before pushing:

| Check | Result |
|---|---|
| `npx vitest run` (both test database URLs set) | 1 965 passed, 113 files — after re-running on a machine with nothing else on it; see *Surprises* |
| `tsc -b` and `tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `eslint packages/connectors/src`, `eslint apps/sync/src/*` | clean, run per file group — the single `apps/sync/src` invocation is OOM-killed on this machine, the same finding W08 recorded |
| `prettier --check .` | clean |
| `pnpm build` | all packages and three apps |
| `./scripts/privacy-scan.sh` | clean, 43 patterns |

## Privacy

Fixture and invented data only. The page fixtures use invented titles (`Renovate the workshop`), the
bound identifiers in the recorded client are `recorded-<role>`, and the created-page id is
`made-page-0001`. The templates and the pages are invented documents. No real page id, title,
workspace or store appears in this entry or in the diff, which matters more here than anywhere else
in the wave: this is the first code path that addresses a page by identifier.

## Specs touched

[`docs/14-threat-model.md`](../14-threat-model.md) §5 — the least-privilege table gained two rows
and a paragraph on why `create` is not `write`. [`packages/connectors/CLAUDE.md`](../..//packages/connectors/CLAUDE.md)
lists the role vocabulary and gained ADR-0025's four. [`seed.example/bindings.json`](../../seed.example/bindings.json)
shows an instance what to bind, and [`fixtures/bindings.json`](../../fixtures/bindings.json) does the
same with invented identifiers.
