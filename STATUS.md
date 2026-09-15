# STATUS

*Where prisme is, in one screen. Updated by hand — agents update their own row on completion.*

**Last updated:** 2026-09-15 · **Current phase:** P0 **frozen** — W00 landed; wave 1 continues

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
| [W01](docs/40-workstreams/W01-domain-scoring.md) | Domain model + pluggable scoring registry | — | 1 | ⚪ | — |
| [W02](docs/40-workstreams/W02-schedule-engine.md) | Schedule & dependency engine | W01 | 2 | ⚪ | — |
| [W03](docs/40-workstreams/W03-connectors.md) | Connectors, read path | — | 1 | ⚪ | — |
| [W04](docs/40-workstreams/W04-reconciler.md) | Reconciler: plan/apply, conflicts, intent channel | W01, W03 | 2 | ⚪ | — |
| [W05](docs/40-workstreams/W05-api.md) | REST API + OpenAPI | W01, W03 | 2 | ⚪ | — |
| [W06](docs/40-workstreams/W06-mcp.md) | MCP server + dry-run write guards | W05 | 3 | ⚪ | — |
| [W07](docs/40-workstreams/W07-design-system.md) | Design system & app shell | W00 | 1 | ⚪ | — |
| [W08](docs/40-workstreams/W08-ui-focus.md) | UI: Focus, Backlog, Inbox | W05, W07 | 3 | ⚪ | — |
| [W09](docs/40-workstreams/W09-ui-areas-kpi.md) | UI: Areas, Balance, KPI dashboard | W05, W07 | 4 | ⚪ | — |
| [W10](docs/40-workstreams/W10-ui-timeline.md) | UI: Timeline / Gantt | W02, W05, W07 | 4 | ⚪ | — |
| [W11](docs/40-workstreams/W11-ui-objectives-reviews.md) | UI: Objectives, KRs, Review wizard | W05, W07 | 4 | ⚪ | — |
| [W12](docs/40-workstreams/W12-adoption.md) | Adoption queue & migration, no-duplicate guards | W03, W04 | 3 | ⚪ | — |
| [W13](docs/40-workstreams/W13-backfill.md) | History backfill → capacity actuals | W03 | 4 | ⚪ | — |
| [W14](docs/40-workstreams/W14-security.md) | Security: assertion verifier, token store, CSP, CI gates | W00 | 2 | ⚪ | — |
| [W15](docs/40-workstreams/W15-creation-flows.md) | Creation flows: capture, initiative, project | W04, W05, W07 | 5 | ⚪ | — |

⚪ not started · 🟡 in progress · 🟢 done · 🔴 blocked · **PR** is the pull request carrying the
workstream, `—` until one is open, and the one that landed it once the row is 🟢.

**Every workstream lands as a pull request on a `ws/<id>` branch, and stops only when it is green.**
The agent fills in [the template](.github/pull_request_template.md) — features, specs, every check by
name and result, privacy position, what it did not do. **A human merges**; no agent merges its own
PR. `main` is protected: a pull request is required, the checks below are required, and `enforce
admins` is on, so the bypass an agent used to have through the owner's token is gone.

Required on every PR, as of W00 (#5):

`privacy deny-list` · `gitleaks` · `internal links` · `dependency review` · `typecheck` · `lint` ·
`test` · `build` · `dependency audit` · `images` · `CodeQL (actions)` ·
`CodeQL (javascript-typescript)` · `CodeQL (python)`

`images` builds all three images, Trivy-scans them, and asserts what is only checkable on a real
container: that `prisme-api` and `prisme-sync` are the same digest, that neither runs as root, that
`/healthz` answers with an unreachable database while `/readyz` returns 503, and that a missing
required variable stops the process with the variable named. `dependency audit` is
`pnpm audit --audit-level=moderate`. Each became required from the commit that added it. W14 still
owns its own additions. Rules, and what to do at each ending:
[`docs/40-workstreams/README.md#checks`](docs/40-workstreams/README.md#checks).

Both security gates have been **watched fail** and are not taken on trust —
[the W00 entry](docs/50-journal/W00-2026-09-15-foundations.md) records how, and the two things that
surprised us while doing it.

**W00 has landed; wave 1's other three — W01, W03, W07 — are cleared to start.** Nothing they depend
on is open. W00's own follow-ups, and what is still owed before its images can be published:
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
