# 19 · How prisme works

The functional model in one place: what each object is for, how things get in, the loop that turns
them into a decision, what each review cadence does with it, and where the model is still thin.

It sits between two other documents and replaces neither. [`18-user-guide.md`](18-user-guide.md)
says what to click; the numbered specs ([`10-model.md`](10-model.md) to
[`16-sync.md`](16-sync.md)) hold the exact rules. This one explains the **mechanism** end to end, so
that it can be argued with. Section 9 is the part meant for iterating: structural findings, each
stated as a property of the product with a direction to explore.

> **Privacy.** This file is public. Every example uses the synthetic areas in
> [`fixtures/`](../fixtures/) — `health`, `relationships`, `craft`, `money`, `home`, `community`.

---

## 1. The idea in one paragraph

prisme is **a budget, a ranked queue per budget line, and a meter**. Once a year you decide what
share of your capacity each life area deserves. Inside each area, the outcomes you are pursuing are
scored and ranked, and a few of them are *now*. Meanwhile prisme reads what you actually complete in
the task tool, compares each area's real share with its budget, and lifts the ranking of an area
that is being starved. Reviews — weekly, monthly, yearly — are where that evidence becomes a
decision. The decision is pushed to exactly one task per outcome, as a priority and a deadline;
everything else in the task tool stays yours.

The problem it answers is **allocation, not execution** ([`00-vision.md`](00-vision.md)). A task
list ranks by what is easy to ask; left alone, small pleasant upkeep absorbs the week and the areas
declared most important receive almost nothing. prisme makes that visible and pushes back on it.

---

## 2. Three tools, three jobs

```
   Notion (document tool)          prisme                      Todoist (task tool)
   ──────────────────────          ──────                      ───────────────────
   why                             what first                  how
   narrative pages                 areas + yearly weights      tasks, subtasks
   objectives' prose               initiatives + scores        due dates, recurrence
   takeaways from reading          objectives + key results    completion
   process pages (procedures)      rituals, reviews            your labels, comments
                                   history: events, capacity
          ───── reads ─────►                    ◄──── reads completions ────
          ◄── page dates, new pages ──            ── anchor title, priority, deadline ──►
```

- **prisme is not a task manager and not a mirror.** It never copies tasks. An outcome is
  represented in the task tool by **one** task, its *anchor*; everything under it is ordinary
  subtasks prisme only counts.
- **Ownership is per field, never per object** ([`11-ownership.md`](11-ownership.md)). An anchor
  task's *deadline* is prisme's; its *due date* is yours. When someone changes a prisme-owned field
  in the task tool, prisme puts its value back and records a **conflict** — unless the change is one
  of the defined requests of the *intent channel* (§6).
- **Configuration is only in the app.** Areas, mappings, database bindings and weights are entered
  on Settings; there is no file to import.

---

## 3. The objects

Twelve kinds of object, in five families. Most confusion comes from not knowing which family a
thing belongs to, so the families matter more than the list.

```
 THE BUDGET                     THE WORK                          THE INTENT
 ──────────                     ────────                          ──────────
 Area ──── weight(area, year)   Project (optional, one area)      Objective (annual | monthly)
  │  ╲                           └─ Initiative ◄── serves ──────── └─ Key result
  │   mapping → Todoist             │  (scored, 1–6 weeks)              (anchor task)
  │   project / section             └─ anchor task → subtasks
  │                                    (Todoist; counted, never copied)
  └─ page → Notion life-area page
                                Capture ──promote──► Initiative    Takeaway (action | principle)
                                                                     └─ action ──promote──► Initiative
 THE LANES (never ranked)                       THE RHYTHM
 ────────────────────────                       ──────────
 Run      upkeep, hours/week                    Review session (weekly · monthly · quarterly · yearly)
 Signals  machine noise, counted                  checklist · decisions · capacity snapshot
 Ritual   habit, cadence + target %
          ├─ process page (Notion)              THE MACHINERY (you rarely see it)
          └─ recurring task (Todoist) → adherence   event log · score history · conflict ledger
                                                    write audit · adoption queue · links · bindings
```

### 3.1 The budget

| Object | What it is | Comes from | Drives |
|---|---|---|---|
| **Area** | A life domain: `health`, `money`… Kind `area`, or one of two lanes: `run`, `signals` | Created on Settings | Everything is attributed to exactly one area |
| **Weight** | An area's share of capacity **for one calendar year**. Shares sum to 100 % | Year Review only | The target the meter compares against |
| **Mapping** | Which task-tool projects or sections belong to the area; one is *home*, where new work is created | Settings → Areas | How a completed task is attributed; where prisme creates tasks |
| **Area page** | The area's page in the document tool's life-areas database | Settings → Areas | How a document-tool entry (objective, takeaway, process) is placed in an area, via its database's *area column* |

A weight is frozen for the year on purpose: a share you can change at will drifts to match what you
already did. The two lanes get no share. A section mapping beats its project, so one general project
can be split across several areas without reorganising anything.

### 3.2 The work

