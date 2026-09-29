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

The same page has **Its page in Notion**: the area's own page in your Life areas database, which is
how a Notion entry is recognised as this area's. It is optional and needs the Life areas database
bound first — see *Area column* in §2.3.

### 2.3 Notion — which database is which

**Settings → Notion.** prisme never uses a Notion database by name. It knows **roles**, and you
point each role at a database by pasting its link (in Notion: *⋯ → Copy link*). prisme checks it and
shows its title — and, for the databases it adds pages to, the templates each one holds.

| Role | Point it at | prisme… |
|---|---|---|
| Objectives | your objectives database | reads it; its rows are proposed as objectives in Adoption |
| Takeaways | where you keep ideas from books and articles | reads it; action-type takeaways reach the Inbox |
| Media library | books / articles / videos | reads it, for context |
| Life areas | one page per area | reads it; each area's own page is picked from it, and an *Area column* points at it |
| Processes | procedures and routines | reads it; a ritual's duration comes from its page |
| Reviews | where review summaries should go | nothing yet |
| Initiative / Project / Capture pages | **a database with at least one template** — how a new page of that kind should start | adds a page to it when you ask for one, from one of its templates |

Two things to know:

- **Share each one with the prisme integration** in Notion (*⋯ → Connections*). Notion enforces
  this itself: anything not shared is invisible to prisme. A binding that is saved but not shared
  says *not readable* with the reason.
- A database link is enough; prisme finds the data source inside it. If a database holds several,
  it asks you to link the one you mean. A link to a page is refused as *not a database*.
- **Date column (optional)** — for Objectives, Takeaways and Processes, choose which of the
  database's date properties says when an entry's period runs. Adoption then hides an entry whose
  date has passed (a range counts until its end), so last year's objectives stop crowding the queue.
  The list is what the last check found; after adding or renaming a date column in Notion, use
  *Check again* on Settings.
- **Area column (optional)** — for the same three, choose which of the database's **relation**
  properties points at your Life areas database. Then give each area its page: open the area on
  **Settings → Areas**, and under **Its page in Notion** pick its page from the Life areas database
  (it is picked by page, so renaming the page in Notion changes nothing; one page belongs to one
  area). From the next *Rescan* on Adoption, an entry related to **exactly one** area's page gets
  that area — so an action takeaway can be linked to the initiative its promotion made, an
  objective can be adopted and matched to one prisme already has in the same area, and the Area
  filter reaches Notion rows. An entry related to no page, to several, or to a page no area has, gets no area rather than
  a guess. A takeaway's area is Notion's and is
  re-read every scan; an objective's or a ritual's area is prisme's, so Notion's is only a
  starting point.
- **Templates are Notion's own.** Create and edit them in the database, in Notion — prisme picks up
  a new or renamed template, or a changed default, the next time it looks. A pages database with no
  template says so beside it: no page of that kind can be made until it holds one.

For takeaways to reach prisme, the deployment also needs `DOCTOOL_TAKEAWAY_TYPE_PROPERTY` — the name
of your takeaways' *type* property, whose values start with *Action* or *Principle*.

### 2.4 This year's weights

**Reviews → Year Review** (or *Change weights* in Settings). Give each area a share; the shares sum
to 100 %. They are fixed for the calendar year on purpose: a share you can change whenever you like
ends up matching whatever you already did. Run and Signals get no share.

### 2.5 Rituals

**Rituals** in the sidebar. A ritual is a habit with a cadence and a target — a weekly review, a
daily walk: *Weekly review · weekly · 80 %*, optionally linked to its process page in Notion. The
cadence is daily, weekly, monthly, quarterly or yearly; a quarterly or yearly habit has one
opportunity per calendar quarter or year. A process that has no rhythm (*on demand*) is a procedure,
not a habit — leave it out of the queue with *Ignore*. Rituals are never ranked against initiatives;
the KPI dashboard shows how often they happen.

### 2.6 Bring in what already exists — Adoption

**Adoption** lists everything in Todoist and Notion that prisme is not linked to yet. For each:

- **Adopt** — make it an initiative (or project) linked to the existing task. Nothing is created in
  Todoist; the task stays exactly where it is, with its deadline and priority.
- **Merge** — link it to something prisme already has.
- **Ignore** — never show it again.

A row from your **Objectives** database is adopted as an **objective**: its title, its area (from
the area column), and whether it is annual or monthly — read off its dates, which must cover
**exactly** one calendar year (1 January to 31 December) or one calendar month. Its page stays its
narrative, and nothing is written to Notion. Add its key results afterwards, on **Objectives**.

