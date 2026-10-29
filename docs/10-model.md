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
| `external_page_id` | ref | prisme | Optional. The area's own page — an entry of the Life areas store, picked on Settings → Areas. A document-tool entry whose store's area column relates it to exactly this page belongs to this area ([ADR-0033](20-decisions/0033-a-store-area-column-names-an-entry-area.md)) |
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
[`12-scoring.md`](12-scoring.md#4-measuring-capacity). Run is excluded from ranking but **included in
capacity accounting** — the whole point is to make upkeep's real share visible. Signals are excluded
from both and counted only as volume ([ADR-0014](20-decisions/0014-lanes-outside-the-backlog.md), §9),
and a task wearing the Signals lane label is a signal wherever it sits
([ADR-0041](20-decisions/0041-a-label-can-put-a-task-in-the-signals-lane.md)).

### Mapping to the task tool

```
area_mapping (area_key, external_project_id, external_section_id?, is_home)
```

Many-to-one: several projects and sections may map to one area. This is how several disagreeing
lists of "areas" across tools fold into one key **without restructuring anything**. Restructuring
the external tools later is optional, and does not change the model.

A completion is attributed section first, then project. A project mapped **only by section** leaves
a task at its root — in no section — in no area, and the share leaves it out. Areas lists what was
counted toward no area over its window (`GET /areas/unattributed`), and offers *map the rest of this
project to…*: a mapping of the project itself, which the mapped sections still outrank (S9).

`area_mapping` is the task tool's vocabulary only. A **document-tool** entry is placed in an area by
its store's *area column* — a relation to the Life areas store, chosen per store on Settings →
Notion — resolved against each area's `external_page_id`: exactly one related page that is exactly
one area's page names that area, and anything else names none
([ADR-0033](20-decisions/0033-a-store-area-column-names-an-entry-area.md)).

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
| `status` | enum | prisme | `active` \| `paused` \| `done` \| `dropped`. Only an active project's initiatives are selected or ranked ([ADR-0035](20-decisions/0035-only-what-is-under-way-is-prioritized-or-measured.md)) |
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

**An open initiative that looks like a key result says so.** A deadline more than six weeks after
the day it can start (today, or a later `earliest_start`), or a title that normalises to an open
objective's in the same area, is the usual sign of a goal brought in as a task. Both are computed
by `keyResultHints` in `packages/domain`, shown on the Inbox and the initiative's page, and change
nothing — no score, no slot, no status.

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
| `estimated` | bool | prisme | `false` while the four estimates are the placeholder adoption or a capture wrote (the middle of the scale, 3); `true` once any is written, the same value included (S5) |
| `deadline` | date? | prisme | Hard constraints only. Written to the anchor |
| `earliest_start` | date? | prisme | Scheduling constraint. Before it, the initiative is not under way: neither selected nor ranked ([ADR-0035](20-decisions/0035-only-what-is-under-way-is-prioritized-or-measured.md)) |
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
labelled to mark it. "Beyond" is the way forward through the lifecycle: an initiative that reaches
`review`, `done` or `dropped` **without** an anchor — a capture dropped at triage — never gets one,
and one that had an anchor keeps it. prisme writes the anchor's title, priority, deadline and a backlink. Subtasks
hang beneath it at any depth and are entirely yours — prisme **counts** them and never copies them.

Not mirroring subtasks is the central design decision on this side. Mirroring is what every
off-the-shelf sync product does, and it leaves you maintaining two task lists.

### Ready for `now`

An initiative may only enter `now` when: the outcome is one sentence, it has been **estimated**,
`size ≤ 8`, the first three next actions are known, nothing blocks it, and it has a target month.
A placeholder size passes `size ≤ 8` by construction, so an unestimated initiative is held out of
the selection (`unestimated`) until somebody estimates it — which is triage's job.

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
task tool, which is why they stay invisible. Those already written there are **adopted** from their pages, which
stay their narrative ([`13-migration.md` §4](13-migration.md#what-becomes-what)). A linked page's date
column is written from the objective's period, and an open objective's period can move
([ADR-0034](20-decisions/0034-an-open-objective-moves-and-its-page-follows.md)).

**Work serves key results, never an objective directly.** An initiative is linked to a key result
(`served_by`), and the objective is served through its key results. So an objective with **no key
result cannot be served at all** — an objective adopted from a page always arrives that way — and
it stays an orphan until one is written. That is the rule, not a gap: an objective nothing can
measure is a wish. The objective's page and the monthly *find orphans* step say so, and link to its
*Add a key result* (S6).

### Objective

| Field | Owner | Notes |
|---|---|---|
| `title`, `type` (`annual` \| `monthly`), `period`, `area_key`, `status` | prisme | The status follows the window: see below |
| `narrative` | document tool | The prose: why, reflections, review notes |
| `external_page_id` | prisme | Link to that page |

**An objective follows its window** ([ADR-0037](20-decisions/0037-an-objective-follows-its-window.md)).
A `draft` becomes `active` on the first day of its period, and an `active` objective whose period
has not started goes back to `draft`. After the period there is a **review window**, until 31
January for an annual objective and seven days for a monthly one, in which it stays `active` and is
judged `met` or `missed` by hand. An objective still open when that window ends becomes `missed`,
with the reason recorded in the event log. A judged objective never moves. Each pass applies this
first, and it writes only prisme's own table.

### Key Result

First-class, not a bullet inside a document.

| Field | Owner | Notes |
|---|---|---|
| `statement`, `target`, `unit` | prisme | |
| `sub_objective` | prisme | Optional free text: the sub-objective it is grouped under (`O1 : …`). Groups key results; places a new one's task ([ADR-0039](20-decisions/0039-a-key-result-may-sit-under-a-sub-objective.md)) |
| `progress_self` | prisme | **0–100, set by hand, by judgement.** The primary measure |
| `measurements[]` | prisme | Append-only time series, so trends exist |
| `external_anchor_id` | prisme | Anchor task, so subtasks can hang beneath it |

**Every key result gets an anchor task** ([ADR-0012](20-decisions/0012-key-results-first-class.md)).
This is the capability that was missing: a key result you can break into subtasks is a key result
that gets worked on. The reconciler gives one to every key result of an objective **under way** —
`active`, its period started (ADR-0035) — in one of four ways:

- **bound** — it already holds a task: an initiative **converted** into it moved its task there, or
  an earlier pass made or linked one;
- **linked** — a task was linked to it from the adoption queue (*Link as key result*, S1): the pass
  binds it and creates nothing;
- **found** — its objective holds a task of its own ([ADR-0038](20-decisions/0038-an-objective-holds-its-task.md))
  and one task **anywhere in its subtree** reads as the key result's statement once inline markup
  (bold, links) is set aside: the pass binds it and creates nothing
  ([ADR-0039](20-decisions/0039-a-key-result-may-sit-under-a-sub-objective.md)). A task that is only
  close is a `review`, never a guess;
- **created** — none of those: the pass creates the task beneath the objective task's subtask that
  reads as the key result's **sub-objective**, or beneath the objective's task, and the create
  threshold counts it. An objective that holds no task gets none made for its key results.

Two cases are never created ([ADR-0039](20-decisions/0039-a-key-result-may-sit-under-a-sub-objective.md)):
**finished work** — a key result at `progress_self` 100 gets no task, as a finished initiative gets
no anchor — and **a subtree that already holds key results by hand**: when it holds a free task
shaped like one (`KR1 : …`) and none reads as this statement, the line is a `review` asking for a
rename, because a create would put a copy beside the one meant.

**An objective can hold its own task.** One task per objective, worked on all period with its key
results beneath it, is a common way to keep objectives in the task tool. An initiative whose task
carries exactly an open objective's title in its area is that task, and each pass gives it to the
objective: the initiative is dropped with the reason, and the task leaves the slots, the ranking and
the Inbox. prisme then owns the task's deadline (the period's last day), the `prisme:objective` label
and the backlink line, and leaves its title, priority and place to the owner.

prisme then owns the task's **title** (the statement), its **deadline** (the last day of the
objective's period), the **key-result label** (`prisme:kr` — never the anchor label, which would ask
for an initiative) and the backlink line. Not its priority — a key result is not ranked — and not
where it lives once it exists. A managed field edited in the task tool is a `review` line, never
overwritten: change the key result on Objectives, or put the task back. A draft, closed or future
objective's key results get nothing. Computed progress still comes from the initiatives serving the
key result; its anchor's subtasks are the task tool's
([`19-how-it-works.md`](19-how-it-works.md) S15). A key result that is a *habit* rather than an
outcome becomes a `Ritual` instead — it needs a recurring slot, not a task.

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

The mirror is filled by the adoption scan from the takeaways store: a takeaway's kind comes from the
select property named in `DOCTOOL_TAKEAWAY_TYPE_PROPERTY` (a value starting *action*, or *principle* /
*principe*). An untyped takeaway is neither and is not mirrored — guessing would risk a principle in
the backlog. A takeaway gone from the store leaves the mirror unless it was promoted. Its area is the
document tool's too: read from the store's area column on every scan, and cleared when the relation
stops naming exactly one area ([ADR-0033](20-decisions/0033-a-store-area-column-names-an-entry-area.md)).

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

Home automation alerts, monitoring, scheduled digests. They are excluded from ranking and from
capacity, cleared in batches, and counted only as noise volume.

A task reaches the Signals lane in one of two ways. It can **sit there**: a project or section
mapped to the lane, like any area. Or it can **carry the lane label**: the one task-tool label chosen
on Settings, which puts the task in the named Signals lane wherever it sits
([ADR-0041](20-decisions/0041-a-label-can-put-a-task-in-the-signals-lane.md)). The second way exists
because automations write into the section of the area they are about, and a location cannot say
what made a task. The label beats the location for Signals only. With no label chosen, location
decides everything.

### Ritual — habits

The task tool owns the recurring task; the document tool keeps the narrative; **prisme owns the
adherence time series**. A habit is measured by adherence over time, not by task completion — which
is precisely the metric that reveals a stated goal quietly sitting near zero.

A ritual's cadence is one of `daily`, `weekly`, `monthly`, `quarterly` or `yearly`. An adherence
period is the ISO week (Monday), the calendar month, quarter or year that starts on `period_start`;
a daily habit has seven opportunities in its week, every other cadence one (`ritualPeriodOf`).

A ritual is measured from **exactly one source** (`ritualMeasure`):

- **its recurring task** — at most one, bound in `entity_external_ref` and chosen on Rituals or by
  *Link*; its completions are the series, rewritten by the capacity refresh;
- **its review** — `ritual.fulfilled_by_review`: closing a review session of the ritual's own
  cadence is the period's completion. The series is rebuilt whole from the closed sessions of that
  cadence each time one closes (`reviewAdherence`): from the period of the first close, a period
  with no close reading as a zero, and the current period appearing only once it is done. A daily
  ritual cannot be fulfilled by a review — none comes round every day;
- **by hand** — a habit that is neither is recorded period by period.

The sources never mix. A ritual with a task cannot be fulfilled by its review, one fulfilled by its
review cannot take a task by *Link*, and either refuses a period recorded by hand, because its
periods are rewritten from where they come from.

---

## 10. Review, event log, reconciliation state

### Review session
Cadence, date, checklist state, decisions taken, what moved, notes, and a KPI snapshot at that
moment. The narrative belongs to the document tool, so that history stays continuous with what came
before prisme: a session **links the page it was written in** (`external_page_id`, a reference set
before or after the close), and its summary — the generated artefact: decisions, what was and was
not covered, the snapshot — is copied into that page from the session. prisme writes nothing to the
page. Pushing the summary into the reviews store on close (`reviews_db`, write-only) is intended and
not built: a page body prisme writes is outside what the creating path does today (ADR-0030), and
needs its own decision first.

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

### Audit of outward writes
**One row per call prisme makes to the document tool or the task tool, failures included — kept for
a window, then deleted** ([ADR-0031](20-decisions/0031-outward-writes-are-audited-and-pruned.md)).
Tool, operation, which half of the sync made it, the entity it was made for, the external object,
what was sent, the outcome and — for a failure — its kind. The rows are immutable; the daily full
pass deletes those older than the retention window chosen in **Settings** (default 90 days, 7 to
3650). It is **not** the event log, which is never pruned: this is the record of *calls*, the event
log the record of *effects*. Read on `/audit`.

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
| OQ-7 | Should prisme write observed duration back to process pages? | Nothing — deferred enhancement |
