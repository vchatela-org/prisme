# STATUS

*Where prisme is, in one screen. Updated by hand — agents update their own row on completion.*

**Last updated:** 2026-09-19 · **Current phase:** P0 **frozen** — W00–W09, W12 and W14 landed; **wave 3 is complete**, and **wave 4 is under way**: W09 merged ([#30](https://github.com/vchatela-org/prisme/pull/30)), W10 open as [#31](https://github.com/vchatela-org/prisme/pull/31)

---

## Phases

| Phase | What it delivers | Exit criteria | State |
|---|---|---|---|
| **P0** | Data model, ownership matrix, scoring contract, workstream briefs | Model reviewed and frozen; every field singly owned; both rituals map onto surfaces | 🟢 **frozen 2026-09-15** |
| P1 | Foundations + read-only ingest + Focus & Areas | prisme answers "what now?" from real data, writing nothing | ⚪ not started |
| P2 | Initiative ownership + reconciler write-back | A week of reviews with no manual copying and no drift | ⚪ not started |
| P3 | Reviews in-app (weekly → yearly) | Weekly review runs entirely in prisme | ⚪ not started |
| P4 | KPI & history | Balance chart changes at least one decision a month | ⚪ not started |
| P5 | Timeline / Gantt & dependencies | Moving one initiative correctly replans its dependents | ⚪ not started |
| P6 | MCP + API hardening | An agent can run a review end to end | ⚪ not started |
| P7 | Objectives / OKR + write-back | OKRs authored in prisme, reported in the document tool | ⚪ not started |
| P8 | Readings, Rituals, Signals lanes | Lanes measured, backlog uncontaminated | ⚪ not started |
| P9 | Capture, PWA, notifications | Capture from a phone in under 10 seconds | ⚪ not started |

Detail and rationale: [`docs/30-roadmap.md`](docs/30-roadmap.md).

## Workstreams

| # | Workstream | Depends on | Wave | State | PR |
|---|---|---|---|---|---|
| [W00](docs/40-workstreams/W00-foundations.md) | Foundations: monorepo, CI, images, DB, migrations, observability | — | 1 | 🟢 | [#5](https://github.com/vchatela-org/prisme/pull/5) merged |
| [W01](docs/40-workstreams/W01-domain-scoring.md) | Domain model + pluggable scoring registry | — | 1 | 🟢 | [#17](https://github.com/vchatela-org/prisme/pull/17) merged |
| [W02](docs/40-workstreams/W02-schedule-engine.md) | Schedule & dependency engine | W01 | 2 | 🟢 | [#19](https://github.com/vchatela-org/prisme/pull/19) merged |
| [W03](docs/40-workstreams/W03-connectors.md) | Connectors, read path | — | 1 | 🟢 | [#18](https://github.com/vchatela-org/prisme/pull/18) merged |
| [W04](docs/40-workstreams/W04-reconciler.md) | Reconciler: plan/apply, conflicts, intent channel | W01, W03 | 2 | 🟢 | [#21](https://github.com/vchatela-org/prisme/pull/21) merged |
| [W05](docs/40-workstreams/W05-api.md) | REST API + OpenAPI | W01, W03 | 2 | 🟢 | [#22](https://github.com/vchatela-org/prisme/pull/22) merged |
| [W06](docs/40-workstreams/W06-mcp.md) | MCP server + dry-run write guards | W05 | 3 | 🟢 | [#26](https://github.com/vchatela-org/prisme/pull/26) merged |
| [W07](docs/40-workstreams/W07-design-system.md) | Design system & app shell | W00 | 1 | 🟢 | [#20](https://github.com/vchatela-org/prisme/pull/20) merged, [#28](https://github.com/vchatela-org/prisme/pull/28) |
| [W08](docs/40-workstreams/W08-ui-focus.md) | UI: Focus, Backlog, Inbox | W05, W07 | 3 | 🟢 | [#27](https://github.com/vchatela-org/prisme/pull/27) merged |
| [W09](docs/40-workstreams/W09-ui-areas-kpi.md) | UI: Areas, Balance, KPI dashboard | W05, W07 | 4 | 🟢 | [#30](https://github.com/vchatela-org/prisme/pull/30) |
| [W10](docs/40-workstreams/W10-ui-timeline.md) | UI: Timeline / Gantt | W02, W05, W07 | 4 | 🟢 | [#31](https://github.com/vchatela-org/prisme/pull/31) |
| [W11](docs/40-workstreams/W11-ui-objectives-reviews.md) | UI: Objectives, KRs, Review wizard | W05, W07 | 4 | ⚪ | — |
| [W12](docs/40-workstreams/W12-adoption.md) | Adoption queue & migration, no-duplicate guards | W03, W04 | 3 | 🟢 | [#29](https://github.com/vchatela-org/prisme/pull/29) merged |
| [W13](docs/40-workstreams/W13-backfill.md) | History backfill → capacity actuals | W03 | 4 | ⚪ | — |
| [W14](docs/40-workstreams/W14-security.md) | Security: assertion verifier, token store, CSP, CI gates | W00 | 2 | 🟢 | [#23](https://github.com/vchatela-org/prisme/pull/23) merged |
| [W15](docs/40-workstreams/W15-creation-flows.md) | Creation flows: capture, initiative, project | W04, W05, W07 | 5 | ⚪ | — |

⚪ not started · 🟡 in progress · 🟢 done · 🔴 blocked · **PR** is the pull request carrying the
workstream, `—` until one is open, and the one that landed it once the row is 🟢.

**Every workstream lands as a pull request on a `ws/<id>` branch, and stops only when it is green** —
green read back from the pull request after the last push, not assumed from a local run.
The agent fills in [the template](.github/pull_request_template.md) — features, specs, every check by
name and result, privacy position, what it did not do. **A human merges**; no agent merges its own
PR. `main` is protected: a pull request is required, the checks below are required, and `enforce
admins` is on, so the bypass an agent used to have through the owner's token is gone.

Required on every PR, as of W00 (#5):

`privacy deny-list` · `gitleaks` · `security gate self-test` · `internal links` ·
`dependency review` · `typecheck` · `lint` · `test` · `build` · `dependency audit` ·
`golden fixtures` · `images` · `CodeQL (actions)` · `CodeQL (javascript-typescript)` ·
`CodeQL (python)`

✅ **Both are now enforced on `main`.** W14 found, on 2026-09-18, that the required-check list did
**not** include `golden fixtures` — despite this file claiming it since W01 (#17) — and that
`security gate self-test` had never been added. Branch protection is a setting a human makes, not
an agent silently, so W14 listed it rather than changing it; it was closed the same day, by hand,
and read back from the API to confirm — [the W14 entry](docs/50-journal/W14-2026-09-18-security.md).
A list of required checks that nobody reads back is how a gate stops being required without anybody
deciding it should.

`security gate self-test` (W14) is the negative control for the two secret scanners: it plants a
generated secret and a generated deny-list hit in a throwaway worktree and fails if either scanner
accepts them — or if a clean tree is rejected, because a deny-list that refuses everything is not a
working one. W00 watched both fail by hand once; this is that, on every pull request, because a
`paths:` filter or a bad merge turns a gate into decoration and the build stays green either way.

`images` builds all three images, Trivy-scans them, and asserts what is only checkable on a real
container: that `prisme-api` and `prisme-sync` are the same digest, that neither runs as root, that
`/healthz` answers with an unreachable database while `/readyz` returns 503, and that a missing
required variable stops the process with the variable named. `dependency audit` is
`pnpm audit --audit-level=moderate`. `golden fixtures` (W01, #17) refuses a change to a scoring
golden file that does not bump the method's `version` — without it, two runs of "version 1" can mean
two different things and every stored score becomes unattributable (ADR-0006). Each became required
from the commit that added it. W14 still owns its own additions. Rules, and what to do at each
ending:
[`docs/40-workstreams/README.md#checks`](docs/40-workstreams/README.md#checks).

Both security gates have been **watched fail** and are not taken on trust —
[the W00 entry](docs/50-journal/W00-2026-09-15-foundations.md) records how, and the two things that
surprised us while doing it. As of W14 that is no longer a memory: `security gate self-test` watches
them fail on every pull request, so a gate that quietly stops firing is a red build rather than a
green one.

**W00–W05, W07 and W14 have landed — wave 2 is complete.** Nothing any of them depends on is open.
W07 (#20) closed wave 1; W04 (#21) landed the reconciler, so `plan` and `apply` are real and the
write freeze is the only thing standing between prisme and an outward write — which unblocks
**W12**. W05 (#22) landed the API contract, so **W08–W11 have everything they compose from** and
**W06 is unblocked**: its tools wrap the same service layer rather than the routes, and W14 has
already built the diff-bound confirmation mechanism they need.

**W06 is the first of wave 3** ([#26](https://github.com/vchatela-org/prisme/pull/26)): seventeen MCP
tools on one stateless endpoint, wrapping the same service layer the REST routes call. Every write
tool is a dry run returning a diff and a token bound to it, verified against a plan **re-derived at
execution time** — so a confirmation cannot authorise a diff nobody saw, and goes stale the moment
the world moves. The endpoint reads the *tool's* scope before it authenticates and hands that to the
authorizer, which is what makes W14's kill switch reach a tool written today with nothing in W06
noticing. The MCP protocol is implemented against its specification rather than taken from the
reference SDK — [ADR-0024](docs/20-decisions/0024-mcp-without-the-sdk.md), which accepts out loud
that conformance is now ours.

**W08 is the second** ([#27](https://github.com/vchatela-org/prisme/pull/27)): Focus, Backlog, Inbox
and initiative detail — the screens prisme is actually used from. Every decision they make is a pure
function in `apps/web/src/lib`, tested without a browser, and nothing above it computes a score: the
ranking and its explanation are displayed exactly as the API returns them. Driven against a
fixture-derived dataset through a throwaway local identity provider, because `packages/auth` has no
development bypass and the middleware resolves a real JWKS before any route renders — which is
correct, and which every remaining UI workstream will have to solve again.

That run surfaced one cross-workstream defect, and it is now **closed**
([#28](https://github.com/vchatela-org/prisme/pull/28)): W14's CSP refuses every server-rendered
`style` attribute, a nonce cannot authorise one, and `<AreaBadge>` and `<BalanceMeter>` painted
their colour that way — about a hundred violations per page, and no area colour until hydration.
The policy did not move. Colour now reaches HTML as a literal utility class and SVG as a `fill`
attribute, both derived from the area's slot, and the balance meter's fill is an SVG `rect` because
a length that comes from data is exact as an attribute. The repository's first component test
renders the design system and asserts the markup carries no `style=`, so this cannot come back
unseen. What is left on the gallery is twelve violations from Radix's own markup, recorded in
[the entry](docs/50-journal/W07-2026-09-19-csp-inline-style.md) with its options — two of them make
a hidden native control visible, so wave 4 should know.

**W09 opens wave 4** ([#30](https://github.com/vchatela-org/prisme/pull/30)): Areas, area detail,
the Year Review and the KPI dashboard — declared versus observed capacity, which is the view that
exists in no other tool and the reason prisme allocates before it ranks. The rule the workstream is
really about is the year boundary, and it is a lookup rather than a convention: weights are held per
year, a bucket resolves its own, and writing 2027's allocation leaves 2026's target line exactly
where it was — proved against a live instance, not only in a test. Cycle time is **deliberately not
drawn**: prisme records no moment at which an initiative started, and reconstructing one from the
event log is aggregation the API owns.

Two defects it found matter to everyone. **Every write from `apps/web` was being answered `403`** —
W14's CSRF check requires an `Origin` on the assertion path, `apiFetch` sent none, and that silently
broke W08's status and estimate writes and W12's three adoption decisions. Reads were unaffected,
which is why four screens shipped without anyone seeing it. And **`packages/ui`'s charts could not be
rendered from a server component at all**, because `format` is a function prop and a function cannot
cross that boundary — a `500` on first open, after every check had passed. Both are fixed here, the
second additively, so **W10 and W11 will not hit either**. What is *not* fixed, and is now the most
visible thing left: area colour collides on every screen, because the pinning map `packages/ui`
provides is mounted nowhere but the gallery —
[the entry](docs/50-journal/W09-2026-09-19-ui-areas-kpi.md).

**W10 is the second of wave 4** ([#31](https://github.com/vchatela-org/prisme/pull/31)): the
Timeline — bars, dependency edges, the critical path, deadline markers and drag-to-replan. Nothing
on the screen computes a date: the plan comes from `/timeline`, a drag asks what a move would do and
renders the answer, and committing writes `earliest_start` — the only scheduling date a human owns.
No deadline is written from this screen and there is nowhere for it to be.

It found the same shape of missing dependency W12 did, and closed it: **W02 built `replan` and W05
never exposed it**, so the drag had nothing to ask. `GET /timeline/replan` is that endpoint, and it
is a `GET` on `read:timeline` deliberately — a preview writes nothing, and behind a write scope it
would go dark exactly when W14's kill switch is pulled, which is the moment somebody most wants to
know what they are about to be unable to do. A move is a *request*: a dependency or a full area can
refuse the day a bar was dropped on, and the panel says so rather than drawing the bar somewhere
else. Five defects no check could see, including a bar whose hit area was the width of the plot,
and the **left-edge mirror** of the axis-clipping bug W09 fixed on the right — writing one test and
not its mirror is the mistake worth remembering. The harness was built and thrown away for the
fourth time, and the entry now carries the three details that cost the most time —
[the entry](docs/50-journal/W10-2026-09-19-ui-timeline.md).

**W12 closed wave 3** ([#29](https://github.com/vchatela-org/prisme/pull/29)): the adoption path,
which is the highest-risk workstream in the project and the one thing standing between prisme and
years of existing work. It is `plan`-only by shape rather than by a flag — `adopt` takes two *read*
clients and a store whose only write is a candidate mirror, so there is no outward door for a caller
to find. The scan is level-triggered like every other pass: the whole external world in, the whole
queue out, and `adoption_candidate` replaced wholesale. Decisions live in `entity_link` and
`adoption_ignore`, which a scan never touches.

Two things in it are worth knowing before reading the diff. **Rule 4 needed more than a threshold**:
pure Sørensen–Dice scores `Review the 2026 budget` against `Review the 2027 budget` at 0.90, and no
threshold separates that pair without rejecting every real near-match too — so a fuzzy proposal now
requires the score *and* a word-level agreement test, and a ten-pair near-miss corpus is refused even
at a threshold of zero. And **the queue holds only what would become an entity**: a loose task, a
principle and a signal are counted and reported, never queued, because nobody works a queue of four
thousand. A 4 020-object corpus produces a queue of five, asserted rather than hoped.

The document-tool half of the classifier is built, unit-tested and **not reachable**: nothing in this
repository loads the role bindings, so `createDocToolClient` still has no caller and the scan runs on
the task tool alone — saying `document tool   not read` in its header rather than pretending
otherwise. That is a missing dependency, recorded in
[the entry](docs/50-journal/W12-2026-09-19-adoption.md), not a gap in W12.

**The API now has a caller.** Until W14, every route declared a scope and no authorizer was
installed, so the API answered `401` to everything. #23 installs the mechanism: a verified identity-
provider assertion for humans, Argon2id-hashed scoped tokens for agents, deny-by-default on every
route, an API-level kill switch that withholds write scopes, and a strict CSP on the web tier. Its
two settings follow-ups — the required-check list and secret scanning — were closed by hand the
same day, [#24](https://github.com/vchatela-org/prisme/pull/24). **Wave 3 (W06, W08, W12) is now
fully unblocked**, and **W13** was already. W00's
remaining follow-ups —
including the Docker build fix its first publish found, and the re-tag that has to follow it — are in
[the close-out entry](docs/50-journal/W00-2026-09-15-close-out.md). Scheduling guidance, and the one
wave that will conflict:
[`docs/30-roadmap.md#scheduling-the-agents`](docs/30-roadmap.md#scheduling-the-agents).

## P0 is frozen

Checked on 2026-09-15, against the exit criteria in
[`docs/30-roadmap.md`](docs/30-roadmap.md#p0--model-and-specification):

- [x] **Every field in the matrix has exactly one owner.** One cell read as two (`T / ∂`); it is a
      task-tool field prisme *propagates* under the overwrite guard, so owner and flow are now
      separate columns — [`docs/11-ownership.md#1-legend`](docs/11-ownership.md#1-legend)
- [x] **Both rituals map onto surfaces and entities, nothing left over** — the map was missing and is
      now written: [`docs/10-model.md#cadences-and-where-each-step-happens`](docs/10-model.md#cadences-and-where-each-step-happens)
- [x] **The spec set is internally consistent** — every internal link and anchor resolves, now
      enforced by the `docs` workflow; the open questions are numbered identically everywhere
- [x] 16 workstream briefs, 22 ADRs, synthetic fixtures, privacy machinery — all present

**What frozen means:** the model no longer changes because a workstream finds it inconvenient.
Changing anything in [`docs/10-model.md`](docs/10-model.md) or
[`docs/11-ownership.md`](docs/11-ownership.md) now takes an ADR. The previous attempt at this system
failed on an ambiguous model, and code written against an unfrozen model is code written twice.

## Decisions

**22 accepted** · **7 open** — index: [`docs/20-decisions/`](docs/20-decisions/README.md)

Open questions and what each one blocks: [`docs/20-decisions/OPEN.md`](docs/20-decisions/OPEN.md).
None blocks P0.

✅ **OQ-9 is closed** — [ADR-0021](docs/20-decisions/0021-verified-forward-auth-assertion.md):
forward-auth, with the identity provider's signed assertion **verified** rather than its headers
trusted. **W14 is unblocked**, and no open question now blocks a workstream. OQ-1 and OQ-2 block
P2; the rest are deferred by choice.

✅ **Database backups are not a prisme task** —
[ADR-0022](docs/20-decisions/0022-backups-belong-to-the-deployment-repository.md): a dump CronJob in
the GitOps deployment repository, beside its other databases. **Nothing in this repository builds,
schedules or checks a backup**, and no workstream is waiting on one. It gates a single moment, below.

## Before the first outward write

The one-time gate on [`docs/13-migration.md`](docs/13-migration.md#5-sequence) step 8 — lifting the
write freeze (`SYNC_WRITE_ENABLED=true`). Not enforced by code; a human owns each line.

- [ ] Backup CronJob deployed for prisme's database — **deployment repository**, ADR-0022
- [ ] **A restore rehearsed at least once**, not merely scheduled
- [ ] `plan` read by hand, `create: 0` confirmed (ADR-0010 guard 3)
- [ ] Adoption queue worked; link coverage reported (W12)
- [ ] `prisme-sync adopt --plan` **run against the live instance** and read by hand. W12 built it and
      deliberately recorded no output: the plan carries real titles and cannot enter this repository
      (`apps/sync/CLAUDE.md`). A human runs it, confirms `Would create: 0`, and agrees with the plan

## Before the repository goes public

Swept 2026-09-15; the repository is public as of that date.

- [x] `gitleaks` over the **entire history**, not just the working tree
- [x] Privacy deny-list scan over the entire history
- [x] `docs/17-privacy.md` reviewed and agreed
- [x] GitHub settings enabled — see [`docs/17-privacy.md#4-github-settings-checklist`](docs/17-privacy.md#4-github-settings-checklist).
      ✅ The one partial is closed: CodeQL now covers `actions`, `javascript-typescript` and
      `python` with the `security-extended` suite, as a workflow in git rather than the repository
      default — which could never have covered TypeScript before it merged (W00, #5)
- [x] Licence chosen — MIT ([`LICENSE`](LICENSE))

History was redacted and force-pushed before publication, and the pre-rewrite Dependabot branches
were retired with it — see [`the sweep entry`](docs/50-journal/P0-2026-09-15-publication-sweep.md).