Where *Adopt* would be refused, the row has no *Adopt* button and says why instead, with what to do:

- An **action takeaway** — promote it from the **Inbox**, which makes an initiative that gets its
  Todoist task, then *Merge* its row here onto that initiative, or ignore the row.
- A **key result** or a **ritual** — neither can be made from a row alone. Create it under its
  objective on **Objectives**, or on **Rituals**, then *Rescan*: a row with the same title in the
  same area is proposed against it, and *Link* joins them. Linking a **Processes** row to a ritual
  also makes that page the ritual's process page, so its link need not be pasted on Rituals; if the
  ritual already names a different page, *Link* is refused and says so — change the page on
  Rituals, or ignore the row.
- **Outside every area** — give it an area (Settings → Areas, or the database's area column), then
  *Rescan*.
- **An objective whose dates are not one calendar year or month** — a quarter, say, or no dates at
  all. Correct the dates in Notion and *Rescan*, or create the objective on **Objectives** and link
  the row to it.

A title opens what it names in a new tab — the page in Notion, or the project in Todoist — so you
can read it before you decide. That needs `DOCTOOL_PAGE_URL_TEMPLATE` (and, for projects,
`TASKTOOL_PROJECT_URL_TEMPLATE`) set in the deployment; a task has no link yet.

Most tasks are just tasks. Adopt the few things that are genuinely *outcomes*; ignore the rest
freely. The queue is re-read once a day; press **Rescan** after labelling a task, changing an
area's locations or choosing a date column.

**Filters** sit above the list, each with a count of the rows it would show:

- **Date** — *Not ended* by default. An entry dated in the past (by the date column chosen in
  Settings → Notion) is hidden: the line under the filters says how many, and *Ended* shows them.
  *In progress*, *Upcoming* and *No date* narrow further.
- **From** — which Notion database, or Todoist tasks and projects.
- **Area** — one area, or everything outside every mapped area.

**Close out what has ended.** Hidden is not decided — the rows are still waiting, and the queue
only reaches zero once they are gone. Open *Ended*, narrow it with *From* and *Area* if you like,
and press **Ignore all N ended**. One confirmation states the count and the filters; every ended
entry those filters show is ignored, including any beyond the first page. Ignore one by one instead
if a few deserve adopting. Like every ignore it is permanent: an entry you later revive by extending
its date will not come back (it can still be adopted by its identifier). If the queue changed while
you were reading — a *Rescan*, or a decision in another tab — nothing is ignored, and the page shows
the new count to confirm.

---

## 3. Every day

### Focus — "what now?"

The first screen. **Now** is what you are working on (a handful at most, one per area by default);
**Up next** is what comes when a slot frees up; **Slots** shows where this week's capacity is going.
A *stale* warning means something in *now* has not been touched in a while.

Only work that is **under way** is offered a slot or queued in *Up next*. An initiative with an
*earliest start* after today, or one in a project you have paused or closed, waits outside both
until that day comes or the project is active again, and you do not have to change anything. What
is already in *now* stays: you put it there.

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
decided how much each area gets. Work that is not under way yet keeps its score but has no rank, and
the rank column says why: **Not started** or **Project not active**.

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
- **Narrative page** — *Create page* adds a page to your *Initiative pages* database, and Notion
  fills it from one of that database's templates. If the database holds several, you choose which
  beside the button, with Notion's default already selected. The page appears on the next pass, and
  its content a moment after that — Notion applies the template itself. *Link an existing page* just
  records a link. prisme sets the title and never edits a page afterwards.

---

## 4. The reviews

Each review is a wizard (**Reviews**), one step at a time, with the data each step needs on screen.
You can leave and come back; decisions are saved as you go.
Started one you do not mean to finish? **Discard** (on the review, or beside *Resume* on the
Reviews page) deletes it with its ticks and decisions, after asking. A closed review cannot be
discarded.

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
  starved area's scores. A share that looks wrong can be taken apart: **N completed** on a row opens
  the area at *Completed in the window*, the tasks that share was counted from, each with its minutes
  and whether they were recorded or the default estimate.
- **KPI** — the same over time, plus throughput, Run hours, Signals volume and ritual adherence.
  Objective attainment covers only the objectives under way in the chosen range, so no draft and no
  objective for a later period. The Year Review shows the year it reviews.
- **Timeline** — planned start and end for each initiative, the critical path and deadlines at
  risk. Dragging only previews; nothing is saved from it.
- **Objectives** — annual and monthly objectives with key results. You set each key result's
  progress yourself; prisme shows its own computed progress beside it for comparison. A draft or
  active objective can be moved to another period with **Move period** on its page — the move is
  kept in its history, and a linked Notion page's dates follow on the next pass. A met, missed or
  dropped objective keeps the period it was judged against. An objective whose period has not
  started is folded under **Upcoming** at the bottom of the screen and left out of the counts, the
  orphans and the review, and it moves up on its own on the first day of its period. One adopted
  from Notion for a period still to come arrives as a **draft**: mark it active when you commit to
  it.

A task with no duration counts as 25 minutes of capacity; the charts say how much of a reading is
estimated.

---

## 6. How prisme talks to Todoist and Notion

### What you change where

| Change it in… | What |
|---|---|
| **prisme** | areas, colours, weights, initiatives (title, area, status, estimates, deadline, dependencies), objectives — **including their dates**, rituals, reviews |
| **Todoist** | task text, subtasks, **due dates**, recurrence, completing things, your own labels, the priority of a subtask you set by hand |
| **Notion** | every page body — including pages prisme created — and your takeaways, media and process pages; **not** the date column of an objective page linked to prisme, which follows the objective |

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
- set the **date column** of each Notion objectives page linked to an objective to that objective's
  whole year or month (the column chosen on Settings → Notion). Changed there by hand, it is put
  back on the next pass and counted as a conflict — move the objective in prisme instead;
- move an anchor that has left its area back into it.

It never touches due dates, recurrence, completion, deletion, comments, your own labels, or anything
below an anchor's first description line. An **adopted** task keeps its deadline and priority until
you move the initiative to *next*.

After adopting, the deployment's `SYNC_CREATE_THRESHOLD` has to be raised above 0 before prisme can
create anything: at 0, one planned creation holds back the whole pass — deliberately, because during
adoption any creation would be a mistake.

### What prisme did — the Audit

**Audit** (in the menu, or *Go to the Audit* in the palette) lists every call prisme made to Todoist
or Notion, most recent first — the ones that worked and the ones that did not. Each row says which
tool, what kind of change, what it was about, whether it worked and whether the sync or a creation
made it; open **What was sent** to see exactly what prisme asked for. Filter by period, tool,
outcome, who made it and kind of change, or search what was sent. A failed row names the failure —
`rate_limited`, `invalid_token`, `refused` — and the sync retries it on its next pass.

Records are kept for **90 days** unless you choose otherwise in **Settings → Audit of outward
writes** (7 to 3650 days). The daily full pass deletes older ones; shortening the window deletes
nothing until then. The Audit is empty while writing is frozen — prisme attempts nothing, so there is
nothing to record.

### Scripts and agents — API tokens

A script, an agent or an MCP client cannot sign in the way you do, so it gets a **token**:
**Settings → API tokens → Manage** (or *Go to API tokens* in the palette). Name it after what will
use it, tick only the scopes it needs — a script that loads rituals needs `write:ritual` and nothing
else — and choose how long it lives, up to a year. It goes in an `Authorization: Bearer …` header.

- **The token is shown once**, when you mint it. prisme keeps only a hash, so copy it then; if it is
  lost, revoke it and mint another.
- **You do not need one.** Signed in, you hold every scope, including the one that manages tokens —
  and that one, `admin:tokens`, **no token can be given**, so no script can mint itself a wider
  token or revoke yours.
- **Revoke** takes effect on the token's next request. **Revoke all**, for the day a laptop goes
  missing, asks you to type *revoke all* and signs out every script at once; your own session is
  untouched, and it works even with the write freeze engaged.
- Revoked and expired tokens stay in the list, and **Last used** shows one nothing uses any more.

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

**Settings → Notion says *not readable*.** The database is not shared with the prisme integration
yet (*⋯ → Connections* in Notion), or the link is not to a database. When prisme can see that the
link is to a page, it says so instead: every role names a database, the page stores included.

**I asked for a page and nothing appeared.** Pages are made by the next pass, and only once the
kind's database is bound *and* holds a template — Settings → Notion shows both. If the database holds
several templates and none is Notion's default, prisme waits for you to choose one: the initiative's
*Narrative page* section offers the choice again. A template you chose and then deleted in Notion is
not swapped for another; choose again. The page's content arrives a moment after the page itself,
because Notion applies the template.

**Is there a file or command to import areas and bindings?** No. Settings (and the API behind it)
is the only way in.

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
