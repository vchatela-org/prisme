# 18 · User guide

How to **use** prisme: setting it up, the daily loop, the reviews, and what happens in Notion and
Todoist when you do things. This guide is written for the person using prisme, not for someone
changing its code. For why it works the way it does, read [`00-vision.md`](00-vision.md); for the
exact rules, the numbered specs.

> **Privacy.** This file is public. Its examples are invented. Your own areas, weights and links
> never belong here ([`17-privacy.md`](17-privacy.md)).

---

## 1. What prisme is for

You already have two tools. **Notion** is where you think — goals, notes from books, how you do
things. **Todoist** is where you do — tasks, subtasks, due dates. What neither does is decide
**what to work on first**, or tell you whether your time is going where you meant it to.

prisme does that, in two steps:

1. **Allocate.** Your life is split into **areas** (health, work, home, …). Once a year you decide
   what share of your capacity each one deserves.
2. **Rank.** Inside each area, the pieces of work worth tracking — **initiatives**, outcomes you can
   finish in one to six weeks — are scored and ranked. A few are **now**; the rest wait.

Then prisme watches what you actually complete in Todoist and shows, per area, what you declared
against what really happened. An area that gets less than its share rises in the ranking; one that
gets more sinks.

**You keep working in Todoist.** An initiative has one task there, its **anchor**; everything you
break it into is ordinary subtasks you manage as usual.

---

## 2. Setting it up — once

Do these in order. Everything is under **Settings** in the sidebar (or `Ctrl/⌘ K` → *Go to
Settings*), and the first screen there is an overview of how everything is connected.

### 2.1 Areas — the only thing that has to come first

**Settings → Areas → New area.**

- **Name** — what you call it; you can rename it any time.
- **Key** — a short permanent id, proposed from the name. It never changes, because everything
  prisme measures is stored against it. Choose it once, calmly.
- **Kind** — almost always **Area**. Two special lanes exist, one of each at most:
  - **Run** — upkeep (chores, admin). Budgeted in hours per week, never ranked.
  - **Signals** — notifications and other machine-generated noise. Counted, never ranked.
- **Colour** — one of eight. Each swatch shows which areas already use it. *Automatic* picks one
  from the key, and two automatic areas can land on the same colour — pick one then.

To **retire** an area, untick *Active* on its page. It leaves ranking and the Year Review, and its
history stays. There is no delete, on purpose.

### 2.2 Where each area's work lives in Todoist

Open the area (**Edit** in the Areas table), then **Where its work lives in Todoist**:

- Tick every Todoist **project** or **section** whose tasks belong to this area. Several are fine —
  that is how Todoist's structure and your areas fold together without reorganising anything.
- A **section** beats its project, so one project can be split between two areas.
- A location already used by another area is shown as *belongs to …*; untick it there first.
- Mark one location **new work goes here**. That is where prisme will create an initiative's task,
  or a quick capture, for this area. Without one, prisme uses the most specific location.

**Nothing moves in Todoist when you do this.** It only tells prisme how to read what is already
there: completed tasks in these locations count toward the area, and a task labelled for prisme
there becomes one of its initiatives. Work in a project mapped to no area counts toward no area;
the backfill report lists those projects so you can map them.

### 2.3 Notion — which database is which

**Settings → Notion.** prisme never uses a Notion database by name. It knows **roles**, and you
point each role at a database or page by pasting its link (in Notion: *⋯ → Copy link*). prisme
checks it and shows its title.

| Role | Point it at | prisme… |
|---|---|---|
| Objectives | your objectives database | reads it; its rows are proposed as key results in Adoption |
| Takeaways | where you keep ideas from books and articles | reads it; action-type takeaways reach the Inbox |
| Media library | books / articles / videos | reads it, for context |
| Life areas | one page per area | reads it, for each area's narrative |
| Processes | procedures and routines | reads it; a ritual's duration comes from its page |
| Reviews | where review summaries should go | nothing yet |
| Initiative / Project / Capture pages | **a page you create for prisme**, not a database you keep | adds pages there when you ask for one |
| Initiative / Project / Capture template | an ordinary page laid out as a new page should start | copies its top-level blocks |

Two things to know:

- **Share each one with the prisme integration** in Notion (*⋯ → Connections*). Notion enforces
  this itself: anything not shared is invisible to prisme. A binding that is saved but not shared
  says *not readable* with the reason.
- A database link is enough; prisme finds the data source inside it. If a database holds several,
  it asks you to link the one you mean.