| Object | What it is | Comes from | Owns in the task tool |
|---|---|---|---|
| **Initiative** | An **outcome** finishable in one to six weeks — *"fence replaced"*, not *"work on fence"*. **The only thing that is scored.** Exactly one area | Adopted from a task, promoted from the Inbox, or created in prisme | One anchor task: its title, priority, deadline, first description line |
| **Project** | Optional container for a multi-month effort with its own structure. Exactly one area | Adopted from a dedicated task-tool project, or created in prisme (which creates the project and its page) | The dedicated project and its sections |
| **Task** | Everything else | The task tool | Nothing — prisme reads anchors' subtrees and completions only |
| **Capture** | A thought noted in ten seconds | `Ctrl/⌘ K` → *Capture* | A task in the area's home, labelled `prisme-capture`, until promoted or dropped |

An initiative carries four estimates on the scale 1 · 2 · 3 · 5 · 8 · 13 — **value**, **time
criticality**, **risk**, **size** — plus an optional **deadline** (hard, external, prisme's), an
optional **earliest start**, and dependencies on other initiatives.

### 3.3 The intent

| Object | What it is | Comes from | Linked to |
|---|---|---|---|
| **Objective** | What a year or a month is for. Type `annual` or `monthly`, a period, a status (`draft`, `active`, `met`, `missed`, `dropped`) that follows its window: active from the period's first day, judgeable until 31 January (annual) or seven days after (monthly), then `missed` if nobody judged it ([ADR-0037](20-decisions/0037-an-objective-follows-its-window.md)) | Created on Objectives, or adopted from a page of the objectives database whose dates cover exactly one year or one month | Its page keeps the prose; prisme writes the page's date column from the period |
| **Key result** | A measurable component of an objective: statement, target, unit, **self-assessed progress 0–100** | Created under its objective, optionally grouped under a **sub-objective** (ADR-0039) | Initiatives **serve** it, and its computed progress comes from them. It has its own anchor task in the task tool while its objective is under way, for subtasks (S15), found or made beneath its objective's own task when the objective holds one (ADR-0038, ADR-0039) |
| **Takeaway** | An idea from something read or watched. *Principle* stays in the document tool; *action* becomes an Inbox item | Read from the takeaways database | Promotion makes an initiative linked back to it |

The thread from intent to work runs **objective → key result → initiative**. An initiative serves a
key result, not an objective directly — so an objective with no key result cannot be served by
anything (§9, S6).

Progress is self-assessed on purpose. prisme computes its own figure from the anchor's subtasks and
shows it **beside** yours, never instead of it: the gap between the two is the signal (*the tasks
were the wrong tasks*, or *progress came from outside the tracked work*).

### 3.4 The lanes — outside the ranking

| Lane | For | Measured as |
|---|---|---|
| **Run** | Recurring upkeep: chores, admin, maintenance | Hours per week against a budget. Counts in capacity, never ranked |
| **Signals** | Machine-generated notifications and digests | Volume only. Excluded from ranking **and** from capacity |
| **Ritual** | A habit: a cadence (daily … yearly) and a target adherence % | Adherence: how often it happened against how often it could have |

Keeping these out of the backlog is what keeps the backlog meaningful. They still consume the same
week, which is why Run counts toward capacity: hiding upkeep would hide the very pattern prisme
exists to show.

A ritual joins two external things: its **process page** (the written procedure, owned by the
document tool, which also declares a duration) and its **recurring task** (owned by the task tool,
whose completions are the adherence data). Both are chosen on Rituals. A ritual that *is* a review —
the weekly review, say — is measured by closing that review in prisme instead (S3), and a habit that
is neither is recorded by hand there, one period at a time. prisme owns only the adherence series.

### 3.5 The rhythm

A **review session** is one run of a cadence's wizard: a checklist of steps, the decisions taken,
and — on close — a snapshot of per-area capacity that is never retaken. §7 describes each cadence.

### 3.6 Which object is it? — a decision guide

Most of what exists in the two tools should **not** become a prisme object. Ask in this order:

| If the thing is… | It is… | In prisme |
|---|---|---|
| What a year or month is *for* | an **Objective** | Objectives (adopt its page, or create) |
| How you will know an objective is reached | a **Key result** | Under its objective |
| An outcome you can finish in 1–6 weeks | an **Initiative** | Inbox → Backlog |
| A multi-month effort with its own task-tool project | a **Project** (holding initiatives) | Adoption, or *New project* |
| Something to do regularly because it builds a goal | a **Ritual** | Rituals |
| Something to do regularly to keep things running | **Run** — map its project or section to the Run lane | Settings → Areas |
| An alert, a digest, an automation's output | **Signals** — map its project to the Signals lane | Settings → Areas |
| An idea from reading, actionable | an action **Takeaway** | Arrives in the Inbox by itself |
| A task | **a task** — nothing to do | Counted through its area's mapping |

The last row is the important one. The temptation during adoption is to promote everything; the
result is a ranking that means nothing.

---

## 4. How things get into prisme

There are five doors. Each takes a different kind of thing, and using the wrong door is the most
common way to end up with the wrong object.

| Door | Takes | Creates in prisme | Writes outward |
|---|---|---|---|
| **1. Settings** | Areas, mappings, database bindings (by *role*, never by name), area pages, weights | Configuration | Nothing |
| **2. Adoption queue** | What already exists and is not linked: labelled tasks, dedicated projects, objectives pages, processes pages | Linked objects, `origin = adopted` | **Never creates** anything outward ([ADR-0010](20-decisions/0010-adopt-never-creates.md)) |
| **3. Intent channel** | Labels you put on tasks in the task tool (§6) | An `inbox` initiative, **automatically on the next pass**; a status change | Removes a status-request label |
| **4. Inbox** | Captures, action takeaways, initiatives still at `inbox` | Promotes to an initiative, or drops | — |
| **5. Creation flows** | New initiative, new project, new objective / key result, new ritual, capture | Objects with `origin = created_in_prisme` | Anchor tasks, projects, pages — when writing is on |

### The adoption queue in detail

Adoption is the bridge from an existing setup. It lists every external object with no prisme link
and offers, per row:

- **Adopt** — make the prisme object this row stands for, bound to it. Nothing is created outward;
  an adopted task keeps its deadline and its hand-set priority until the initiative reaches `next`.
- **Merge / Link** — bind the row to an object prisme already has. This is the only way in for a
  key result or a ritual: create it first, *Rescan*, and a row with the same title in the same area
  is proposed against it.
- **Ignore** — permanent. *Ignore all ended* closes out last year's rows in one go.

Matching runs in a fixed order — an existing external id (certain, linked automatically), then
exact title in the same area, normalised title, fuzzy title (proposed, never applied). **Nothing
less than certain is applied without you.**

What becomes what:

| Found | Becomes |
|---|---|
| Task labelled `prisme`, in an area's location | Initiative at `inbox`, anchored to that task — made by the next sync pass, without a queue decision |
| Dedicated task-tool project with sections | Project |
| Page in the objectives database, dated exactly one year or month | Objective (`draft` until its period starts) |
| An objective or key result kept **as a task** | Key result. A task titled as a key result is proposed against it; one titled as an objective is queued as a key result of it, to be written first — then *Link*. Unlabelled tasks only: the `prisme` label still makes an initiative, marked *Looks like a key result* when it does, and *Convert to key result* on its page turns it into one, task included (S1). The next pass binds the link: the task becomes the key result's anchor (S15) |
| Page in the processes database | Ritual — by *Link*, after creating it on Rituals |
| A recurring task that is a habit | A ritual's **recurring task** — picked on Rituals (*Its recurring task*), or *Link* from the queue when it is labelled as a ritual. Unlabelled recurring tasks are left in place, as Run |
| Action takeaway | Initiative — promoted from the Inbox, then *Merge* the row onto it |
| An objective kept as **one task**, its title exactly the objective's | That objective's **own task**. When the `prisme` label made it an initiative, the next pass gives it to the objective and drops the initiative, so it never takes a slot ([ADR-0038](20-decisions/0038-an-objective-holds-its-task.md)). Its key results' tasks are its subtasks: one titled exactly as a key result is taken, the rest are made beneath it |
| A loose task | Stays a task |

The queue is rescanned by the first full pass of each day, or on demand with *Rescan*.

---

## 5. The core loop

```
   allocate ──► measure ──► rank ──► select ──► push ──► (you work in the task tool)
      ▲            │                                              │
      │            └──────────── balance factor ◄── completions ◄─┘
   yearly                    (every 15 minutes, by day)
```

**Allocate.** A weight per area per year. A year without weights does not inherit silently: the
balance factor goes *stale*, a banner appears, and the Year Review unlocks.

**Measure.** Every completion in the task tool is attributed to an area through the mappings —
each occurrence of a recurring task included, which the task tool's activity log records and its
completion history does not ([ADR-0040](20-decisions/0040-completions-are-read-from-the-activity-log.md)). Its
minutes are, in order of preference: the duration recorded on the task, the declared duration of
the matching process page (recurring work tied to a ritual), or a default of **25 minutes**. Over
the last **four weeks**:

```
actual_share    =  minutes in the area  /  minutes in all areas (Run included, Signals excluded)
balance_factor  =  clamp(target_share / actual_share, 0.5, 2)
```

A starved area's factor rises toward 2; an over-served one sinks toward 0.5.

**Rank** — within an area only. The active method is `wsjf-balanced`
([`12-scoring.md`](12-scoring.md)):

```
cost_of_delay  =  value + time_criticality + risk      (time_criticality := 13 if a deadline is < 14 days away)
score          =  cost_of_delay / size  ×  balance_factor
```

Scores never compare across areas; the weights already settled that. Work that is **not under way**
— an earliest start still ahead, or a project paused or closed — keeps a score and gets no rank
([ADR-0035](20-decisions/0035-only-what-is-under-way-is-prioritized-or-measured.md)). Scoring is a
plugin: another method can run in shadow and be compared before it is switched on. Screens show the
live score; a score is **stored** only when a re-score runs (the weekly review's step, or the
button beside *Force sync*), which is when the score history begins.

**Select** — the `now` set, a separate decision from ranking:

1. what is already `now` keeps its slot;
2. free slots fill from the top of the ranking, up to the **work-in-progress limits** chosen on
   Settings (two per area and seven overall by default). They are soft: a person can go past one
   and is warned, and work blocked by someone else moves to `waiting`, which holds no slot
   ([ADR-0036](20-decisions/0036-work-in-progress-limits-are-soft-and-chosen-on-settings.md));
3. only `next` and `later` initiatives are candidates — **an initiative still at `inbox` is never
   selected**, so triage comes first;
4. the rest is *Up next*.

**Push.** For each anchor: title, deadline, a backlink, and a priority derived from status — the
top three `now` → P1, the rest of `now` → P2, `next` → P3, everything else → lowest. A subtask
inherits the anchor's priority unless you set one by hand. prisme **never** writes a due date,
recurrence, completion, comments, your labels, or anything below the first description line.

**Worked example** (synthetic). `health` is weighted 20 % but received 5 % of the last four weeks,
so its factor is 2.0 (clamped). `home` is weighted 10 % and received 40 %: factor 0.5.

| Initiative | Area | V | TC | R | Size | CoD/Size | × balance | Score |
|---|---|---|---|---|---|---|---|---|
| Half-marathon plan running | health | 8 | 2 | 5 | 3 | 5.00 | × 2.0 | **10.0** |
| Draught-proofing done | home | 5 | 8 | 3 | 5 | 3.20 | × 0.5 | **1.6** |

The two scores are never compared with each other — each ranks within its own area. What the
balance factor changes is *which initiative within `health` wins its slot*, and how loudly a
neglected area's queue speaks at the review.

---

## 6. Sync — how decisions travel

prisme reconciles rather than reacts ([ADR-0009](20-decisions/0009-level-triggered-reconciliation.md)):
each pass compares the whole desired state with the whole actual state and converges, like
`terraform plan` then `apply`. A missed event, a restart or a manual edit heals on the next pass.

| | |
|---|---|
| **Cadence** | Every 15 minutes during the day window; nothing overnight |
| **Full pass** | The first of the day: complete fetch (detects drift), adoption rescan, capacity refresh, audit pruning |
| **Force sync** | Shows what *would* change. Writes nothing |
| **Writing** | Off until a deployment setting turns it on; a kill switch can freeze it again |
| **Create threshold** | A pass that would create more objects than the threshold is refused **whole**. At 0, no creation can happen — the right setting during adoption, the wrong one after |
| **Audit** | Every call made to either tool, kept 90 days by default |

**The intent channel** — what you can do from the task tool, on a phone:

| In the task tool | prisme |
|---|---|
| Label a task `prisme` | Makes it an initiative at `inbox` on the next pass — or, if its project maps to no area, lists it for review rather than guess |
| Label an anchor `prisme:status:now` (or `next`, `later`, …) | Applies the status, then removes the label |
| Complete an anchor | Moves the initiative to `review`, for you to confirm |
| Change a due date, subtasks, content, comments | Nothing — they are yours |
| Change an anchor's deadline or priority | Puts prisme's value back and records a **conflict** |

A field that conflicts every week is a field whose ownership is wrong; the conflict ledger is a
design signal as much as a queue.

### An initiative's life

```
            promote / adopt
  (capture) ──────────────► inbox ──► later ◄──► next ──► now ──► review ──► done
                              │         ▲          │       │         ▲
                              └─ drop   └──────────┴───────┴─► waiting
                                         dropped (with a reason) from anywhere open
```

| Transition | Made by |
|---|---|
| → `inbox` | Adoption, a `prisme` label, promoting a capture or takeaway |
| `inbox` → `later` / `next` | You, at triage |
| `next` → `now` | You, following the selection's proposal (refill step) |
| `now` → `review` | Completing the anchor in the task tool |
| `review` → `done` | You, at the weekly review |
| An anchor is created | When an initiative **created in prisme** reaches `next` (an adopted one already has its task) |

---

## 7. The cadences — what each review is for

The cadences are deliberately different questions, not the same review at different zoom levels.

| Cadence | The question | Where |
|---|---|---|
| **Daily** | What do I work on now? | Focus; Capture |
| **Weekly** | Is the `now` set honest for the coming week? | Reviews → Weekly |
| **Monthly** | Is the allocation honest, and are the objectives being served? | Reviews → Monthly |
| **Quarterly** | The monthly questions over three months | Reviews → Quarterly |
| **Yearly** | What should next year's shares be? | Reviews → Yearly, Year Review |

### Weekly — keep the `now` set honest

| Step | prisme prepares | You decide |
|---|---|---|
| Triage what arrived | Inbox: captures, action takeaways, `inbox` initiatives | Promote, later, drop |
| Confirm what finished | Initiatives in `review` (their anchor was completed) | Done, or back to `now` |
| Check the `now` set | What is in flight, last activity, staleness, blockers | Keep, demote, wait |
| Clear the conflict ledger | Every prisme-owned field changed outside prisme | Who was right |
| Look ahead at deadlines | Deadlines, and what the schedule says cannot make it | Re-plan, re-scope |
| Re-score what changed | The ranking, estimates editable | New estimates — appends a score row |
| Refill free `now` slots | Free slots per area, what the ranking proposes, and the key result each candidate serves | Which initiatives become `now` |
| Record decisions | — | The decisions, in words; closing snapshots capacity |

Planning the week **into days** — due dates, calendar — is deliberately not a step: it happens in
the task tool, which owns `due`.

### Monthly — allocation and objectives

| Step | prisme prepares | You decide |
|---|---|---|
| Declared vs observed capacity | Each area's share against its weight; the balance factor | Nothing to edit — the gap is the finding |
| Lane check | Run hours, Signals volume, ritual adherence | Whether upkeep and habits are where you want them |
| Set objective progress | Each key result: your progress beside the computed one | Progress, by judgement |
| Find orphans | Objectives nothing serves; initiatives serving nothing | Link, create, or accept |
| Author the next period | Objectives due to start | Next month's objectives and key results |
| Replan what slipped | The timeline: critical path, infeasible deadlines | Move, slice, drop |
| Record decisions | — | As weekly |

### Yearly

The monthly set over the year, then **Allocate next year**: the only moment a weight can be written.

The year's objectives are judged in January, not on 31 December. They stay `active` until 31 January
and read *judge it met or missed by …*; whatever is still open on 1 February closes as `missed`
([ADR-0037](20-decisions/0037-an-objective-follows-its-window.md)). A monthly objective has the first
seven days of the next month.

---

## 8. Reading the numbers honestly

- **Capacity is attention routed through tasks, not hours lived.** A task with no duration counts
  25 minutes, so a day of fifteen small chores outweighs one afternoon on something that matters.
  The charts say how much of a reading is estimated. Recording durations on the tasks that matter is
  what turns the estimate into a measurement.
- **Recurring work is counted, but its time is mostly estimated.** Each occurrence of a recurring
  task is a completion, read from the task tool's activity log. The log carries no duration, so an
  occurrence counts its ritual's declared duration or the default. How far back the log reaches
  depends on the task tool's plan, so older recurring work may be missing from a backfill.
- **Areas whose work never becomes a task read as starved.** Relationships and health often live
  outside any task list. The balance factor errs toward surfacing them, which is tolerable — but it
  is a lens, not a verdict.
- **Adherence exists only for rituals that are measured**: tied to a recurring task, fulfilled by
  their review, or recorded by hand with *done this period*. A newly tied task counts from the next daily capacity refresh, over
  its four-week window; older periods fill in only with a backfill.
- **Objective attainment covers objectives under way** in the range: no drafts, nothing from a
  later period.
- **Score history starts at the first re-score**, not at adoption.

---

## 9. Structural findings — where the model is thin

Found by walking a real setup through the model on 2026-10-26, against `main` at `v0.16.0`. Each is a
property of the product, with no instance data. They are candidates to iterate on — some may become
ADRs, some may be answered by copy alone.

| # | Finding | Kind |
|---|---|---|
| S1 | Objectives kept as tasks take the *initiative* door — matched across kinds, flagged on the label path, and convertible. **Done** | Model gap |
| S2 | A ritual cannot be tied to its recurring task from any screen — picked on Rituals, bound by *Link*, or recorded by hand. **Done** | Missing surface |
| S3 | prisme's own review does not count as the review ritual — a ritual can be fulfilled by closing its review. **Done** | Model gap |
| S4 | The review's "push the narrative" has no destination — a session links its page and copies its summary there. **Done** | Unfinished |
| S5 | Adopted initiatives all score the same, and nothing says so — *Unestimated* shows, and such work is held out of `now`. **Done** | Signal gap |
| S6 | An objective without a key result can never be served — the rule is stated where it bites, with *add a key result*. **Done** | Model rule, unexplained |
| S7 | A freshly adopted instance has an empty Focus with no pointer — it names the Inbox count and links to it. **Done** | Onboarding |
| S8 | Deployment settings silently switch features off — *Settings → Features*, and a banner when a pass is refused for its creations. **Done** | Onboarding |
| S9 | A project mapped only by section leaves its root tasks in no area — Areas counts them and offers *map the rest*. **Done** | Measurement gap |
| S10 | Multi-area general projects are offered as Projects — left out of the queue. **Done** | Queue noise |
| S11 | The task tool's own inbox has no home in prisme — listed as *Unsorted in Todoist*, adoptable into an area. **Done** | Model gap |
| S12 | The link from work to key results is examined monthly, but chosen weekly — the served key result is on the refill and the Backlog. **Done** | Cadence fit |
| S13 | There is no map of the objects — this document, linked from Settings and Adoption. **Done** | Documentation |
| S14 | The specs disagree on whether Signals count toward capacity — corrected to ADR-0014: they do not. **Done** | Spec drift |
| S15 | Key results have no anchor task yet — the reconciler creates, links or binds one while the objective is under way. **Done** | Spec ahead of code |

**S1 · Objectives kept as tasks take the *initiative* door.** [`13-migration.md`](13-migration.md)
says an objective or key result stored as a task becomes a **key result** anchored to that task. In
practice the obvious way to bring a task in is the `prisme` label, and the label means *make this an
initiative* — applied by the next pass with no question asked. So the obvious move turns a year-long
goal into a "one-to-six-week outcome" with a year-end deadline: failure 3 of
[`00-vision.md`](00-vision.md) — *objectives written as tasks are never read as objectives* —
recreated inside prisme, and duplicated beside the objective adopted from its page.
**Done:** identity resolution now compares an unlabelled task with key results and objectives
across kinds, on an exact or normalised title in the same area
([`13-migration.md`](13-migration.md) §3). A task titled as an unbound key result is proposed as
*link as key result*; one titled as an objective — even one adopted from its page — is queued as a
key result of it instead of being left in place or offered as an initiative, and the row says to
write the key result first. For the labelled path, which the queue never sees, an open initiative whose deadline is more than
six weeks after it can start, or whose title is an open objective's in its area, is marked **Looks
like a key result** on the Inbox and its page, with the reason ([`10-model.md`](10-model.md) §5).
And any open initiative can be **converted to a key result** from its page
(`POST /initiatives/:id/convert-to-key-result`): the key result is made under an open objective,
the initiative's task moves to it, and the initiative is dropped with a reason naming what it
became. From then on the label it kept is not a request, and — since S15 — the task is managed as
the key result's anchor. All three directions are built; S1 is closed.

**S2 · A ritual cannot be tied to its recurring task from any screen.** Adherence is computed from
the completions of the ritual's recurring task, and the declared duration of its process page only
counts through that same link. The Rituals screen sets the process page; the task can be tied only
through the adoption queue's *Link*, which needs the task to appear there with a title close enough
to the ritual's, in the same area — rarely true of a recurring task named for the action rather than
the procedure. And the way a task reaches the queue, the `prisme` label, makes it an initiative
first (S1). `POST /rituals/:id/adherence` can record a period by hand, from the API only. A
ritual that is never tied reads as *no data* for ever, and Run time stays at the default estimate.
Worse than the finding said: a *Link* from the queue recorded the decision and bound nothing,
because only the reconciler turns a link into a binding and it binds initiatives' anchors alone.

**Built:** Rituals has **Its recurring task**, picked from the task tool's open recurring tasks —
read live, the ritual's own area first, anything another entity holds shown and refused
(`GET /task-tool/recurring-tasks`, `PATCH /rituals/:id` with `externalTaskId`). Choosing one binds
it in `entity_external_ref`, which the capacity refresh reads adherence through and the reconciler
reads as taken; changing or clearing it unbinds the task before, link included, so it can be
offered again. A *Link* of a task to a ritual now binds it the same way, at once, and is refused
while the ritual has another task. A ritual with no task gets **done this period** on its row —
the period and its opportunities come from `ritualPeriodOf` in `@prisme/domain`, the rule the
backfill buckets by — and recording by hand is refused for a ritual measured from its task, whose
periods the refresh rewrites. S2 is closed.

**S3 · prisme's own review does not count as the review ritual.** Closing a weekly review session
records decisions and a capacity snapshot, and adds nothing to the adherence of a *weekly review*
ritual. The product's central ritual is the one it cannot see. **Explore:** let a ritual be
*fulfilled by* a review cadence, so closing a session is the completion.
**Built:** a ritual's *Measured from* on Rituals offers **Closing the weekly review in prisme** (its
own cadence's review; never for a daily ritual), stored as `ritual.fulfilled_by_review`
(migration 0020). Closing a session of that cadence rebuilds the ritual's adherence whole from every
closed session — `reviewAdherence` in `@prisme/domain` — so the sessions closed before it was chosen
count, a skipped period reads as a zero, and a lost rebuild is healed by the next close. A ritual has
one source: one fulfilled by its review takes no task, by *Link* or on Rituals, and refuses a period
recorded by hand. S3 is closed.

**S4 · The review's "push the narrative" has no destination.** The last step of every cadence is
named *record decisions and push the narrative*, and the *Reviews* role can be bound — but nothing
writes there yet ([`18-user-guide.md`](18-user-guide.md) §2.3: *nothing yet*). Someone whose review
history lives in the document tool must either keep doing the review there or keep two records.
**Explore:** on close, add a page to the reviews database from its template with the decisions and
the snapshot — or let a session link the page it was written in.
**Built, the second way:** a review session links **its page** in the document tool, on the
review's last step or afterwards on *Review history* (`PATCH /reviews/:id` with `externalPageId`,
settable after the close, `null` to unlink), and **Copy summary** puts the session's artefact —
decisions, steps covered and not, the capacity snapshot — on the clipboard as Markdown, to paste
into that page. One record, in the document tool, joined to prisme's. Nothing is written outward.
The first way stays out: prisme writing a page **body** is outside what the creating path does
(ADR-0030 sends a title and a template, nothing else), and `reviews_db` is write-only, so the
duplicate guard that reads a store's titles cannot run there. Pushing on close needs its own ADR.
S4 is closed.

