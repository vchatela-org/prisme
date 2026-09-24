# FUP · 2026-09-24 · A capture's page gets a role pair of its own

**Agent:** Claude · **Duration:** one session · **PR:** this branch · **Outcome:** complete

Closes the gap ADR-0025 stated out loud when it was accepted: *a capture's page is still blocked —
the vocabulary names an initiative's page and a project's page, and a capture is neither.* That was
the right refusal at the time. What was wrong was the length of time it stood, because the screens
went on offering **Create one** for a capture and the ledger went on holding an intention that no
pass, and no binding, could ever satisfy.

## What was done

- **ADR-0028 accepted**: `capture_pages_db` and `capture_page_template`, at `create` and `read`,
  with `capture` joining `PageKind`. It extends ADR-0025 and changes nothing else about it — the
  store-and-template pair is still the unit, and an unbound kind still blocks with a reason.
- **The vocabulary is generic, so most of this is the compiler's.** `PAGE_ROLE_FOR` and
  `PAGE_TEMPLATE_FOR` are `Record<PageKind, RoleKey>`, so adding the kind made every site that must
  know fail to build until it did. Two sites were the exception and are fixed below.
- **`addressablePageKinds` now derives its kinds from `PAGE_ROLE_FOR`** instead of iterating a
  hardcoded `['initiative', 'project']`. That hardcoded pair is exactly how the third kind would have
  been bound and still planned as unbound, with every check green.
- **The planner's second block reason is gone.** `orderConvergence` no longer special-cases a
  capture, and `PAGE_KIND_UNSUPPORTED` is deleted rather than left unused. One reason remains —
  unbound roles — and it is one a human can act on.
- **Four pieces of UI copy that promised a stall now say what actually stalls.** The ledger's advice,
  the page button, the capture's page choice and the request toast all said a page *"waits on a
  decision rather than on a pass"*. True before ADR-0025, stale since, and wrong in a way that
  mattered: it told a person their page could never be made when the only thing missing was two
  bindings.
- **The creations screen stops counting page intents apart.** `waitingOnADecision` is removed from
  `LedgerSummary` and its stat tile is gone. A page intent is ordinary queued work now, and a count
  that can only read zero reads as a state somebody is watching.

## Decisions taken

**A third role pair, not a route through an initiative's.** The shortcut — bind captures to
`initiative_pages_db` because a capture is usually promoted — is precisely the guess ADR-0025
refused, and the two templates exist because the parents differ. A page created under a parent
nobody chose is content in the wrong place, and moving it afterwards is manual work in another tool.

**Accepted, not Proposed.** Unlike ADR-0027, whose gate was already implemented and whose acceptance
was genuinely an agent's to wait for, this decision was taken by the owner before any of it was
written. The record says so.

**The widening is why it is an ADR at all.** ADR-0025 wrote it down itself: *"Widening it is a
threat-model change, not an implementation detail."* A third role gains the `create` verb, so §5's
table moves with the ADR rather than with the commit.

**The deleted count is a deletion, not a rename.** `waitingOnADecision` could have become
`waitingOnBindings` and read zero on every bound instance. It was removed because the screen genuinely
cannot tell a page waiting for the next pass from a page this instance cannot make — the blocked
reason is computed by the pass and is not stored on the row — and a column that implies it can is
worse than the absence.

## Surprises

**Every new test was watched fail, and the mutation is the interesting part.** The vocabulary check
was proved by making `resolveCreation` return `initiative` for every page kind — the silent
wrong-parent failure ADR-0025 refused to make on purpose. Two tests went red, one of them the one
that asserts a capture's page runs only when *capture's* pair is bound, which is what shows the new
role is doing the work rather than borrowing an initiative's addressability.

**Removing the second block reason removed a test's reason to exist, and that is the good case.**
The old test asserted the plan reported the *vocabulary* for a capture's page, and its comment
explained why: an operator sent to run `bindings` for a problem bindings could not fix would run it
twice and report the same bug. The replacement asserts the opposite direction — that the reason is
now `PAGE_UNBOUND` — so the two behaviours cannot be confused silently.

**The stale copy was older than this change and is worth naming.** It was introduced when ADR-0025
landed and nobody updated the strings that ADR-0025 had made untrue. Four files, all saying the same
sentence, and the ledger's own comment went further: *"today, every page, because the document tool
has no addressable store for one"*. Finding it here was luck rather than process — nothing checks
that copy still matches the model — and it is recorded rather than fixed further.

