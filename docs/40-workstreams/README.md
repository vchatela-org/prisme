# Workstreams

A workstream is **one unit of work with one owner**. Each brief is the complete contract for the
agent or person taking it on: what to build, what not to build, what it must export, and how anyone
can tell it is finished.

Sequencing, parallelism and which wave will conflict:
[`../30-roadmap.md#scheduling-the-agents`](../30-roadmap.md#scheduling-the-agents).
Current state: [`../../STATUS.md`](../../STATUS.md).

## Index

| # | Workstream | Depends on | Wave |
|---|---|---|---|
| [W00](W00-foundations.md) | Foundations | — | 1 |
| [W01](W01-domain-scoring.md) | Domain model + scoring registry | — | 1 |
| [W02](W02-schedule-engine.md) | Schedule & dependency engine | W01 | 2 |
| [W03](W03-connectors.md) | Connectors, read path | — | 1 |
| [W04](W04-reconciler.md) | Reconciler | W01, W03 | 2 |
| [W05](W05-api.md) | REST API | W01, W03 | 2 |
| [W06](W06-mcp.md) | MCP server | W05 | 3 |
| [W07](W07-design-system.md) | Design system & app shell | W00 | 1 |
| [W08](W08-ui-focus.md) | UI: Focus, Backlog, Inbox | W05, W07 | 3 |
| [W09](W09-ui-areas-kpi.md) | UI: Areas & KPI | W05, W07 | 4 |
| [W10](W10-ui-timeline.md) | UI: Timeline / Gantt | W02, W05, W07 | 4 |
| [W11](W11-ui-objectives-reviews.md) | UI: Objectives & Reviews | W05, W07 | 4 |
| [W12](W12-adoption.md) | Adoption queue & migration | W03, W04 | 3 |
| [W13](W13-backfill.md) | History backfill | W03 | 4 |
| [W14](W14-security.md) | Security & auth | W00 | 2 |
| [W15](W15-creation-flows.md) | Creation flows | W04, W05, W07 | 5 |

## Rules for every workstream

**Before starting**

1. Read [`../../CLAUDE.md`](../../CLAUDE.md), then this brief, then
   [`../50-journal/INDEX.md`](../50-journal/INDEX.md).
2. Read the specs your brief cites. Do not re-derive a decision that has an ADR.
3. If an open question in [`../20-decisions/OPEN.md`](../20-decisions/OPEN.md) blocks you, stop and
   say so. Do not guess — an undocumented guess is indistinguishable from a decision until it causes
   a bug.

4. **Cut your branch before you write anything.** From an up-to-date `main`:
   `git switch -c ws/<id>` (lowercase workstream id, e.g. `ws/w01-domain`). Never commit to `main` —
   branch protection refuses it, and a workstream's work is not reviewed until it is a pull request.
   For a change that is not a workstream (a doc fix, a CI tweak, an ADR), use `<type>/<slug>`:
   `docs/…`, `ci/…`, `fix/…`.

**While working**

5. Stay inside *Files you may touch*. Other agents are working in parallel; leaving your tree causes
   merge conflicts, not just untidiness.
6. You may not contradict an Accepted ADR. If your work requires it, write a new ADR proposing the
   supersession and stop for review.
7. Commit as you go. A branch is a working record, not a presentation — small commits with real
   messages beat one large commit written at the end from memory.

**On finishing — on your branch, before you open the PR**

8. Append `../50-journal/<id>-<date>-<slug>.md` and update its `INDEX.md`.
9. Update your row in [`../../STATUS.md`](../../STATUS.md), including the **PR** column.
10. Open a pull request and get it green. See [Pull requests](#pull-requests) below.

**Always**

11. **Privacy.** This repository is public. Journal entries record *what was decided and why*, never
    what the data said. Never commit a real goal, project, task, weight or workspace ID — use
    [`../../fixtures/`](../../fixtures/). The riskiest moment is debugging against live data:
    [`../17-privacy.md`](../17-privacy.md).

## Pull requests

Every piece of work reaches `main` as a pull request. There is no other route.

**Open it early.** A draft PR as soon as the shape is clear is worth more than a perfect one at the
end: it makes the work visible, and it starts the checks running against a small diff rather than a
large one. Mark it ready for review when it is complete.

| | |
|---|---|
| **Branch** | `ws/<id>` for a workstream, `<type>/<slug>` otherwise — cut from up-to-date `main` |
| **Title** | `Wnn: what changed` — e.g. `W01: domain model and scoring registry` |
| **Base** | `main` |
| **Body** | [the template](../../.github/pull_request_template.md), filled in **in full** |
| **Merge** | **the human merges.** An agent never merges its own pull request |

The body is the point. A reviewer should be able to decide whether to merge *from the description
alone* — what changed, what it does, which specs it honours, what it deliberately did not do, and
what the checks said. "Implements the brief" is not a description.

State the **checks** explicitly, by name and result, including any you ran locally. If you ran
nothing, say so; that is a finding, not a gap to hide.

State the **privacy** position: that the change contains fixture data only, and that the deny-list
and secret scans are green. This is a sentence a reviewer should never have to take on faith.

## Checks

"All checks pass" means **every status check on the pull request is green**, including the ones the
repository grows over time. The set is not fixed, the rule is:

- **Today** — `privacy deny-list`, `gitleaks`, `internal links`, `dependency review`, and whatever
  CodeQL reports. That is a thin set, because W00 has not yet landed a manifest. Wave 1 is working
  with it; do not read its thinness as permission to skip it.
- **Once W00 and W14 land** — typecheck, lint, test, build, `npm audit`, Trivy, CodeQL over
  `javascript-typescript`. From the commit that adds them, they are required. A later workstream is
  held to a stricter bar than an earlier one; that is the intent, not an oversight.

**Run the local equivalent before you push.** `./scripts/privacy-scan.sh`, and `pnpm typecheck lint
test build` once W00 defines them. A check that only ever runs in CI is a check you will push twice
for, and CI is where the wait is.

**Never weaken a check to get green.** Do not delete an assertion, relax a lint rule, add a
`// eslint-disable`, skip a test, or narrow a workflow's `paths:` because it went red. A gate that
was relaxed to pass is worse than a red one: it is a failure that looks like a success, and the next
person reads it as one. If a check is genuinely wrong, fix the check — in its own pull request, with
the reasoning in the body.

### Where you stop

| Situation | What you do |
|---|---|
| **Every check green** | Comment the PR URL, stop. The human merges. Do not merge it yourself |
| **Your work would contradict an Accepted ADR** | Stop, write the superseding ADR, raise it. Do not implement against a decided ADR |
| **Anything else is red** | Keep going. Fix it, push, watch the checks again |
| **A check is red for a reason that is not yours** | Say so explicitly in the PR body and your journal, and raise it. Never disable the gate — but do not loop silently against a runner outage either |

There is no "stopped, checks failing" ending. A failing test, a broken anchor, a deny-list hit, a
missing dependency, a type error: each is yours, and the workstream is not finished until it is
green.

## Brief format

```markdown
# Wnn · Title
**Depends on** · **Wave** · **Files you may touch**
## Why            what this exists for, in two sentences
## Read first     the specs that constrain it
## Scope          numbered, checkable
## Out of scope   explicitly, with who owns it instead
## Contract       what it exports; the interface others build against
## Definition of done   observable facts, not completed activities
## Notes          traps specific to this workstream
```