**S5 · Adopted initiatives all score the same, and nothing says so.** Adoption sets every estimate
to the same middle value, so every adopted initiative in an area has the same score and the ranking
is a tie broken by order. Nothing distinguishes *estimated* from *never estimated*. **Explore:**
leave estimates empty until set, show *unestimated* on the Backlog, and make estimation part of
triage, the way the *ready for now* rule already expects.
**Built, with a flag rather than empty columns:** `initiative.estimated` (migration 0021) is `false`
where adoption or the label's capture wrote the placeholder, and any estimate written sets it, the
same value included. Existing adopted initiatives still at 3, 3, 3, 3 were marked unestimated. The
estimates read **Unestimated** on the Inbox, the Backlog, Focus and the initiative's page, with
**Keep these estimates** beside them. Selection holds an unestimated initiative back with the reason
`unestimated` (`isEstimated` in `@prisme/domain`), because a placeholder size passes `size ≤ 8` by
construction, and moving one to `now` by hand warns. Empty columns were not used: every scoring
method, the schedule and the MCP tools read the four numbers, and a nullable estimate would have
reached all of them for a signal one flag carries. S5 is closed.

**S6 · An objective without a key result can never be served.** Initiatives serve key results, not
objectives, so an objective adopted from a page — which arrives with none — is an orphan by
construction until key results are written. That may be the right rule (an objective you cannot
measure is a wish), but the screen does not say it is the rule. **Explore:** say so on the
objective, and offer *add a key result* from the orphans step.
**Built:** the rule is kept and now stated. [`10-model.md`](10-model.md) §7 says it. An objective
with no key result says *nothing can serve it* on its page and in the Objectives list, and the
monthly *find orphans* step tells the two cases apart: *no key result yet — add one*, linking
straight to the objective's *Add a key result*, or *nothing linked to its key results*
(`orphanReason` on the web). S6 is closed.

