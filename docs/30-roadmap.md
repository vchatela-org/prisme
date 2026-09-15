# 30 · Roadmap

Phases are **sequenced, not scheduled**. Each has an exit criterion stated as an observable fact,
not a list of completed tasks — "the feature is built" is not evidence that it works.

Current state: [`../STATUS.md`](../STATUS.md).

---

## P0 · Model and specification

**Deliver:** this documentation set, the ADRs, the workstream briefs, the synthetic fixtures, and
the privacy machinery.

**Exit:** the model is reviewed and frozen. Every field in
[`11-ownership.md`](11-ownership.md) has exactly one owner. Both the weekly and monthly review
rituals map onto surfaces and entities with nothing left over.

**Why first:** the previous attempt at this system failed on an ambiguous model, not on code. Code
written against an unfrozen model is code written twice.

## P1 · Foundations and read-only ingest

**Deliver:** monorepo, CI, images, database, migrations. Connectors reading both tools. The domain
and scoring packages. Focus and Areas surfaces.

**Exit:** prisme answers *"what should I work on now?"* from real data, **while writing nothing
outward.** The declared-versus-observed capacity chart renders for a real four-week window.

**Why read-only:** the model gets validated against reality at zero risk. If the ranking is wrong,
it is a display bug and not a corrupted backlog.

## P2 · Initiative ownership and write-back

**Deliver:** the reconciler. Anchors created and maintained, priority and deadline written outward,
progress rolled back up, the intent channel, the conflict ledger, the adoption queue.

**Exit:** one full week of reviews with no manual copying and an empty conflict ledger. Prior sync
automations turned off, one at a time, with no drift after each.

**Gate:** `SYNC_WRITE_ENABLED` is not turned on until a human has read a `plan` showing `create: 0`.

## P3 · Reviews in the application

**Deliver:** the weekly review first, then monthly, quarterly, yearly. Checklist state, decisions,
what moved, and the narrative pushed back to the document tool.

**Exit:** a weekly review runs entirely in prisme, inside its time budget, and produces a written
artefact without retyping anything.

**Why this early:** the review is where decisions actually get made. Automation only removes the
copying — if the ritual does not work, better data will not save it.

## P4 · KPI and history

**Deliver:** the event log put to work. Balance over time, throughput, cycle time, aging work in
progress, deadline health, objective attainment, reading-to-action conversion, ritual adherence, Run
hours against budget.

**Exit:** a KPI changes at least one `now` decision within a month. If nothing ever changes, the
metrics are decoration and should be cut rather than extended.

## P5 · Timeline and dependencies

**Deliver:** the schedule engine and the Gantt surface. Dependency edges, critical path, deadline
markers, drag with downstream propagation and conflict warnings.

**Exit:** moving one initiative correctly replans its dependents, and a deadline made impossible by
the move is flagged rather than silently violated.

## P6 · MCP and API hardening

**Deliver:** the full MCP tool surface, dry-run write guards, scoped tokens, rate limiting, the
OpenAPI description.

**Exit:** an agent runs a weekly review end to end — reads state, proposes changes, and applies only
what was explicitly confirmed.

## P7 · Objectives and outward reporting

**Deliver:** OKR authoring in prisme, key-result anchors, self-assessed progress, write-back to the
document tool's reporting views.

**Exit:** a year's objectives are authored in prisme and reported in the document tool without
double entry, and every key result that needs subtasks has an anchor carrying them.

## P8 · Lanes

**Deliver:** the readings pipeline (media → takeaway → promotion), Rituals with adherence tracking,
Signals separation, Run hours against budget.

**Exit:** the ranked backlog contains only initiatives, and each lane has a number attached to it.

## P9 · Capture and reach

**Deliver:** fast capture, progressive web app, notifications, the quick-add flows.

**Exit:** capture from a phone in under ten seconds, without deciding anything at capture time.

---

## Scheduling the agents

Parallel-safe means **different directories**. Run each workstream in its own git worktree and merge
per workstream.

| Wave | In parallel | Why safe | Gate to the next wave |
|---|---|---|---|
| **1** | W00, W01, W03, W07 | Four disjoint trees; W01 and W03 are leaf packages | W00 green in CI; W01 and W03 exporting stable types |
| **2** | W02, W04, W05, W14 | W14 lands *with* the foundations, not after | API contract frozen; `plan` runs clean against real data |
| **3** | W06, W08, W12 | One API directory, two web areas that do not overlap | First real dry-run shows **`create: 0`** |
| **4** | W09, W10, W11, W13 | All in `apps/web` — **serialize, or split by route group** | — |
| **5** | W15 | Touches web and connectors that wave 4 has just changed | — |

### Coordinator notes

- **Wave 4 is the one that will conflict.** Four agents in `apps/web` will collide. Either run them
  one at a time, or give each a disjoint route group over an already-merged `packages/ui`.
- **W01 and W02 deserve the most capable model.** They are pure functions with no I/O — cheapest to
  run, easiest to verify, and everything downstream is wrong if they are wrong.
- **W12 is the highest-risk workstream**: it is the one that touches real data. Keep it `plan`-only
  until a human has read a plan end to end.
- **W03 and W13 are mechanical** — I/O-heavy, well-specified, little judgement. Good candidates for
  a cheaper model.
- **W14 is not a phase.** It lands with W00 and is re-checked whenever a workstream adds an
  endpoint, a tool or a connector.

### Dependency graph

```
W00 ─┬─► W07 ─┬─────────────► W08, W09, W10, W11 ──► W15
     └─► W14  │
              │
W01 ─┬─► W02 ─┴─► W10
     ├─► W04 ──► W12 ──► W15
     └─► W05 ─┬─► W06
W03 ─┬────────┘
     ├─► W04
     └─► W13
```

## Not scheduled

Recorded so they are not mistaken for oversights: calendar integration for ritual blocks · a second
scoring method · webhook hints to shorten sync latency · restructuring the external tools' project
layout · a planning brief generated by an agent. Each is in
[`20-decisions/OPEN.md`](20-decisions/OPEN.md) or noted as a candidate in
[`12-scoring.md`](12-scoring.md).
