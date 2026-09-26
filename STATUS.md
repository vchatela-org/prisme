# STATUS

*Where prisme is, in one screen. Updated by hand — agents update their own row on completion.*

**Last updated:** 2026-09-26 · **Current phase:** P0 **frozen** — **every workstream has landed** and
the follow-up wave has closed what they recorded. Waves 3 and 4 completed with W09
([#30](https://github.com/vchatela-org/prisme/pull/30)), W10
([#31](https://github.com/vchatela-org/prisme/pull/31)), W11
([#32](https://github.com/vchatela-org/prisme/pull/32)) and W13
([#33](https://github.com/vchatela-org/prisme/pull/33)), and **W15 closes wave 5** as
[#34](https://github.com/vchatela-org/prisme/pull/34). W00–W15 are all 🟢. **What stands between the
repository and the functional phase is no longer a workstream but the rows below marked 🟡**, found
by reading the journal entries rather than by any check; what remains beyond them is a human's: the
gate before the first outward write, and the open decisions below

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
| [W11](docs/40-workstreams/W11-ui-objectives-reviews.md) | UI: Objectives, KRs, Review wizard | W05, W07 | 4 | 🟢 | [#32](https://github.com/vchatela-org/prisme/pull/32) |
| [W12](docs/40-workstreams/W12-adoption.md) | Adoption queue & migration, no-duplicate guards | W03, W04 | 3 | 🟢 | [#29](https://github.com/vchatela-org/prisme/pull/29) merged |
| [W13](docs/40-workstreams/W13-backfill.md) | History backfill → capacity actuals | W03 | 4 | 🟢 | [#33](https://github.com/vchatela-org/prisme/pull/33) |
| [W14](docs/40-workstreams/W14-security.md) | Security: assertion verifier, token store, CSP, CI gates | W00 | 2 | 🟢 | [#23](https://github.com/vchatela-org/prisme/pull/23) merged |
| [W15](docs/40-workstreams/W15-creation-flows.md) | Creation flows: capture, initiative, project | W04, W05, W07 | 5 | 🟢 | [#34](https://github.com/vchatela-org/prisme/pull/34) |

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
required variable stops the process with the variable named. `dependency audit` runs
[`scripts/dependency-audit.py`](scripts/dependency-audit.py), which runs
`pnpm audit --audit-level=moderate` and **fails closed** when the advisory database does not answer —
naming which of the three outcomes it saw, so *unchecked* is never read as *vulnerable*
([ADR-0027](docs/20-decisions/0027-audit-gate-fails-closed.md), Accepted). `golden fixtures` (W01, #17) refuses a change to a scoring
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
unseen. What was left on the gallery was twelve violations from Radix's own markup, recorded in
[the entry](docs/50-journal/W07-2026-09-19-csp-inline-style.md) with its options — two of them made
a hidden native control visible, which is what made them a rendering defect rather than console
noise. **They are closed to zero**: five patches in `patches/`,
each naming a class the token sheet generates, with four render cases that fail **by name** if a
dependency bump invalidates one ([#41](https://github.com/vchatela-org/prisme/pull/41)).

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

**W11 is the third of wave 4** ([#32](https://github.com/vchatela-org/prisme/pull/32)): Objectives,
key results and the four cadence reviews — the screens where decisions are actually made. The wizard
encodes the cadence map's step *shapes* row for row and never a concrete checklist, which is instance
data; each step renders the data it is about, because a checklist that merely lists steps is no
better than the paper one. Resume is the **first unticked step**, not the furthest reached, and every
tick is a read-merge-write: `PATCH /reviews/:id` replaces the checklist wholesale, so sending only
the steps this build knows would delete an instance's own. Closing is its own action, because it
takes the capacity snapshot and the API never retakes it.

It found two defects older than itself. **`areaListSchema` has never parsed a real `/areas`
response** — the endpoint is not paged and the schema has demanded `total`, `limit` and `offset`
since W08 — so Focus, Backlog, Inbox, Adoption and initiative detail have all been showing the area
*key* where they meant the name, quietly, because `health` instead of `Health` reads as a styling
choice. And **`fixtures/objectives.json` was loaded by nothing**: listed in the fixtures README,
written with coverage notes naming this workstream, and never once put in a database — so it had
drifted to three statuses the schema's CHECK constraint forbids. `seedFixtures` now loads it. Both
are fixed here. What was **not** fixed here: `fixtures/` carried no task mirror, so
`progressComputed` was null on every key result from a plain seed and ADR-0013's divergence — the
behaviour this workstream exists to surface — could only be reached by hand-seeding rows inside a
test, which is a test of the hand-seeding rather than of the divergence. `fixtures/task-mirror.json`
now carries one, six divergence cases among its rows
([#36](https://github.com/vchatela-org/prisme/pull/36)).
The harness was built and thrown away for the **fifth** time —
[the entry](docs/50-journal/W11-2026-09-20-ui-objectives-reviews.md).

**W13 closes wave 4** ([#33](https://github.com/vchatela-org/prisme/pull/33)): completion history
turned into per-area capacity actuals, ritual adherence and materialised weeks. Until now the only
completions prisme held were in `task_mirror` — the *anchor subtree* — so the balance factor was
computed from whatever fraction of a life happened to sit under an anchor in the last four weeks.

The decision the rest of it hangs off is that **`completion_history` stores the external location
and not an area**. Attribution is re-made from `area_mapping` on every pass, so adding a mapping for
a project that has existed for years re-attributes years of history without fetching a page — proved
live: one mapping row took a corpus from 68 unattributable completions to zero, with **zero windows
fetched**. Idempotence is likewise structural rather than careful: `(external_task_id, completed_at)`
is the identity of a completion, so a re-run cannot double-count whatever the caller does.

One defect only a real second run could find, and it is the instructive kind. The materialised weeks
and the covered instants are **not the same range** — bucketing is by Monday, so a backfill starting
on a Sunday writes a row for the week before it — and the delete missed it while the insert did not.
The in-memory store had the *identical* off-by-one, so the unit suite agreed with the SQL and both
were wrong, and every fixture started on a Monday, which is the one case that cannot fail. A new
table with a foreign key also turned **106 tests red in two suites nobody had touched**, which is
the deliberate absence of `truncate … cascade` working as designed.

What was **not** done: `capacity_week` had no reader — `/areas` and `/kpi` still aggregated
`task_mirror` — and the **document tool was not read**. Both were follow-up rows rather than gaps in
W13, and **both are closed**: the dashboard reads the materialised weeks in preference to the anchor
subtree ([#38](https://github.com/vchatela-org/prisme/pull/38)), and the role bindings load so both
tools are read ([#39](https://github.com/vchatela-org/prisme/pull/39)). What the second closure does
**not** buy is the declared-duration tier: it needs a bound `processes_db` *and* a named duration
property, and an instance with neither leaves the preference order two-tier and says so rather than
passing a two-tier estimate off as a three-tier one — the **rituals row below** names what is left.
[The entry](docs/50-journal/W13-2026-09-20-backfill.md).

**W15 closes wave 5, and the project's sixteen workstreams**
([#34](https://github.com/vchatela-org/prisme/pull/34)): quick capture, new initiative, new project,
and the ledger that makes a multi-tool creation survivable. There is **no transaction spanning two
SaaS APIs**, so the intention is committed before anything outward is attempted: a project is a
prisme row, a task-tool project, one section per subtopic and perhaps a page, and a failure partway
through leaves a screen saying which parts exist rather than a workspace to go and audit.

Two things in it are worth knowing before reading the diff. **The idempotency key is stored on the
row, not derived per pass** — the opposite of the reconciler's rule, and deliberately: a creation is
one logical write that outlives a pass, so every retry carries the same key forever and the tool
recognises the second send as the first. That is what closes the window the whole ledger exists for,
the writer succeeding and the process dying before the id is recorded. And **promotion satisfies
ADR-0010 guard 2 rather than re-implementing it**: the initiative is inserted with
`external_anchor_id` already set, so the planner is structurally unable to emit a create for it —
proved by running the *real* planner over the promoted initiative, with a control that removes the
anchor and watches the same planner emit one.

Six defects only running found, and one that is everybody's. **`GET /areas?limit=200` answers
`400`** — `noQuery` is strict and refuses an unrecognised key rather than ignoring it — so Focus,
Backlog, Inbox, Adoption and initiative detail have each been taking their area list's failure path
on every load since W08. W11 recorded it as harmless; it was not. Fixed in all five. The other five
include a route group that served every new screen at the wrong URL, `sql.json()` failing on the
Drizzle-wrapped client the API actually runs with — **invisible to an integration suite that builds
a bare one**, which is now a follow-up in its own right — and a frozen deployment recording every
intent as failed, so a correctly-configured instance showed a red CronJob every fifteen minutes.

What was **not** done, and it was a decision rather than a gap: **ADR-0011's *Create page* could not
be implemented** — no role key named where a narrative page would live, none was a template, and the
least-privilege table granted the document-tool token no capability that would cover it. W15 recorded
the intent, the converge pass blocked it with the reason on the line, and *Link existing page* worked.
**The decision is taken and the gap closed.**
[ADR-0025](docs/20-decisions/0025-page-creation-needs-a-role-vocabulary.md) is **Accepted 2026-09-21**,
implemented in the pull request that accepted it — two role keys, two template bindings, and a
`create` capability narrower than `write` — and
[ADR-0028](docs/20-decisions/0028-capture-pages-get-a-role-pair.md) **Accepted 2026-09-24** gave a
capture the pair it was missing. *Create page* works for an initiative, a project and a capture; the
one block reason left is an unbound role, which `prisme-sync bindings --from <path>` fixes
([#40](https://github.com/vchatela-org/prisme/pull/40),
[#69](https://github.com/vchatela-org/prisme/pull/69)).
[The entry](docs/50-journal/W15-2026-09-20-creation-flows.md).

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

The document-tool half of the classifier was built and unit-tested but **not reachable** when W12
landed: nothing in this repository loaded the role bindings, so `createDocToolClient` had no caller
and the scan ran on the task tool alone — saying `document tool   not read` in its header rather than
pretending otherwise. That was a missing dependency rather than a gap in W12, and it is closed: the
bindings load, the adoption scan is handed a document-tool client
([#39](https://github.com/vchatela-org/prisme/pull/39)), and an instance that has bound only some of
the roles scans what it has and reports which role it did not read.
[The entry](docs/50-journal/W12-2026-09-19-adoption.md).

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

## Follow-up wave

The sixteen workstreams landed and each recorded what it deliberately did not do. This wave closes
those gaps. It is not a workstream: there is no brief, and each row is a follow-up recorded in a
journal entry rather than a unit of planned work.

| Gap | Recorded by | State | PR |
|---|---|---|---|
| The integration suite builds a bare DB client, so a whole class of serializer defect is invisible to it | W15 (W11 predicted the shape) | 🟢 | [#35](https://github.com/vchatela-org/prisme/pull/35) merged |
| `fixtures/` carries no task mirror, so `progressComputed` is null on every key result from a plain seed | W11 | 🟢 | [#36](https://github.com/vchatela-org/prisme/pull/36) |
| Area colour collides on every screen — the pinning map exists and nothing mounts it | W09 (W10, W11 confirmed) | 🟢 | [#37](https://github.com/vchatela-org/prisme/pull/37) |
| `capacity_week` has no reader: the dashboard still aggregates the anchor subtree | W13 | 🟢 | [#38](https://github.com/vchatela-org/prisme/pull/38) |
| **The document tool is not read at all** — nothing loads the role bindings, gating W12, W13 and W15 | W12, W13, W15, W03 | 🟢 | [#39](https://github.com/vchatela-org/prisme/pull/39) |
| ADR-0011's and ADR-0019's *Create page* is unimplementable: no role key names where a page would go | W15 | 🟢 | [#40](https://github.com/vchatela-org/prisme/pull/40) |
| Twelve CSP violations from Radix's own markup | W07 | 🟢 | [#41](https://github.com/vchatela-org/prisme/pull/41) |
| W00 close-out: the publish path had never been exercised, and `v0.0.1`'s images do not exist | W00 | 🟢 (run; `v0.0.1` left alone) | [#42](https://github.com/vchatela-org/prisme/pull/42) |
| `DOCTOOL_BASE_URL` / `TASKTOOL_BASE_URL` in `@prisme/config`: the outward path could not be pointed anywhere without patching a constant by hand | W15, repeated by W03's and W15's follow-ups | 🟢 (does **not** unblock *Open page* — see below) | [#43](https://github.com/vchatela-org/prisme/pull/43) |
| **The reconciler's own metrics are invisible in a deployment** — a CronJob pod is never scraped, so the API serves both sync gauges as a constant `0`: the staleness alert fires permanently and the drift alert can never fire | Found while deploying (nobody had recorded it) | 🟢 | [#44](https://github.com/vchatela-org/prisme/pull/44) |
| **The task tool's entire API was removed** — every read, completion and write returned `410 Gone`, and no test in this repository may call a real API, so nothing here could have seen it | found while preparing the deployment (nobody had recorded it) | 🟢 | [#45](https://github.com/vchatela-org/prisme/pull/45) |
| **ADR-0021's first deployment obligation is undeliverable** — the proxy provider cannot be given a durable asymmetric signing keypair, by the identity provider's design, so a verified-assertion forward-auth path cannot be stood up | found while deploying (nobody had recorded it) | 🟢 [ADR-0026](docs/20-decisions/0026-human-auth-via-oidc.md) **Accepted**; login flow implemented, the client **registered and deployed**, and the forward-auth arrangement it replaced removed — [the entry](docs/50-journal/FUP-2026-09-23-oidc-in-the-cluster.md) | [#55](https://github.com/vchatela-org/prisme/pull/55), [#56](https://github.com/vchatela-org/prisme/pull/56), [#60](https://github.com/vchatela-org/prisme/pull/60) |
| **Opening a Radix `Select` logs two CSP violations** — **not** the popper's runtime inline style, as this row first said: both were `style-src-elem`, two `<style>` *elements* (Radix's select viewport and the scroll lock underneath a popup), which no nonce reached and the server-render guard in `packages/ui` cannot see | the OIDC follow-up, found by driving a write in a real browser | 🟢 | [#67](https://github.com/vchatela-org/prisme/pull/67) |
| A popup's injected stylesheets carry the page nonce — the middleware's `x-nonce` reaches the root layout, and from there Radix's `SelectViewport` and `get-nonce` | FUP-2026-09-24 (this wave) | 🟢 | [#67](https://github.com/vchatela-org/prisme/pull/67) |
| `middleware.ts` → `proxy.ts`, **after** a check that a response still carries the CSP and every other security header | FUP-2026-09-23-repo-hygiene | 🟢 | [#67](https://github.com/vchatela-org/prisme/pull/67) |
| Nothing asserted the web tier sends its security headers: `/healthz` is excluded from the matcher and was the only thing the `images` probe read | FUP-2026-09-23-repo-hygiene | 🟢 | [#67](https://github.com/vchatela-org/prisme/pull/67) |
| No logout control in the UI — `POST /auth/logout` exists, is origin-checked and verified end to end, and nothing called it | FUP-2026-09-22-oidc-human-auth | 🟢 | [#67](https://github.com/vchatela-org/prisme/pull/67) |
| The committed fixture harness — gitignored, stale, rebuilt and thrown away nine times | W07, W08, W10, W11, W15, FUP-radix-inline-styles, FUP-tool-base-urls, FUP-doc-tool-api-version, FUP-2026-09-24 (the tenth session to run without one) | 🟢 [committed](harness/README.md) as `harness/` — a fake identity provider, an idempotent seeder and a login driver. Verified by running it, which found two defects: the seeder truncated the migration ledger under the wrong name (so the API was never ready), and the provider had no `/token` route | [#70](https://github.com/vchatela-org/prisme/pull/70) |
| `is_archived` / `is_locked` are returned by the document tool and unread — undocumented booleans, and mapping one would be a guess | FUP-2026-09-22-doc-tool-api-version | ⏸ **settled, not outstanding** — the tool documents neither field, so mapping one is the guess `packages/connectors/CLAUDE.md` refuses. There is no fix to make; it stays unread | — |
| The initiative detail screen's **Open page** — needs a browser-facing base and a page-id → URL shape, and the tool's own page URL is deliberately unread because it identifies the workspace | FUP-2026-09-21-tool-base-urls, FUP-2026-09-21-page-creation | 🟢 decided: an operator-supplied **URL template** (`DOCTOOL_PAGE_URL_TEMPLATE`) rather than a base, so no vendor path shape enters the repository | [#70](https://github.com/vchatela-org/prisme/pull/70) |
| A capture's page has no role key — ADR-0025's vocabulary names an initiative's page and a project's page, and a capture is neither | FUP-2026-09-21-page-creation, FUP-2026-09-21-tool-base-urls | 🟢 [ADR-0028](docs/20-decisions/0028-capture-pages-get-a-role-pair.md) **Accepted**; the pair exists and the plan's second block reason is gone | [#69](https://github.com/vchatela-org/prisme/pull/69) |
| **The document tool's API version predated the endpoints prisme calls** — the client pinned `2022-06-28` (the era of `/v1/databases/`) while calling `/v1/data_sources/query`, so every query returned `400 invalid_request_url` and the scan printed "document tool not read" | found while preparing the deployment (nobody had recorded it) | 🟢 | [#54](https://github.com/vchatela-org/prisme/pull/54) |
| **Two settings that had stopped doing anything, and a tracked file `.gitignore` already refused** — the `eslint` key in `apps/web/next.config.mjs` is rejected with a warning on every build because Next 16 dropped the option *and* the lint step it controlled, and `.cache_ggshield` was committed before the ignore rule covering it existed | W07, W08, W14 | 🟢 | [#57](https://github.com/vchatela-org/prisme/pull/57) |
| **The deny-list missed camelCase id positions** — `\b(id\|…)` never reaches the `Id` inside `projectId`, so the `v1` id shape went uncovered wherever a TS or JSON body would be pasted; a separator-only rule matches the destructuring rename `projectId: parentExternalId`, which is code rather than data | FUP-todoist-api-v1 (found while migrating to the `v1` API) | 🟢 | [#58](https://github.com/vchatela-org/prisme/pull/58) |
| **No CI gate typechecked test files** — `pnpm typecheck` builds `tsconfig.build.json`, which excludes `*.test.ts`, so **43** type errors had accumulated in five packages, including `apps/sync` fakes that had drifted from the interfaces they stand in for (no `createPage` since ADR-0025, a `Transport` still the pre-seam `{ send }` object) | W06 (which recorded **two** — the gate found 43) | 🟢 | [#59](https://github.com/vchatela-org/prisme/pull/59) |
| **`dependency audit` failed having learned nothing when npm's advisory endpoint was unreachable** — a required check whose red meant *could not check* and *found a vulnerability* at once, blocking merges on branches that changed no dependency | W10's entry, tracked as **OQ-10** | 🟢 (the gate fails closed and says which of the three outcomes it saw; [ADR-0027](docs/20-decisions/0027-audit-gate-fails-closed.md) **Accepted** 2026-09-24) | [#66](https://github.com/vchatela-org/prisme/pull/66) |
| **The decision count was wrong in two files at once** — `STATUS.md` said 7 open while `OPEN.md` held 8, and nothing reads either | found while working the open decisions (nobody had recorded it) | 🟢 (both say 8; the deferred questions now carry checkable triggers) | [#66](https://github.com/vchatela-org/prisme/pull/66) |
| **The skill's own *Scheduling* section prescribed the failure it was meant to prevent** — it told the reader to schedule the wave with `CronCreate` and `recurring: true`, which is **deleted after seven days**, so the schedule expired silently; the installed firings also left three weekdays uncovered, doubled one day, and put the earliest of them inside the inference provider's weekday peak-pricing window for the whole daylight-saving half of the year | found while checking the installed schedule against the provider's own pricing (nobody had recorded it) | 🟢 the section now names four requirements — off the hour, off-peak (outside **12:00–18:00 UTC on weekdays**, converted for both DST states), a durable host scheduler, and a dedicated worktree with a lock — and keeps *weekly is enough*: the cadence was never wrong, the mechanism was | [#71](https://github.com/vchatela-org/prisme/pull/71) |
| **Nothing loads areas, weights or their mappings from the seed path** — `parseBindingsFile` reads only the `documentTool` key and silently ignores `areaMappings`, `seed/areas.json` has no loader, and `pnpm seed:load`, which `seed.example/README.md` documents, exists in no `package.json`; `POST /areas` and `PUT /areas/:key/mappings` have no UI caller and no CLI, so a live instance's areas and mappings can only be set by hand-written calls, while [`docs/17-privacy.md`](docs/17-privacy.md) claims they load from `seed/` | FUP-2026-09-21-role-bindings, met again preparing the functional phase | 🟢 `prisme-sync areas --from` and `bindings --from` load them; `pnpm seed:load` runs both, areas first. Re-running is a no-op and a year that disagrees is refused without `--force` | [#74](https://github.com/vchatela-org/prisme/pull/74) |
| `AREA_COLOR_PINS` must be set by hand and **nothing generates it**, so an instance that pins nothing keeps the collision — `areaColorCollisions` can report the clash and only the gallery calls it | FUP-2026-09-21-area-colour-pinning | 🟢 the **Areas** screen names the colliding areas and prints the line to set, keeping what is already pinned and dealing only the gaps — proved in a browser both with the variable unset and with the proposed map applied. **The operator-facing half was still missing**, and running the deployment's bootstrap on 2026-09-25 is what showed it: configuring every other piece of instance data pins nothing, so the first thing such an instance paints is a collision. The step now exists — the deployment repository's runbook §6e (its PR #1266) — and `docs/13-migration.md` §5's read-path pass checks for it, because no pass, job or gate goes red over it | [#75](https://github.com/vchatela-org/prisme/pull/75) |
| **Nothing schedules the backfill** — `capacity_week` stops being refreshed the day the operator stops running the command, and the balance then reads stale weeks while naming them `capacity_week` | FUP-2026-09-21-capacity-week-reader | 🟢 the **daily full pass** re-materialises the trailing `CAPACITY_WINDOW_WEEKS` window; history beyond it is left to `prisme-sync backfill`, and the refresh needs no outward read with no bound document-tool store, so it runs with the write freeze on | [#76](https://github.com/vchatela-org/prisme/pull/76) |
| `review/year` and the area detail call `minutesCaveat` without its source, so two of the three minutes charts do not say which record they are reading | FUP-2026-09-21-capacity-week-reader | 🟢 the three sentences are composed by one pure function (`minutesChartCaveat`) and every chart drawn from attributed minutes now names the record it reads; the test asserts the property over **every** combination rather than one string, which is the shape the defect had | [#78](https://github.com/vchatela-org/prisme/pull/78) |
| The deployment's drift alert was **removed rather than repaired**, and `last_drift_full` is recorded with no reader; `apps/sync/src/main.ts` still sets in-process gauges a CronJob pod can never have scraped | FUP-2026-09-22-sync-metrics | 🟡 **this repository's half is built**; the deployment's is not · the shape decided 2026-09-24 is implemented: `sync_run_state.last_drift_full_objects` (migration 0010) and the **`prisme_sync_drift_full_objects`** gauge, written **only** by a full pass and held across the incremental passes in between by a `coalesce`, so §5's *"above 0 on two consecutive daily full passes"* is now exactly `min_over_time(prisme_sync_drift_full_objects[48h]) > 0`. §5 gained the row and the expression, §16 the pointer, and the three properties that matter are asserted: an incremental pass does not move the series, a measured zero is a sample, and no full pass is an absence. The migration's reversal was **rehearsed on a throwaway database**, not asserted. **What remains is the deployment repository's**: its alert was removed rather than repaired, and re-pointing it at the new series is that side's change. The in-process gauges in `main.ts` stay — vestigial, since the API republishes from the row, and recorded rather than removed because removing them is a separate decision | [#87](https://github.com/vchatela-org/prisme/pull/87) |
| **"Not read" cannot distinguish an unbound role from a refused read** — the privacy reason for the swallow stands; the diagnostic gap is real | FUP-2026-09-22-doc-tool-api-version | 🟢 the swallow stands and the **failure kind** comes back in its place: `unread.ts` keeps vendor vocabulary (never the message, which names the binding) and both reports count it — `not read — 3 refused, 1 unbound_role` | [#79](https://github.com/vchatela-org/prisme/pull/79) |
| `fixtures/` carries no `area_mapping` rows and its task mirror covers only the initiatives that serve a key result, so attribution and computed progress are exercised only partly by a plain seed | FUP-2026-09-21-fixture-task-mirror | 🟢 `fixtures/area-mappings.json` covers the locations the connector fixtures report — one of them refining a section, so the precedence is exercised — and three initiatives that serve no key result carry subtrees, dated **outside** the four-week window so the detail screen is filled without moving every suite's balance numbers | [#80](https://github.com/vchatela-org/prisme/pull/80) |
| Cycle time is drawn nowhere — prisme records no moment at which an initiative started, and reconstructing one from the event log is aggregation the API owns | W09, W10 | ⏸ **deliberate, not outstanding** — an absence a reader would otherwise re-derive | — |
| **The deployment's bootstrap runbook has no step for areas, weights or mappings**, and none for the one-time backfill — so a freshly deployed instance is configured by hand-written calls and serves an empty balance chart | found preparing the functional phase (nobody had recorded it) | 🟢 (deployment repository, and applied there) · **confirmed by measurement 2026-09-24**: the deployed instance's database holds the schema, the role bindings and a populated adoption queue, and **zero** areas, weights and mappings — so the empty balance chart is not a risk, it is the state. **Root cause found 2026-09-25, and it is wider than the runbook**: `prisme-sync areas` exists in no tag before `v0.2.0`, and no earlier tag parses `areaMappings` either — so the instance could not have been configured by command at all, and the bindings Job the runbook *does* document (`v0.0.2`) would have loaded the bindings while silently ignoring the mappings. Steps written, and the pin moved, in the deployment repository's PR #1262. **Run 2026-09-25, and running them turned up a second gap in the same section**: §6 loads prisme's own model into its database and never touches the area colour pinning, which is web-tier configuration ([`15-runtime.md`](docs/15-runtime.md) §2) — so an instance configured completely by that section still painted several areas in one hue, with no job red and nothing saying so. The step is **§6e**, written in the deployment repository's PR #1266, and **applied 2026-09-25**: the map was taken from the screen's own pure function rather than composed, written to the web tier's Vault entry with every other key still present, confirmed byte-identical in the Kubernetes Secret **by hash and never printed**, and the web tier **rolled to it** — a new ReplicaSet and pod reading that secret, on VSO's own hourly refresh rather than a hurried `kubectl patch`. Nothing on this row is left open. The measurement now reads: 10 areas, 8 year weights summing to 100, 36 mappings, 5 role bindings, 16 capacity weeks, and the screens drawn from them — area *names* never keys, a real declared-against-observed balance, and no CSP violation in the console. [The entry](docs/50-journal/FUP-2026-09-25-live-read-path-and-six-e.md) | [#90](https://github.com/vchatela-org/prisme/pull/90) |
| **Nine obligations were missing from this table**, and the file's own rule says a row here is an obligation rather than a note — eight lived in a journal entry, one in nothing at all | found reading the entries while preparing the functional phase (nobody had recorded it) | 🟢 every one of the nine is a row above | [#73](https://github.com/vchatela-org/prisme/pull/73) |
| **Nothing loads rituals** — `prisme-sync` has no `rituals` subcommand, `seed/` and `seed.example/` carry no ritual file, and `POST /rituals` (behind `write:ritual`) has **no UI caller**: `apps/web` reads `/rituals` in one place and creates none. A live instance's rituals can therefore only be set by hand-written calls — the shape [#74](https://github.com/vchatela-org/prisme/pull/74) closed for areas, weights and mappings. It is the **second precondition of the declared-duration tier**: naming `DOCTOOL_DURATION_PROPERTY` alone flips the report to *read* and still yields **zero** declared durations, because the tier joins a ritual's page to the recurring task it binds and both sides are empty — and ritual adherence is measured *over* rituals, so it is empty for the same reason | found running §7's restore rehearsal against the live instance (nobody had recorded it) | 🟡 open — needs a home, and a loader needs a seed format before it can have one · [the entry](docs/50-journal/FUP-2026-09-26-restore-rehearsal.md) | [#91](https://github.com/vchatela-org/prisme/pull/91) |
| **§7's rehearsal prints one figure, and on a fresh instance that figure is empty** — `entity_link` is the number the procedure names as the one that matters, and it is `0` until the adoption queue is worked, so the readout cannot distinguish *restored correctly* from *restored nothing*. The **deployment repository's** half is done: its Job now prints the table count and an exact per-table row count beside `entity_link` — exact counts deliberately, since `n_live_tup` reads 0 for a table nothing has queried yet — and its header no longer says §6e is unapplied. Verified by extracting the Job from the runbook and running it: 35 tables restored, 11 non-empty | found running §7 against the live instance (nobody had recorded it) | 🟢 deployment-repository PR #1273, merged · [the entry](docs/50-journal/FUP-2026-09-26-restore-rehearsal.md) | [#92](https://github.com/vchatela-org/prisme/pull/92) |
| **The planned instance reset is on no dashboard, and three open items take their timing from it** — the 2026-09-25 session recorded that the instance is *"expected to be reset before real data is loaded"*, and it lived in that entry's follow-up list alone. The **area keys** are the sharpest case: `saveAreas` matches a stored area by `key` and **never updates it**, so a key is settled the moment anything references it — and the mappings and the capacity weeks already do — which makes the reset the only cheap moment to choose them. The **restore rehearsal's meaningful run** and the **queue's first real work** follow from the same reset | found working the area-keys item (nobody had recorded it as an obligation) | 🟡 open — owner: the instance's operator · [the entry](docs/50-journal/FUP-2026-09-26-restore-rehearsal.md) | [#92](https://github.com/vchatela-org/prisme/pull/92) |
| **A follow-up that closes a recorded gap also owes the paragraph above it** — the wave updated this table and left five workstream narratives still asserting the gap in the present tense, so the page's prose and its own register disagreed for five days: W07's twelve CSP violations on the gallery, W11's missing fixture task mirror, W12's callerless `createDocToolClient`, W13's readerless `capacity_week` beside an unread document tool, and W15's *"ADR-0025 … is **Proposed, not Accepted**"* — the last describing an **Accepted** ADR as undecided, which invites a reader to re-open a question that was settled. Nothing sees this class, and the reason is structural: a register row has a PR column to check it against, and a paragraph has nothing | found answering *what decisions remain* (nobody had recorded it) | 🟢 all five corrected in place, in the past tense, each naming the pull request that closed it — and the **journal entries deliberately still say *Proposed***, because they are dated records and a journal is append-only · [the entry](docs/50-journal/FUP-2026-09-26-status-prose-vs-register.md) | [#93](https://github.com/vchatela-org/prisme/pull/93) |
| **Areas, colours, mappings and Notion bindings could only be set from a gitignored file and a CLI Job**, and nothing showed what a role or a mapping pointed at — the API had the area writes and no screen called them | the owner, asking why none of it was in the UI | 🟢 `/settings` overview and editors; migration 0011 · [the entry](docs/50-journal/FUP-2026-09-26-settings-screens.md) | [#94](https://github.com/vchatela-org/prisme/pull/94) |
| **A private repository's name was linked from this public page** — the §7 row carried its deployment-repository pull request as a full URL. The **local** deny-list caught it; CI cannot, because that supplement is gitignored by design — which is exactly why the local scan exists. The corollary is worth keeping: a green `privacy deny-list` check was never evidence that nothing private is in a diff | found by the local scan on the first commit of the row above | 🟡 **the worktree is clean and the history is not** — redacted to the prose form every other row in this file uses, but the name is still in `main`'s history ([#92](https://github.com/vchatela-org/prisme/pull/92), merged 2026-09-26). A rewrite is a force-push, which is the owner's call and not an agent's · [the entry](docs/50-journal/FUP-2026-09-26-status-prose-vs-register.md) | [#93](https://github.com/vchatela-org/prisme/pull/93) |

Detail: [`docs/50-journal/`](docs/50-journal/INDEX.md), entries prefixed **FUP**.

**A row here is an obligation, not a note.** Four of them lived only inside journal entry tables
until 2026-09-24, which is exactly the rediscovery the journal rules exist to prevent — a follow-up
inside an append-only entry explains a gap rather than holding one, and the next person reads the
dashboard first. **The two rows that were `⏳ human decision — pending` are both closed now, on
2026-09-24**: the owner decided, and each decision turned out to be a small change rather than a
large one — which is what a recorded decision usually looks like once it is made.

**The register can be silently *un*-updated, and one row was.** [#75](https://github.com/vchatela-org/prisme/pull/75)
set the `AREA_COLOR_PINS` row 🟢; then [#76](https://github.com/vchatela-org/prisme/pull/76) — whose
branch was cut **before** #75 and merged **after** — merged `main` into itself and resolved the
`STATUS.md` conflict **toward the branch**, which still carried the old row, so the 🟢 became 🟡
again with `—` in the PR column, and #76 merged green. Nothing here reads this file, so the only
tell was the shape the rules above describe: a 🟡 row naming no pull request, beside a journal entry
naming one. The correction is a one-line revert, in
[the entry](docs/50-journal/FUP-2026-09-24-register-revert.md), and the rule it leaves is for whoever
resolves the next registry conflict — take **both** sides, and re-read every row the incoming `main`
had changed, because the conflict markers disappearing is not the same as the resolution being
right. Same file, same class of failure as the count that drifted for five days.

**The sweep was not finished the first time, and the count is the evidence.** The same day, working
the open decisions and then preparing the functional phase, **eight further rows were found that
each lived in a journal entry and nowhere on this page** — the seed path, the ungenerated
`AREA_COLOR_PINS`, the unscheduled backfill, the missing `minutesCaveat` source, the deployment's
withdrawn drift alert, "not read" against a refused read, the fixtures' missing attribution rows and
the undrawn cycle time — and a **ninth that had no record anywhere at all**: the deployment's
bootstrap runbook has no step for areas, weights or mappings. Nine rows, found by reading the
entries rather than by any check, which is why the rule above is a rule and not a preference.

✅ **Two journal entries said `DOCTOOL_BASE_URL` would unblock the initiative screen's *Open page*
button, and both were wrong.** That variable is the **API host** — the one that serves JSON — and a
person cannot open a page at it. The button needs a *browser-facing* address **and** a path shape
that turns a page id into a link, and the tool's own page URL cannot supply either:
`packages/connectors/src/doc-tool` deliberately does not read it, because it identifies the
workspace. The decision was the owner's and is recorded: an operator-supplied **template**
(`DOCTOOL_PAGE_URL_TEMPLATE`, with a literal `{id}`) supplies the shape, prisme supplies the id, and
neither a vendor's URL layout nor the workspace enters the repository — one row above, and
[the entry](docs/50-journal/FUP-2026-09-24-open-page.md).

## Releases

The tag **is** the release: `publish.yml` fires on a `v*` tag, pushes both images to Harbor, and the
deployment side pins that version. Nothing is published from a push to `main`.

| Version | Cut | Contains | State |
|---|---|---|---|
| `v0.3.0` | 2026-09-25, on `66b910e` | the follow-up wave over [#84](https://github.com/vchatela-org/prisme/pull/84)–[#88](https://github.com/vchatela-org/prisme/pull/88): an Accepted ADR (0029, *a project has one area*) and the drift alert's series, and **the session that could not end** — an expired login now reaches the login flow instead of a `401` with no way out | 🟢 both images published, digests read back from Harbor. **Not yet pinned** — the deployment still runs `v0.2.0`, so the expired-session fix is not live until the pin moves ([the entry](docs/50-journal/FUP-2026-09-25-v030-and-the-session-that-could-not-end.md)) |
| `v0.2.0` | 2026-09-25, on `846743a` | the follow-up wave over [#71](https://github.com/vchatela-org/prisme/pull/71)–[#83](https://github.com/vchatela-org/prisme/pull/83), and the seed path — **the first tag that can load areas, weights and mappings at all** | 🟢 both images published, digests read back from Harbor. Pinned by the deployment in deployment-repository PR #1262 |
| `v0.1.0` | 2026-09-24, on `ddbf481` | two Accepted ADRs — the audit gate fails closed (0027) and a capture's page gets its own role pair (0028) — and the *Open page* work, over [#65](https://github.com/vchatela-org/prisme/pull/65)–[#70](https://github.com/vchatela-org/prisme/pull/70) | 🟢 both images published (the API image on a re-run — the first attempt failed on the cluster, [the entry](docs/50-journal/FUP-2026-09-24-release-v0.1.0.md)) |
| `v0.0.6` | 2026-09-23, on `52db733` | the eight-pull-request Dependabot wave (#50–#53, #46–#49) | 🟢 both images published |
| `v0.0.5` | 2026-09-22 | human login in-app over OIDC (ADR-0026) | 🟢 |
| `v0.0.1` | 2026-09-15 | the skeleton — **its images were never built**, see the W00 close-out | ⚠ names nothing |

**A pending release is an open item, and it lives here.** A `/dependabot` run never merges, so a run
that integrates the wave to green may still be unable to cut its tag; when that happens it records the
version and the one merge that unblocks it in this table — not in a journal entry alone, because an
append-only journal explains an obligation rather than holding one. `v0.0.6` was the first to need
that: green at 17:48 on 2026-09-23, merged between 18:23 and 19:04, and cut once the merges landed —
[the entry](docs/50-journal/P0-2026-09-23-dependabot-wave.md#addendum--2026-09-23--the-release-cut).

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

**28 accepted** · **1 superseded** · **0 proposed** · **5 open** — index:
[`docs/20-decisions/`](docs/20-decisions/README.md)

Open questions and what each one blocks: [`docs/20-decisions/OPEN.md`](docs/20-decisions/OPEN.md).
None blocks P0. **OQ-1 and OQ-4 closed on 2026-09-25** — the owner decided both in review, on the
evidence the read path produced against the live instance: a project has one area and multi-area work
is mapped by section ([ADR-0029](docs/20-decisions/0029-one-area-per-project.md)), and *learning by
building* is an initiative when it has an outcome you would put in a review and Run otherwise. What
is left is OQ-2, which is a calibration to take at the first real review, and four deferred by choice.

**The open count was wrong once, and nothing reads either file to notice.** Until 2026-09-24 this
line said **7** while `OPEN.md` held **8** — OQ-1, 2, 3, 4, 10 in its first section and OQ-5, 6, 7 in
the second — and it had been wrong since **2026-09-19**, the commit that recorded OQ-10 in `OPEN.md`
without moving the number (it said *22 accepted · 7 open*; the 2026-09-22 rewrite corrected the
records and carried the stale figure forward). It became **eight** that morning and **seven** the
same day, when OQ-10 was closed — the first figure this file has held that a reader can check against
`OPEN.md` in one look. All three agree now: this line, `OPEN.md`'s own header, and `README.md`'s
27 accepted · 1 superseded · 0 proposed beside the index. OQ-3 also moved *within* `OPEN.md` from
*Blocking future phases* to *Deferred by choice*, which is what its own `Blocks: nothing —
deliberately deferred` line had said since it was written, and the four deferred questions (OQ-3, 5,
6, 7) each carry a **trigger written as an observable fact** rather than a date, because "not yet" is
re-argued every time it has no end.

✅ **OQ-10 is closed** — [ADR-0027](docs/20-decisions/0027-audit-gate-fails-closed.md), **accepted by
the owner on 2026-09-24**, the day after it was written. The gate fails closed; the three outcomes —
*checked-clean*, *vulnerable*, *unchecked* — are named in the job summary so an npm outage is never
read as a CVE; `--ignore-registry-errors`, which reports an unreachable registry as a clean audit and
exits 0, is refused and controlled against. It landed **Proposed and implemented**, and the
distinction is worth keeping: an agent does not accept its own ADR, so the record waited a day while
the gate it describes was already strict — the acceptance is what makes the decision binding, not
what makes the gate work ([#66](https://github.com/vchatela-org/prisme/pull/66)). **No repository
setting changes and none is needed** — the negative controls run as steps inside the existing required
`dependency audit` check, so branch protection needs no edit, and the reasoning is the one
[FUP-2026-09-23-typecheck-tests](docs/50-journal/FUP-2026-09-23-typecheck-tests.md) recorded: a new
check *name* is a context nobody reads until a human adds it.

✅ **OQ-9 is closed** — [ADR-0026](docs/20-decisions/0026-human-auth-via-oidc.md), which **supersedes**
[ADR-0021](docs/20-decisions/0021-verified-forward-auth-assertion.md) on one point and keeps the rest
of it: humans authenticate in-app over OIDC, and the ID token is **verified** with the same verifier
against the same key set as before. What moved is where the login happens — the proxy's forward-auth
assertion could not be given a durable signing keypair (below). **W14 is unblocked**, and no open
question now blocks a workstream. OQ-2 blocks P2; the rest are deferred by choice, and OQ-1 and OQ-4
closed on 2026-09-25 (above).

✅ **The OIDC client is registered, the login is wired up in the cluster, and a real account has
completed the round trip.** The code was verified end to end against a local fake provider; the
registration on the deployment's provider, the configuration, and the removal of the forward-auth
arrangement it replaces are **done and checked against the live provider** — the authorize endpoint
accepts the exact callback with an `S256`
challenge and refuses a near-miss, and the key set went from empty to one asymmetric key, which is
the check that would have caught the arrangement this replaced
([the entry](docs/50-journal/FUP-2026-09-23-oidc-in-the-cluster.md)). The deployment repository's
half — the image pin, the forward-auth middleware removal and the callback-route deletion — merged
and applied, so both tiers run the version that logs humans in, and a browser follows the app into
the provider's sign-in form correctly scoped to this client. **The sign-in itself has since
completed, on a real account:** the callback exchanged the code, verified the ID token against the
live key set — the subject allow-list included, which nothing earlier can test — and issued the
session, after which the edge's request log shows `/` and every screen answering `200` where they
had answered `303` to `/auth/login` before
([the entry](docs/50-journal/FUP-2026-09-23-oidc-signin-completes.md)). **What is left is a human's,
and it is no longer the login:** the write freeze below, and the open decisions.

✅ **Database backups are not a prisme task** —
[ADR-0022](docs/20-decisions/0022-backups-belong-to-the-deployment-repository.md): a dump CronJob in
the GitOps deployment repository, beside its other databases. **Nothing in this repository builds,
schedules or checks a backup**, and no workstream is waiting on one. It gates a single moment, below.

## P1 — prove the read path first

The five steps of
[`docs/13-migration.md`](docs/13-migration.md#proving-the-read-path--p1s-exit-criterion).
**All of them write nothing outward**, and all of them are worth doing before the gate below is
reached: a read path that has never been run against the live instance is the one thing every check
in this repository cannot see — which is how a wrong API pin and a withdrawn API both shipped green.

**Run on 2026-09-24, locally, against the live tools** — the whole list, on an instance that had
never had any of it. What the run found is worth reading before trusting a tick:
[the entry](docs/50-journal/FUP-2026-09-24-p1-read-path.md).

- [x] Role bindings loaded (`prisme-sync bindings --from <path>`) — **without them, "not read" and
      "broken" are the same message.** Five of twelve bound, and the seven unbound are the ones the
      instance does not use
- [x] Area mappings set, and this year's weights (`prisme-sync areas --from <path>`, then
      `prisme-sync bindings --from <path>` — or `pnpm seed:load`, which runs both in that order).
      The areas and weights were **derived from the tool's own vocabulary**, which already carried
      them; the two blocks that had no home among the areas were OQ-1 in the flesh, and the owner
      closed it on 2026-09-25 — folded into the existing areas, no ninth area —
      [ADR-0029](docs/20-decisions/0029-one-area-per-project.md)
- [x] One full pass run by hand, and its report read, for **both** tools — the task tool through
      `plan`, the document tool through the adoption scan, which is the only read of it
- [x] `/focus`, `/areas` and `/kpi` opened against real data — area *names*, never keys. Driven in a
      real browser, with the console read back: one `favicon.ico` 404 and no CSP violation
- [x] Adoption queue worked and link coverage recorded — the queue is populated, readable and
      `Would create: 0`; **no candidate has been decided**, which is the owner's step and not a gap
      in the read path
- [x] `prisme-sync plan` read by hand — **`create: 0` on a clean instance**, which is ADR-0010
      guard 3 answered by measurement rather than by argument

## Before the first outward write

The one-time gate on [`docs/13-migration.md`](docs/13-migration.md#5-sequence) step 8 — lifting the
write freeze (`SYNC_WRITE_ENABLED=true`). Not enforced by code; a human owns each line.

- [ ] Backup CronJob deployed for prisme's database — **deployment repository**, ADR-0022.
      **Evidenced 2026-09-25, and deliberately still unticked**: the CronJob exists on the cluster,
      is scheduled daily in the instance's timezone, and has **three completed runs**. The tick
      itself stays a human's, which is what this section says it is
- [ ] **A restore rehearsed at least once**, not merely scheduled. **Evidenced 2026-09-26, and
      deliberately still unticked**: the deployment runbook's §7 ran against the live instance — a
      throwaway database on the same server, `pg_restore --no-owner`, the table list read back, the
      test database dropped — and **35 tables came back with eleven of them non-empty**, so the
      restore carried the judgement data (capacity weeks, area mappings, year weights, role
      bindings, completion history). The figure the procedure prints is `entity_link`, and it is
      **0** here because no adoption decision has been made yet — so the run that *counts* is the
      one **after** the queue is worked, and this tick stays a human's until then, as the backup row
      above it does ([the entry](docs/50-journal/FUP-2026-09-26-restore-rehearsal.md))
- [ ] `plan` read by hand, `create: 0` confirmed (ADR-0010 guard 3)
- [ ] Adoption queue worked; link coverage reported (W12). **Re-scanned 2026-09-26**: the queue holds
      **94 candidates** and **12 of them carry an area** across six areas. Before the re-scan none did
      — its only scan was from **2026-09-22**, three days before any area existed, so `area_key` was
      null for a reason that had nothing to do with the mappings. The scan runs under
      `prisme-sync adopt --plan` and nowhere else (the daily pass is `apply`), so the queue does **not**
      refresh itself, and that command is also the gate line below — it is the first action, not the
      last. **79 of the 94 can never be labelled**: `area_mapping`'s only location columns are
      task-tool vocabulary, so a document-tool page has no location a mapping can name, and the
      queue's own *"one area at a time"* holds for the fifteen task-tool candidates only
      ([the entry](docs/50-journal/FUP-2026-09-26-restore-rehearsal.md))
- [ ] `prisme-sync adopt --plan` **run against the live instance** and read by hand. W12 built it and
      deliberately recorded no output: the plan carries real titles and cannot enter this repository
      (`apps/sync/CLAUDE.md`). **The scan has been run (2026-09-26)** — the queue above is its result —
      but **its report was deliberately not read**, because it prints real titles; the counts came from
      the database instead. Reading the plan, confirming `Would create: 0` and agreeing with it is
      still a human's, and this tick stays theirs

**These lines have an order the list does not read in.** `prisme-sync adopt --plan` — the *last* line —
is the **first** action: it is the queue's only writer, so it is what labels the queue with areas and
produces the `Would create: 0` readout. Then the queue is worked, and that is what fills `entity_link`.
Then the restore rehearsal means something, because `entity_link` is the figure it reads. An instance
can therefore be completely configured, have run §7, and still be in the first-run state
([the entry](docs/50-journal/FUP-2026-09-26-restore-rehearsal.md)).

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