**S7 · A freshly adopted instance has an empty Focus with no pointer.** Everything adopted lands in
`inbox`, and only `next` and `later` are candidates for `now` — so Focus and *Up next* stay empty
until triage, and nothing on Focus says why. **Explore:** an empty state that names the Inbox count
and links to it.
**Built:** when nothing is in flight, suggested or queued, Focus leads with *Focus is empty because
nothing has been triaged — N items wait in the Inbox*, the reason in one sentence, and *Triage the
inbox*. The count is the Inbox's own (initiatives and action takeaways). With an empty Inbox too it
points at Adoption instead (`emptyFocusPointer` on the web). S7 is closed.

**S8 · Deployment settings silently switch features off.** Without
`DOCTOOL_TAKEAWAY_TYPE_PROPERTY` the reading pipeline is off and the Inbox never receives a
takeaway; Settings does not show it, only the FAQ explains it. With `SYNC_CREATE_THRESHOLD=0` after
adoption, the first initiative created in prisme that reaches `next` refuses the **whole** pass,
anchor updates included. Settings shows the threshold, but nothing connects it to that consequence
at the moment it happens. **Explore:** a *features* panel on Settings (reading pipeline, page
links, creation) that says which are off and why; and a banner when a pass is refused for its
creations.
**Built, both:** *Settings → Features* lists reading and writing the tools, creating a task for new
work, the reading pipeline, declared durations and opening pages, each **On** or **Off** with what
it does and, when off, the variable that turns it on — never the variable's value
(`GET /settings` gains `features`, booleans only). Creation reads **Off** at a threshold of 0 and
says that any pending creation refuses the whole pass. And every apply pass now records *why* it was
refused in `sync_run_state` (migration 0022: a kind and a count), `GET /sync` reports it as
`lastRefusal`, and Focus and Settings show *the last sync wrote nothing* when the reason was the
create threshold, until a pass is not refused. S8 is closed.