For takeaways to reach prisme, the deployment also needs `DOCTOOL_TAKEAWAY_TYPE_PROPERTY` — the name
of your takeaways' *type* property, whose values start with *Action* or *Principle*.

### 2.4 This year's weights

**Reviews → Year Review** (or *Change weights* in Settings). Give each area a share; the shares sum
to 100 %. They are fixed for the calendar year on purpose: a share you can change whenever you like
ends up matching whatever you already did. Run and Signals get no share.

### 2.5 Rituals

**Rituals** in the sidebar. A ritual is a habit with a cadence and a target — a weekly review, a
daily walk: *Weekly review · weekly · 80 %*, optionally linked to its process page in Notion. Rituals
are never ranked against initiatives; the KPI dashboard shows how often they happen.

### 2.6 Bring in what already exists — Adoption

**Adoption** lists everything in Todoist and Notion that prisme is not linked to yet. For each:

- **Adopt** — make it an initiative (or project) linked to the existing task. Nothing is created in
  Todoist; the task stays exactly where it is, with its deadline and priority.
- **Merge** — link it to something prisme already has.
- **Ignore** — never show it again.

Most tasks are just tasks. Adopt the few things that are genuinely *outcomes*; ignore the rest
freely. The queue is re-read once a day; press **Rescan** after labelling a task or changing an
area's locations.

---

## 3. Every day

### Focus — "what now?"

The first screen. **Now** is what you are working on (a handful at most, one per area by default);
**Up next** is what comes when a slot frees up; **Slots** shows where this week's capacity is going.
A *stale* warning means something in *now* has not been touched in a while.

**Force sync** reads both tools and shows what *would* change. It never writes anything — it is the
safest button in the app.

### Capture — a thought, in ten seconds

`Ctrl/⌘ K` → *Capture something*. Type what arrived and pick its area. It becomes a task in that
area's *new work goes here* location, labelled `prisme-capture`, and waits in the Inbox. It is
**not** an initiative until you promote it.

### Inbox — triage

What arrived since you last looked: captures, adopted items, and action takeaways from your reading.
For each, decide: **promote** it (becomes an initiative, with a title you write), move it to
**later**, or drop it. Principles never appear here — they stay in Notion.

### Backlog — the ranking

Initiatives ranked **within each area**. Never compare a score across areas: the allocation already
decided how much each area gets.

Four estimates drive the score, each on the scale 1 · 2 · 3 · 5 · 8 · 13, relative to the area's
other initiatives:

| Estimate | Ask yourself |
|---|---|
| **Value** | How much does it matter when it lands? |
| **Time criticality** | How fast does that value decay if it waits? A deadline raises this on its own |
| **Risk** | Does it unlock something, or remove a risk? |
| **Size** | How big is it, compared with the others? |

Hover a score to see exactly how it was reached.

### An initiative's page

Everything about one initiative: its status, estimates, dates, score history, the Todoist subtasks
under its anchor, and its Notion page.

- **Status** — `inbox` → `later` / `next` → `now` → `review` → `done` (or `waiting`, `dropped`).
  A drop asks for a one-line reason.
- **Deadline** is a hard external constraint and is prisme's. The **due date** is when *you* plan
  to do it and stays yours, in Todoist.
- **Dependencies** — *Edit dependencies* and tick what it waits on. The timeline replans around
  it; a loop is refused.
- **Narrative page** — *Create page* adds a page under your *Initiative pages* location from the
  template; *Link an existing page* just records a link. prisme never edits a page afterwards.

---

## 4. The reviews

Each review is a wizard (**Reviews**), one step at a time, with the data each step needs on screen.
You can leave and come back; decisions are saved as you go.

**Weekly** — triage what arrived · confirm what finished · check the now set · clear the conflict
ledger · look ahead at deadlines · re-score what changed · refill free now slots · record decisions.

- *Clear the conflict ledger*: a **conflict** is a prisme-owned field you (or something) changed in
  Todoist — say the anchor's deadline. prisme has already put its value back. Choose **prisme was
  right** to close it, or **the task tool was right** to go and change the initiative, so prisme
  writes the right value next time.

**Monthly** — declared against observed capacity · Run / Signals / rituals check · set objective
progress · find orphans (objectives nothing serves, initiatives serving nothing) · author next
month's objectives · replan what slipped.

**Yearly** — review the year, then **allocate next year** (the weights).

---

## 5. Reading the numbers

- **Areas** — each area's share of the last four weeks against its target. The bar is scaled to the
  area's own target, so "on target" always sits in the middle. The *balance factor* is what lifts a
  starved area's scores.
