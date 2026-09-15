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

**While working**

4. Stay inside *Files you may touch*. Other agents are working in parallel; leaving your tree causes
   merge conflicts, not just untidiness.
5. You may not contradict an Accepted ADR. If your work requires it, write a new ADR proposing the
   supersession and stop for review.

**On finishing**

6. Append `../50-journal/<id>-<date>-<slug>.md` and update its `INDEX.md`.
7. Update your row in [`../../STATUS.md`](../../STATUS.md).

**Always**

8. **Privacy.** This repository is public. Journal entries record *what was decided and why*, never
   what the data said. Never commit a real goal, project, task, weight or workspace ID — use
   [`../../fixtures/`](../../fixtures/). The riskiest moment is debugging against live data:
   [`../17-privacy.md`](../17-privacy.md).

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