**S9 · A project mapped only by section leaves its root tasks in no area.** Mapping sections of a
general project is the intended way to split it across areas, but a task at the project's root —
in no section — matches no mapping and counts toward no area. The share chart silently excludes it.
**Explore:** count unattributed completions on Areas, and offer *map the rest of this project to…*.
**Built, both:** `GET /areas/unattributed` lists, over the window `/balance` measured and from the
record it read, the completions the last capacity refresh attributed to no area, grouped by
location, with `partlyMapped` for a project some of whose sections are mapped. Areas shows *N
completions … counted toward no area* above the shares, each location named from the task tool,
with **Map the rest of this project to…** (or *Map this project to…*): a mapping of the project
itself, which sections still outrank, through the same `PUT /areas/:key/mappings` Settings uses. It
counts from the next daily refresh. S9 is closed.

**S10 · Multi-area general projects are offered as Projects.** Every task-tool project with
sections is proposed as a `Project`, which has exactly one area
([ADR-0029](20-decisions/0029-one-area-per-project.md)). A general project whose sections are mapped
to several areas can only be ignored, and the queue does not say that ignoring is the expected
answer. **Explore:** leave out of the queue a project whose sections already map to two or more
areas.
**Built:** the scan counts, for each task-tool project, how many areas its sections' tasks land in —
each section's own mapping, else the project's, the rule attribution reads by (`sectionAreaCount`
in `adaptProjects`). At two or more the classifier keeps it in place (*a general project whose
sections map to several areas*), so it is never queued and counts among what was left in place.
The next scan removes a row already queued. [`13-migration.md`](13-migration.md) §4 has the row.
S10 is closed.

