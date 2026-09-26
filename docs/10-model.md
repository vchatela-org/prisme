# 10 · Domain model

The entities prisme holds, what each field means, and which store owns it. Field-level ownership is
summarised exhaustively in [`11-ownership.md`](11-ownership.md); this document explains the *shape*
and the reasoning.

Terminology note: the two external systems are referred to throughout as the **document tool**
(Notion) and the **task tool** (Todoist). External databases are named by **role key**, never by
their real names — see [`17-privacy.md`](17-privacy.md).

---

## 1. Shape

```
Area  ─────────────────────────────────  the 8-ish life areas. Weights per year.
 │
 ├── Project            (optional)       a multi-month container, its own external structures
 │    └── Initiative                     THE SCORED UNIT — an outcome, 1–6 weeks
 │         └── Task                      lives in the task tool, any depth, never mirrored
 │
 └── Initiative                          initiatives may sit directly under an area

Objective ── KeyResult ──serves──► Initiative

Lanes, deliberately outside the backlog:
   Run       recurring upkeep, budgeted in hours/week
   Signals   machine-generated notifications
   Ritual    habits, measured by adherence rather than completion
```

Two shapes of work are both first-class, because both are how people actually work:

- **Small**: a parent task in an area's section of a general project — becomes an initiative with an
  anchor task there.
- **Large**: a dedicated project in the task tool with its own sections — becomes a `Project`,
  with structures created in both external tools.

## 2. Glossary

| English (code, docs) | French (instance data) | Meaning |
|---|---|---|
| Area | *département de vie* | A life domain that receives a share of capacity |
| Initiative | — | An outcome finishable in 1–6 weeks; the only scored unit |
| Objective | *objectif* | An annual or monthly goal |
| Key Result | — | A measurable component of an objective |
| Takeaway | *takeaway* | An idea extracted from something read or watched |
| Deadline | *échéance*, *date limite* | A hard external constraint |
| Due date | *date d'échéance* (task tool) | When you intend to work on something |
| Run | — | Recurring upkeep; a lane, not an area |
| Anchor | — | The task-tool task that represents an initiative or key result |

---

## 3. Area

A life domain. Stable, small in number, and the unit of capacity allocation.

| Field | Type | Owner | Notes |
|---|---|---|---|
| `key` | slug | prisme | Stable identifier. Never changes; renaming touches `name` only. |
| `name` | text | prisme | Display name |
| `kind` | enum | prisme | `area` \| `run` \| `signals` — lanes are modelled as areas with a different kind so capacity accounting is uniform |
| `external_page_id` | ref | prisme | Optional link to the narrative page in the document tool |
| `active` | bool | prisme | Archived areas keep their history |

### Weights are year-scoped

```
area_weight (area_key, year, weight_pct)     PRIMARY KEY (area_key, year)
```

A weight is **fixed for a whole calendar year**, decided at the yearly review, and read-only in the
UI in between. This is deliberate: a weight you can adjust in the moment is a weight that will be
adjusted to match whatever you already did, which defeats the purpose.

Every balance factor and every KPI computes against **the weight in force at that time**, so a chart
of last year stays correct after this year's weights land. There is no "current weight" anywhere in
the schema; asking for a weight always requires a year.

For `kind = 'run'`, the budget is expressed in **hours per week** rather than a percentage — upkeep
is naturally measured in time, and capping it is more useful than giving it a share.

### The year gate

A year with no weights does not silently inherit. Instead:

- every balance factor is marked `stale`, and the UI shows it;
- a persistent banner appears;
- the **Year Review** surface unlocks: declared versus observed per area for the year ending, trends
  across all history prisme holds, objective attainment, throughput.

Weights carry forward until you set them — loudly rather than silently. The point is to make the
annual decision unavoidable at the moment it's due, using evidence rather than memory.

### Derived

| Field | How |
|---|---|
| `actual_share` | Share of the last 4 weeks' completed work attributable to this area |
| `balance_factor` | `clamp(target_share / actual_share, 0.5, 2)` — starved areas rise, over-served ones sink |