**`seed.example/bindings.json` is a spec, so it moves with the ADR.** The format example a real
instance copies gained the pair, with a note that a kind is addressable only when both halves are
bound. The fixture followed, and one test's expected length went from ten to twelve — the honest
cost of a vocabulary that is a list rather than a number.

**The same assertion existed in a second suite, and only CI could see it.** The local run was
`pnpm test` without a database, so the ten integration files skipped — and `bindings.integration.test.ts`
asserted the same twelve-role list against PostgreSQL. **CI went red on `test` and was right.** The
lesson is not "run the integration project too", although that is the remedy: it is that a fixture is
referenced by suites a unit run cannot reach, so a change to one has a local green that means less
than it looks like. Both files are updated, and the whole integration project was then run locally
(ten files, 193 tests) rather than only the file CI named. `apps/sync/src/test-support/database.ts`
gates those suites on `PRISME_TEST_DATABASE_URL` and throws rather than skipping when `CI` is set,
which is exactly the property that made this a red build instead of a silent skip — the same
reasoning as the `golden fixtures` gate.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| Nothing checks that UI copy still matches the model | Four files carried the same sentence ADR-0025 had invalidated, for three days, and only a person reading them would notice | nobody — recorded; a copy-lint would be a lint rule with an opinion about prose |
| Workstream briefs still list the six original role keys (`W03`) | They describe what each workstream built, which is true; the vocabulary now lives in `role-key.ts` and the ADRs, and rewriting a closed brief would restate history | nobody |
| An instance must bind two more roles | Deployment step, and the plan says so per intent with the command that fixes it | the owner, at deployment |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `typecheck` | local + CI | clean — `tsc -b` and the per-package pass including tests. **The first run failed and that is the point**: `apps/sync/src/index.ts` still re-exported the deleted constant |
| `lint` | local (per tree, the whole-repo run is OOM-killed on this machine) + CI | clean — `eslint apps/sync/src packages/connectors/src apps/web/src`, `prettier --check` on every changed file (five needed reformatting) |
| `test` | local + CI | **1 939 passed** across both projects — 113 files / 1 746 unit, plus 10 files / 193 integration against PostgreSQL. Two pre-existing assertions updated: `bindings.test.ts` and `bindings.integration.test.ts` each expected ten roles in the fixture, and there are twelve. **The first CI run went red on `test`** for the integration one, which a database-less local run skips |
| `build` | CI | unchanged in shape; no new dependency |
| `internal links` | CI | the new ADR is linked from the index and from §5 of the threat model |
| `privacy deny-list` · `gitleaks` | local (pre-commit) + CI | local clean; the fixture's new identifiers are invented and shaped like the ones beside them |
| every other required check | CI | see the rollup on the pull request |

## Privacy

Fixture and invented data only. The new identifiers (`binding-capture-pages-0012`,
`binding-capture-template-0013`) are synthetic and follow the invented scheme already in that file;
`seed.example/` carries `REPLACE-ME`, which the loader refuses rather than binds. No real database
name, identifier, workspace or hostname appears in this entry or in the diff. The deny-list and
secret scans are green, and the pre-commit hook ran both.

## Specs touched

- [`docs/20-decisions/0028-capture-pages-get-a-role-pair.md`](../20-decisions/0028-capture-pages-get-a-role-pair.md)
  — new, **Accepted**.
- [`docs/14-threat-model.md`](../14-threat-model.md) §5 — the least-privilege table, which is the
  widening the ADR exists to record.
- [`docs/20-decisions/README.md`](../20-decisions/README.md) — the index row and the counts.
- [`docs/15-runtime.md`](../15-runtime.md) §2 — the bindable roles, and the rule that a kind is
  addressable only when its store and its template are both bound.
- [`docs/17-privacy.md`](../17-privacy.md) §1 — the role-key list, which had been six since before
  ADR-0025 and was two vocabularies stale.
- [`packages/connectors/CLAUDE.md`](../../packages/connectors/CLAUDE.md) — the role list in the
  non-negotiables.
- [`seed.example/bindings.json`](../../seed.example/bindings.json) — the documented format, and
  [`fixtures/bindings.json`](../../fixtures/bindings.json) with it.
- [`STATUS.md`](../../STATUS.md) and [`docs/50-journal/INDEX.md`](INDEX.md) — the register row and
  this entry.