**S11 · The task tool's own inbox has no home in prisme.** prisme's Inbox holds captures, action
takeaways and `inbox` initiatives — not what sits unsorted in the task tool's inbox, which belongs
to no area. Sorting that inbox is a natural review step, and it has no surface; its completions
count toward nothing. **Explore:** read the task tool's inbox into the triage step as *unsorted*,
with *move to area* as the action.
**Built, with the move prisme may make:** the connector reads the project the task tool marks as the
Inbox (`inbox_project`), and `GET /task-tool/inbox` lists its open top-level tasks live, with what in
prisme holds each. prisme's Inbox shows them as *Unsorted in Todoist* and the weekly triage step
counts them. A plain task's location is the task tool's ([`11-ownership.md`](11-ownership.md)), so
*move to area* is **Make it an initiative** (`POST /task-tool/inbox/:id/initiative`): an adopted,
unestimated initiative linked to the task exactly as the queue's *Adopt* does — the next pass binds
it and, the Inbox being in no area, moves the task into the area. One that should stay a task is
sorted in the task tool. S11 is closed.

**S12 · The link from work to key results is examined monthly, but chosen weekly.** The weekly
*refill* step picks the next `now` without showing which key result each candidate serves; that link
only appears in the monthly *orphans* step. "Does next week's work serve a key result?" is a weekly
question. **Explore:** show the served key result on the refill and Backlog rows.
**Built:** every Backlog row and every refill candidate says *Serves "…" — objective* or *Serves no
key result*, from the open objectives' key results (`servedKeyResults` on the web — the same
`servedBy` the monthly orphans step reads, turned round). When the objectives cannot be read the
line is left out rather than claiming *none*. S12 is closed.