Capacity is measured in **time where known** (task duration when set) and estimated otherwise; see
[`12-scoring.md`](12-scoring.md#4-measuring-capacity). Run and Signals are excluded from ranking but
**included in capacity accounting** — the whole point is to make upkeep's real share visible.

### Mapping to the task tool

```
area_mapping (area_key, external_project_id, external_section_id?, is_home)
```

Many-to-one: several projects and sections may map to one area. This is how several disagreeing
lists of "areas" across tools fold into one key **without restructuring anything**. Restructuring
the external tools later is optional, and does not change the model.

When prisme has to *create* something for an area — an initiative's anchor task, a capture — it goes
to the area's **home** mapping; with none marked, to the most specific mapping (a section beats a
whole project), then the first by identifier. One rule, `homeLocation` in `packages/domain`, for
both paths. Mappings, the home and an area's colour are edited on the **Settings** screen.

---

## 4. Project

An optional container for a multi-month effort. Most initiatives have no project.

| Field | Type | Owner | Notes |
|---|---|---|---|
| `name` | text | prisme | |
| `area_key` | ref | prisme | Exactly one. Work that belongs to another area is mapped at the section, not the project — [ADR-0029](20-decisions/0029-one-area-per-project.md) |
| `status` | enum | prisme | `active` \| `paused` \| `done` \| `dropped` |
| `deadline` | date? | prisme | |
| `sections[]` | ordered list | prisme | Subtopics; become sections in the task tool |
| `external_page_id` | ref | prisme | Page in the document tool, from the project template |
| `external_project_id` | ref | prisme | Dedicated project in the task tool |
| `origin` | enum | prisme | `created_in_prisme` \| `adopted` — see [`13-migration.md`](13-migration.md) |

Creating a project creates real structure in both external tools; adopting one creates nothing. The
distinction is enforced structurally, not by convention.

---

## 5. Initiative

**The only scored unit.** An outcome you could finish in one to six weeks. Anything bigger is
sliced; the slice is what gets scored.

Phrase it as a **result**, not an activity — "fence replaced", not "work on fence". An activity has
no completion condition, which is how things stay open for two years.

| Field | Type | Owner | Notes |
|---|---|---|---|
| `title` | text | prisme | A result |
| `area_key` | ref | prisme | **Exactly one.** Multi-area initiatives break capacity accounting |
| `project_id` | ref? | prisme | 0..1 |
| `status` | enum | prisme | `inbox` · `later` · `next` · `now` · `waiting` · `review` · `done` · `dropped` |
| `value` | 1·2·3·5·8·13 | prisme | Relative to the rest of the backlog, not absolute |
| `time_criticality` | 1·2·3·5·8·13 | prisme | How fast value decays |
| `risk` | 1·2·3·5·8·13 | prisme | Risk reduction or opportunity enablement |
| `size` | 1·2·3·5·8·13 | prisme | Size of the *next slice*. Above 8, slice it |
| `deadline` | date? | prisme | Hard constraints only. Written to the anchor |
| `earliest_start` | date? | prisme | Scheduling constraint |
| `planned_start` / `planned_end` | date? | prisme | Computed by the schedule engine |
| `depends_on[]` | ref[] | prisme | Other initiatives. DAG — cycles rejected at write time |
| `external_page_id` | ref? | prisme | Optional narrative page, created on demand |
| `external_anchor_id` | ref? | prisme | The anchor task |
| `origin` | enum | prisme | `created_in_prisme` \| `adopted` |
| `done_at`, `dropped_reason` | | prisme | |

Fibonacci rather than 1–4: the old scale produced 11 distinct values for 16 combinations, so ties
were everywhere and the ranking carried almost no information.

### Derived

`cod` (cost of delay) · `score` (from the active scoring method) · `age` · `staleness` ·
`deadline_at_risk` · `progress` · `open_task_count` · `last_activity`.

Never store a score as a column on the initiative — see [`12-scoring.md`](12-scoring.md).

### The anchor

Each initiative with status `next` or beyond has exactly one **anchor task** in the task tool,
labelled to mark it. prisme writes the anchor's title, priority, deadline and a backlink. Subtasks
hang beneath it at any depth and are entirely yours — prisme **counts** them and never copies them.

Not mirroring subtasks is the central design decision on this side. Mirroring is what every
off-the-shelf sync product does, and it leaves you maintaining two task lists.

### Ready for `now`

An initiative may only enter `now` when: the outcome is one sentence, `size ≤ 8`, the first three
next actions are known, nothing blocks it, and it has a target month.

---

## 6. Task

**Owned entirely by the task tool.** prisme mirrors the anchor's subtree read-only and derives
progress, open count, last activity, cycle time, and per-area capacity actuals.