- **KPI** — the same over time, plus throughput, Run hours, Signals volume and ritual adherence.
- **Timeline** — planned start and end for each initiative, the critical path and deadlines at
  risk. Dragging only previews; nothing is saved from it.
- **Objectives** — annual and monthly objectives with key results. You set each key result's
  progress yourself; prisme shows its own computed progress beside it for comparison.

A task with no duration counts as 25 minutes of capacity; the charts say how much of a reading is
estimated.

---

## 6. How prisme talks to Todoist and Notion

### What you change where

| Change it in… | What |
|---|---|
| **prisme** | areas, colours, weights, initiatives (title, area, status, estimates, deadline, dependencies), objectives, rituals, reviews |
| **Todoist** | task text, subtasks, **due dates**, recurrence, completing things, your own labels, the priority of a subtask you set by hand |
| **Notion** | every page body — including pages prisme created — and your takeaways, media and process pages |

### Talking to prisme from Todoist

| Do this in Todoist | prisme… |
|---|---|
| Add the label `prisme` to a task | proposes it as an initiative (at the next pass) |
| Add `prisme:status:now` (or `next`, `later`, …) to an anchor | sets that status, then removes the label |
| Complete an anchor | moves the initiative to *review* for you to confirm |
| Anything else — subtasks, due dates, comments | nothing; it is yours |

### The write freeze

Until outward writing is switched on (a deployment setting, never a button), **prisme writes
nothing to Todoist or Notion**. Everything you do is recorded in prisme and waits; *Force sync*
shows what would be written. The top of **Settings** says which state you are in.

### Once writing is on

prisme will, and only will:

- keep each **anchor** task's title, deadline, priority and first description line in step with the
  initiative (priority: top three *now* → P1, rest of *now* → P2, *next* → P3);
- create an anchor when an initiative **created in prisme** reaches *next*, in its area's *new work
  goes here* location;
- give untouched subtasks the anchor's priority — never one you set by hand;
- create the capture tasks, projects and Notion pages you asked for;
- move an anchor that has left its area back into it.

It never touches due dates, recurrence, completion, deletion, comments, your own labels, or anything
below an anchor's first description line. An **adopted** task keeps its deadline and priority until
you move the initiative to *next*.

After adopting, the deployment's `SYNC_CREATE_THRESHOLD` has to be raised above 0 before prisme can
create anything: at 0, one planned creation holds back the whole pass — deliberately, because during
adoption any creation would be a mistake.

---

## 7. Questions

**How do I rename an area?** Settings → its **Edit** → Name → Save. Only the name changes; the key
stays, and so does everything measured against it.

**Two areas have the same colour.** Give one a colour of its own on its settings page. The Areas
screen links you there when it notices.

**I moved work to another Todoist project.** Tick the new project on its area's page. Past capacity
stays attributed as it was; from now on it counts where you say.

**A task I labelled doesn't show up in Adoption.** The queue is re-read once a day; press
**Rescan**. If it is in a project mapped to no area, it is listed without one, and it cannot be
adopted until you map that project to an area and rescan.

**The Inbox never shows anything from my reading.** Takeaways need the *Takeaways* role bound, the
store shared with the integration, and `DOCTOOL_TAKEAWAY_TYPE_PROPERTY` set in the deployment.

**Settings → Notion says *not readable*.** The page or database is not shared with the prisme
integration yet (*⋯ → Connections* in Notion), or the link is of the wrong kind for that role.

**Do I still need the seed files?** No. `seed/areas.json` and `seed/bindings.json` are for
rebuilding an instance from scratch from a script. Loading them **replaces** what they name —
including bindings set on the screen.

---

## 8. Words

| Word | Means |
|---|---|
| **Area** | A life domain with a yearly share of your capacity |
| **Lane** | *Run* (upkeep, hours/week) or *Signals* (noise, counted) — never ranked |
| **Initiative** | An outcome finishable in 1–6 weeks. The only thing that gets a score |
| **Anchor** | The one Todoist task that stands for an initiative |
| **Project** | Optional container for several initiatives, lasting months |
| **Objective / key result** | What you aim for this year or month, and how you'll know |
| **Takeaway** | An idea from something you read. A *principle* stays in Notion; an *action* can become an initiative |
| **Ritual** | A habit with a cadence and a target |
| **Deadline / due** | Deadline: a hard constraint, prisme's. Due: your plan, Todoist's |
| **Conflict** | A prisme-owned field changed outside prisme |
| **Balance factor** | How much an area's scores are lifted or lowered for being under- or over-served |