**S13 · There is no map of the objects.** The user guide is organised by screen, the model by
entity, and the screens by task. Nothing showed which object a thing should become, which door it
comes in by, or how the objects connect — the gap this document fills (§3.6, §4). **Explore:** link
this document from Settings' overview and from the Adoption screen.
**Built:** Settings' overview and the Adoption screen link here (*How prisme works*), at the tag the
running image was published under, or `main` for a development build (`docsUrl` on the web), and
the user guide's introduction points to it. S13 is closed.

**S14 · The specs disagree on whether Signals count toward capacity.**
[`12-scoring.md`](12-scoring.md#4-measuring-capacity) says *Run and Signals count toward capacity
but never toward ranking*; [`10-model.md`](10-model.md) §9 says Signals are *excluded from ranking
and from capacity*, and the attribution code (`laneOf` in `apps/sync/src/backfill/attribute.ts`)
excludes them. This document follows the code. **Explore:** correct `12-scoring.md` §4, or decide
otherwise in an ADR.
**Corrected:** no decision was open — [ADR-0014](20-decisions/0014-lanes-outside-the-backlog.md), Accepted,
already says *Run counts toward capacity; Signals do not*. [`12-scoring.md`](12-scoring.md) §4 and
[`10-model.md`](10-model.md) §3 now say the same, and the code was right. S14 is closed.

**S15 · Key results have no anchor task yet.** [`10-model.md`](10-model.md) §7 says *every key
result gets an anchor task* and calls it *the capability that was missing*: a key result you can
break into subtasks is one that gets worked on. The reconciler manages initiative anchors only, and
a key result's computed progress is derived from the initiatives that serve it. So today the only
way to break a key result down in the task tool is to create an initiative that serves it — which
works, and may be the better model, but it is not the one the spec describes. Since S1's conversion,
a key result can **hold** a task — `key_result.external_anchor_id`, bound in `entity_external_ref`,
so the reconciler treats it as taken — but nothing writes to it or reads its subtree yet.
**Explore:** build key-result anchors, or amend §7 to make *served by initiatives* the rule.
**Built, the first way** — the second would contradict
[ADR-0012](20-decisions/0012-key-results-first-class.md), Accepted. Every key result of an objective
under way (`active`, its period started: `keyResultAnchorDeadline` in `@prisme/domain`) is in the
reconciler's desired state. One bound to a task is converged: title = statement, deadline = the
period's last day, the `prisme:kr` label (the anchor label a converted initiative kept is removed),
the backlink line to its objective — never its priority or location. A decided link is bound and
creates nothing. One with neither gets a task created at its area's home, counted by the create
threshold. A hand edit of a managed field is a `review` that writes nothing, because the conflict
ledger resolves initiatives. Its subtree is not mirrored: computed progress still comes from the
initiatives that serve it. S15 is closed.
**Then placed beneath the objective's own task** ([ADR-0038](20-decisions/0038-an-objective-holds-its-task.md),
2026-10-29). An objective that holds a task gets its key results' tasks as subtasks of it. A subtask
already titled exactly as the key result is taken, and one that is only close is a `review`. An
objective that holds no task gets none made, because a top-level task per key result beside objective
tasks that already held them was the noise the owner's instance showed.
**Then searched through the whole subtree** ([ADR-0039](20-decisions/0039-a-key-result-may-sit-under-a-sub-objective.md),
2026-10-29). Key results kept by hand one level down, under sub-objective subtasks and in the tool's
markup, were missed by the direct, exact search, and the first pass created a copy of each. The search
now covers the subtree and reads titles with their markup set aside; free `KR`-shaped tasks that do not
match make it a `review`, never a create; a key result at 100% gets none; and a key result may name a
sub-objective, beneath whose subtask a new task is made.

---

## 10. Where to go next

| To change… | Read | And |
|---|---|---|
| Who owns a field | [`11-ownership.md`](11-ownership.md) | An ADR — never pick an owner silently |
| The score | [`12-scoring.md`](12-scoring.md) | A new method, run in shadow first |
| What adoption does | [`13-migration.md`](13-migration.md) | The four no-duplicate guards are not negotiable |
| What a pass writes | [`16-sync.md`](16-sync.md) | `plan` before `apply`, always |
| A review's steps | [`10-model.md`](10-model.md#cadences-and-where-each-step-happens) | The cadence table is the contract the wizard encodes |
| What is undecided | [`20-decisions/OPEN.md`](20-decisions/OPEN.md) | |