prisme writes back **only**: the anchor's priority, deadline, backlink and label — plus inherited
priority on subtasks, never overriding a priority set by hand (tracked via last-applied values).

Priority mapping — top-3 `now` → highest, rest of `now` → high, `next` anchors → medium, everything
else → lowest. Priority flags are typically unused in practice, which is exactly why they can become
the one meaningful signal.

### Due versus deadline

| Field | Meaning | Owner |
|---|---|---|
| `deadline` | Hard constraint | **prisme** → written to anchors |
| `due` | When I intend to work on it | **You, in the task tool.** prisme never writes it |

prisme reads `due` back only to measure planned-versus-done, detect an overloaded week, and drive
the weekly review. The two fields never fight because they are never owned by the same side.

---

## 7. Objective and Key Result

Objectives are authored **in prisme** and synchronised outward. They were historically written in
the document tool only because that was the only option — and from there they can never reach the
task tool, which is why they stay invisible.

### Objective

| Field | Owner | Notes |
|---|---|---|
| `title`, `type` (`annual` \| `monthly`), `period`, `area_key`, `status` | prisme | |
| `narrative` | document tool | The prose: why, reflections, review notes |
| `external_page_id` | prisme | Link to that page |

### Key Result

First-class, not a bullet inside a document.

| Field | Owner | Notes |
|---|---|---|
| `statement`, `target`, `unit` | prisme | |
| `progress_self` | prisme | **0–100, set by hand, by judgement.** The primary measure |
| `measurements[]` | prisme | Append-only time series, so trends exist |
| `external_anchor_id` | prisme | Anchor task, so subtasks can hang beneath it |

**Every key result gets an anchor task.** This is the capability that was missing: a key result you
can break into subtasks is a key result that gets worked on. A key result that is a *habit* rather
than an outcome becomes a `Ritual` instead — it needs a recurring slot, not a task.

### Progress is self-assessed, and the gap is the signal

`progress_self` is primary and is what syncs outward. `progress_computed` (tasks done ÷ total) is
shown beside it and **never** written back.

The divergence between them is more informative than either alone:

| Pattern | Reading |
|---|---|
| self ≪ computed | The tasks were the wrong tasks — activity without progress |
| self ≫ computed | Progress came from outside the tracked work, or the breakdown is stale |
| both low, late in period | The objective is at risk, honestly |

Automating this number would destroy the signal. A count of closed tasks is not an achievement.

---

## 8. Takeaway — the reading pipeline

```
Media  ──►  Takeaway  ──(if actionable, on promotion)──►  Initiative
```

The document tool owns both the media library and the takeaways. prisme mirrors them and applies one
rule:

| Takeaway kind | Treatment |
|---|---|
| **Principle** (*conseil*) | Never enters the backlog. Surfaces as context during review of its area |
| **Action** | A *candidate* initiative. Lands in prisme's Inbox for promotion |

Takeaways are **not scored** in the document tool. Scoring there decays — a formula on a database
nobody re-scores produces a "missing score" view that grows forever. Only promoted initiatives carry
a score, in prisme, where it is recomputed on every run.

Promotion creates an initiative linked back to the takeaway. It does not copy the takeaway's text,
and does not delete or modify it.

---

## 9. Lanes: Run, Signals, Ritual

Keeping these out of the ranked backlog is what stops the backlog from being noise.

### Run — recurring upkeep

Budgeted in **hours per week**, not a percentage. Actuals are derived by joining the two tools: a
recurring task in the task tool maps to a **process page** in the document tool, which carries a
declared duration and frequency. Completions × declared duration = weekly Run hours.

The document tool **owns process pages outright**; prisme reads duration and frequency and writes
nothing there. Process pages serve a far wider purpose than prioritization — they are written
procedures, including the review rituals prisme itself follows. prisme has no authority over them,
and read-only access narrows the integration's blast radius ([`14-threat-model.md`](14-threat-model.md)).

### Signals — machine-generated notifications

Home automation alerts, monitoring, scheduled digests. They belong in a dedicated project, are
excluded from ranking and from capacity, and are cleared in batches. They are counted only as noise
volume.

### Ritual — habits

The task tool owns the recurring task; the document tool keeps the narrative; **prisme owns the
adherence time series**. A habit is measured by adherence over time, not by task completion — which
is precisely the metric that reveals a stated goal quietly sitting near zero.

---

## 10. Review, event log, reconciliation state

### Review session
Cadence, date, checklist state, decisions taken, what moved, notes, and a KPI snapshot at that
moment. The narrative summary is written back to the document tool's review databases so that
history stays continuous with what came before prisme.

### Cadences, and where each step happens

P0 does not exit until every step of the weekly and monthly rituals lands on a surface that exists
and entities that are modelled — **nothing left over, nothing invented at build time**. That check is
this table. It is about *shape*: the concrete checklist is instance data and stays in the document
tool ([`17-privacy.md`](17-privacy.md)); what is frozen here is that each kind of step has a home.

**Weekly** — keep the `now` set honest for the coming week.

| Step | Surface | Entities it reads or writes |
|---|---|---|
| Triage what arrived | `/inbox` | `Takeaway`, `Initiative` in `inbox` |
| Confirm what finished | `/review/weekly` | `Initiative.status` `review` → `done`; anchor completion arrives from **T** |
| Check the `now` set for staleness and blockers | `/` (Focus) | `Initiative`, `last_activity` ∂ |
| Clear the conflict ledger | `/review/weekly` | Conflict ledger ([`16-sync.md`](16-sync.md#4-conflicts)) |
| Look ahead at deadlines | `/`, `/timeline` | `Initiative.deadline` |
| Re-score what changed | `/backlog` | Scoring factors; a new append-only `Score` row |
| Refill free `now` slots | `/backlog` | `Initiative.status`, per-area caps ([`12-scoring.md`](12-scoring.md#5-selecting-the-now-set)) |
| Record decisions, push the narrative | `/review/weekly` | `Review session`, event log |

**Monthly** — allocation and objectives, deliberately *not* the week's work.

| Step | Surface | Entities it reads or writes |
|---|---|---|
| Declared versus observed capacity | `/areas` | `area_weight(area, year)`, `actual_share` ∂, `balance_factor` ∂ |
| Lane check: Run hours, Signals volume, Ritual adherence | `/kpi`, `/areas/[key]` | `Run`, `Signals`, `Ritual` adherence ∂ |
| Set objective progress | `/objectives/[id]` | `progress_self` beside `progress_computed` ∂, `measurements[]` |
| Find orphans, both directions | `/objectives` | `Objective` ↔ `Initiative` links |
| Author next month's objectives | `/objectives` | `Objective` with `type = monthly` |
| Replan what slipped | `/timeline` | `planned_start`/`planned_end` ∂, `depends_on[]` |
| Record decisions, push the narrative | `/review/monthly` | `Review session`, KPI snapshot, event log |

**Quarterly and yearly** add no new step shapes: quarterly is the monthly set over a longer period,
and yearly adds exactly one surface — `/review/year`, which is the only place `area_weight` is
writable (§ *The year gate*).

Two things are deliberately **not** ritual steps. The adoption queue (`/adoption`) is one-time
migration work, not a recurring review. And no ritual step writes a `due` date — planning the week
into days happens in the task tool, which owns that field
([`11-ownership.md`](11-ownership.md#5-task)).

### Event log
**Append-only. prisme only.** Every score change, status transition, weight change, completion and
sync action, with actor and before/after.

It is load-bearing three times over: KPIs and trends are impossible without it, replanning needs to
know what changed, and it doubles as the security audit trail
([`14-threat-model.md`](14-threat-model.md)).

### Reconciliation state
Incremental sync token, change watermark, per-field last-applied values, and the conflict ledger —
all in PostgreSQL rather than on a volume, so replicas are interchangeable and a restart loses
nothing. Details in [`16-sync.md`](16-sync.md).

---

## 11. External references and provenance

Every entity that maps outward carries:

```
external_refs {
  page_id?          -- document tool
  project_id?       -- task tool
  section_id?       -- task tool
  task_id?          -- task tool
}
origin  =  created_in_prisme | adopted
```

Both are load-bearing for the **no-duplicate guarantee**: each reference is unique across the
database, and an entity whose `origin` is `adopted` is structurally incapable of producing a
"create" action. Full mechanism in [`13-migration.md`](13-migration.md).

---

## Open questions

The ones that touch the model. [`20-decisions/OPEN.md`](20-decisions/OPEN.md) is the authoritative
list and holds the numbering — cite it, do not renumber from here.

| # | Question | Blocks |
|---|---|---|
| OQ-2 | WIP limits: one `now` per area, five overall? | `now`-set selection (P2) |
| OQ-7 | Should prisme write observed duration back to process pages? | Nothing — deferred enhancement |
