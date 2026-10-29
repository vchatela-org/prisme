# 18 · User guide

How to **use** prisme: setting it up, the daily loop, the reviews, and what happens in Notion and
Todoist when you do things. This guide is written for the person using prisme, not for someone
changing its code. For why it works the way it does, read [`00-vision.md`](00-vision.md); for a
map of the objects — what a thing should become, which door it comes in by, how the loop and the
reviews fit — [`19-how-it-works.md`](19-how-it-works.md), which Settings and Adoption link to; for the
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
  - **Signals** — notifications and other machine-generated noise. Counted, never ranked. Map a
    project to it, or — when your automations write into your areas' sections — give their tasks a
    label and choose it in **Settings → Signals lane label**: a task carrying it counts as Signals
    wherever it sits.
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
- **Todoist's Inbox is not offered.** It belongs to no area: what waits there is sorted from
  prisme's Inbox (*Unsorted in Todoist*) or in Todoist. If an area already lists it, Settings and the
  Inbox say so in orange. Untick it, mark a home in the area's own project, and save. While it stays
  mapped, everything completed in the Inbox counts toward that area.

**Nothing moves in Todoist when you do this.** It only tells prisme how to read what is already
there: completed tasks in these locations count toward the area, and a task labelled for prisme
there becomes one of its initiatives. Work in a project mapped to no area counts toward no area,
and so does a task at the root of a project you mapped only by section. **Areas** lists both under
the shares — *N completions in the last 4 weeks counted toward no area* — with **Map the rest of
this project to…** (or *Map this project to…*) beside each: it maps the project itself to the area
you choose, and the sections you mapped keep their own areas.

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
| Reviews | where review summaries should go | nothing yet — a review links its page on the review itself (§4) |
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

**Settings → Features** lists what the deployment switches on and off — reading and writing the
tools, creating a task for new work, the reading pipeline, declared durations, opening pages from
prisme — each with **On** or **Off**, and for an off one the variable that turns it on. It shows
whether a variable is set, never its value.

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

How often it happened is read from one of three places — *Measured from*, on the ritual:

- **Its recurring task** — choose it on the ritual (*Edit*, or when defining it). The list is your
  open recurring tasks in Todoist, this area's first; one that already belongs to an initiative, a
  key result or another ritual is shown and cannot be chosen. Each completion of that task is one
  occurrence, counted from the next daily capacity refresh over the last four weeks. Nothing is
  written to Todoist. *None* unties it.
- **Closing its review** — *Closing the weekly review in prisme* (or monthly, quarterly, yearly: the
  ritual's own cadence). Each review session of that cadence you close on Reviews is that period
  done, and the sessions you closed before choosing it count too; a period you closed no review in
  reads as missed, and the current one shows only once it is done. This is how a *weekly review*
  ritual is measured by the review itself. A daily ritual cannot be measured this way.
- **By hand** — a ritual with no task shows *This week: 3 of 7 days* (or *This month: not yet*) on
  its row, with **Done** and **Undo**. A daily habit has seven chances a week; every other cadence
  has one a period. A ritual measured from its task or its review has no such buttons: its
  completions or its closes are the record.

### 2.6 Bring in what already exists — Adoption

**Adoption** lists everything in Todoist and Notion that prisme is not linked to yet. For each:

- **Adopt** — make it an initiative (or project) linked to the existing task. Nothing is created in
  Todoist; the task stays exactly where it is, with its deadline and priority.
- **Merge** — link it to something prisme already has.
- **Ignore** — never show it again.

A Todoist project with sections is offered as a **project** — unless you have already split it
across areas on Settings → Areas, its sections feeding two or more areas. That is a general project:
its sections are locations, and a prisme project has one area, so it is not in the list at all.

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
  Rituals, or ignore the row. Linking a Todoist task to a ritual — one labelled as a ritual, the only
  kind the queue offers — makes it the ritual's recurring task, the same way and with the same
  refusal. An unlabelled recurring task never reaches the queue: choose it on Rituals instead.
- **A Todoist task named like an objective** — it is offered as a **key result** rather than left
  out or turned into an initiative, because an objective kept as a task is usually one of its
  measurable parts. Add that key result under the objective on **Objectives** with the task's title,
  then *Rescan*: the row is proposed against it, and *Link* joins them. A task named like a key
  result you already wrote is proposed against it straight away. Labelled tasks are left to their
  label.
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

The first screen. **Now** is what you are working on (a handful at most: by default two per area
and seven overall, set in **Settings → Work in progress**);
**Suggested** is what the ranking would put in a slot that is free — it is still *next* until you
press **Start**, and nothing is promoted for you; **Up next** is what comes when a slot frees up;
**Slots** shows where this week's capacity is going, counting only what is in *now*. A *stale*
warning means something in *now* has not been touched in a while.

**The limits are soft.** When an area or the whole of *now* is full, Focus stops suggesting more and
*Start* warns you, but nothing is refused. When something is blocked by someone else, move it to
**Waiting**. It keeps its place and its history and gives its slot back, so new work can start
without going past a limit. Objectives and key results never take a slot.

Only work that is **under way** is offered a slot or queued in *Up next*. An initiative with an
*earliest start* after today, or one in a project you have paused or closed, waits outside both
until that day comes or the project is active again, and you do not have to change anything. What
is already in *now* stays: you put it there.

**An empty Focus says why.** Right after adoption everything sits in the Inbox, and only work in
*next* or *later* can be suggested or queued — so Focus has nothing to show. When nothing is in
flight, suggested or queued, Focus says how many items wait in the Inbox and links to it; with an
empty Inbox too, it points at Adoption.

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

An initiative marked **Looks like a key result** has a deadline more than six weeks away, or the
same title as an objective in its area — the usual sign of a goal kept as a Todoist task and
labelled `prisme`. An initiative is an outcome of one to six weeks; a goal like that is usually a
key result of its objective. The mark is a question, not a rule: it changes no score and no slot.

Triage is also where an adopted initiative gets its estimates: its row reads **Unestimated** until
you set them (or keep the middle values on purpose).

**Unsorted in Todoist** lists what sits in Todoist's own Inbox — work in no area, which counts
toward nothing. For one that is really an outcome, write it as one, pick an area and **Make it an
initiative**: it is adopted, not copied, and the next sync moves the task into that area in Todoist.
One that should stay a task is sorted in Todoist; prisme does not move a plain task. The weekly
review's *Triage what arrived* counts them too.

### Backlog — the ranking

Initiatives ranked **within each area**. Never compare a score across areas: the allocation already
decided how much each area gets. Work that is not under way yet keeps its score but has no rank, and
the rank column says why: **Not started** or **Project not active**.

Under each title, the key result it serves — *Serves "…" — objective* — or *Serves no key result*.
The weekly review's *Refill free now slots* shows the same line beside each candidate, so whether
next week's work serves an objective is answered when it is chosen, not a month later. The link is
made on the key result (*Served by*), on its objective's page.

Four estimates drive the score, each on the scale 1 · 2 · 3 · 5 · 8 · 13, relative to the area's
other initiatives:

| Estimate | Ask yourself |
|---|---|
| **Value** | How much does it matter when it lands? |
| **Time criticality** | How fast does that value decay if it waits? A deadline raises this on its own |
| **Risk** | Does it unlock something, or remove a risk? |
| **Size** | How big is it, compared with the others? |

Hover a score to see exactly how it was reached.

**Unestimated** in place of the four numbers means nobody has estimated it: everything adopted, and
anything the `prisme` label brings in, starts with the middle of the scale for all four, so it ties
with every other such initiative. It is not proposed for *now* until it is estimated. Change any
estimate, or **Keep these estimates** if the middle values are right.

### An initiative's page

Everything about one initiative: its status, estimates, dates, score history, the Todoist subtasks
under its anchor, and its Notion page.

- **Status** — `inbox` → `later` / `next` → `now` → `review` → `done` (or `waiting`, `dropped`).
  A drop asks for a one-line reason.
- **Looks like a key result** — shown, with its reasons, while the initiative is open and has a
  deadline more than six weeks away or an objective's title in its area. See *Inbox* above.
- **Convert to key result** — beside that mark, or under *Is it a key result?* for any open
  initiative. Choose the objective (its own area's come first), write the statement, target and
  unit, and *Convert*: the key result is added to the objective, the Todoist task moves to it, and
  the initiative is dropped with a reason saying what it became. Nothing is written to Todoist, and
  from then on prisme leaves that task alone — its `prisme` label no longer brings it back as an
  initiative.
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

**Its page in Notion.** If you write your reviews in Notion, link the page on the review's last step
or later on **Review history** — *Link a page*, then paste its link (*⋯ → Copy link*). **Copy
summary** puts the session's written artefact on the clipboard (decisions, what was and was not
covered, the capacity snapshot), as Markdown, to paste into that page. prisme writes nothing to the
page itself; *Unlink* forgets it.

**Weekly** — triage what arrived · confirm what finished · check the now set · clear the conflict
ledger · look ahead at deadlines · re-score what changed · refill free now slots · record decisions.

- *Clear the conflict ledger*: a **conflict** is a prisme-owned field you (or something) changed in
  Todoist — say the anchor's deadline. prisme has already put its value back. Choose **prisme was
  right** to close it, or **the task tool was right** to go and change the initiative, so prisme
  writes the right value next time.

**Monthly** — declared against observed capacity · Run / Signals / rituals check · set objective
progress · find orphans (objectives nothing serves, initiatives serving nothing) · author next
month's objectives · replan what slipped.

- *Find orphans*: work is linked to a **key result**, never to an objective directly, so an
  objective with no key result can't be served by anything — every objective adopted from Notion
  starts that way. Its row says *no key result yet — add one*, which opens its *Add a key result*.
  One whose key results have nothing linked says so instead; link work from the weekly refill or
  the key result's *Served by*.

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
  orphans and the review.
  **An objective follows its window.** A draft becomes active on the first day of its period, and
  one marked active ahead of time goes back to draft. When the period is over it stays active
  while you review it: until **31 January** for an annual objective, **seven days** for a monthly
  one. The card says *judge it met or missed by …*, and the screen counts these as *Period over, to
  judge*. That is the time to close out the period's tasks in Todoist; prisme leaves them open and
  never closes them.
  **An objective can be one task in Todoist.** If you keep each objective as a task, give it exactly
  the objective's title. A task labelled `prisme` with that title is recognised on the next sync: it
  becomes the objective's own task instead of an initiative, so it never takes a slot. prisme then
  sets its deadline to the end of the period, swaps the `prisme` label for `prisme:objective` and adds
  a link back. The title, priority and subtasks stay yours. Each key result gets its task beneath
  it. A task anywhere beneath the objective's task that reads exactly as the key result — bold and
  links aside — is used, so key results kept one level down under `O1 : …` subtasks are found. A
  key result can name its **sub-objective** (`O1 : Ship early`), and then its statement need not
  repeat it: write `KR1 : Ship one quick win`, which is what its task will read. A new one is made
  beneath the subtask that reads as its sub-objective. A task with nearly the same title, or
  `KR`-numbered tasks none of which matches, are flagged in the sync plan instead of a new task
  being made: make the two titles identical and the next pass links them. A key result already at
  100% gets no task. An objective with no task of its own gets no
  key-result tasks. An objective nobody judges by then closes as **missed**, and its history says it
  was the window that closed it. You can still change it to *met* afterwards.

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
| Add the label `prisme` to a task | proposes it as an initiative (at the next pass) — unless the task already belongs to a key result |
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
- move an anchor that has left its area back into it;
- give each **key result** of an objective that is active and under way a task of its own, so you
  can break it down with subtasks: the task you linked to it if there is one, otherwise a new one in
  its area's *new work goes here* location. prisme keeps its title (the statement), its deadline
  (the last day of the objective's period), the `prisme:kr` label and its first description line —
  never its priority. Edit the statement on Objectives; an edit made in Todoist is flagged in the
  plan and left as you wrote it.

It never touches due dates, recurrence, completion, deletion, comments, your own labels, or anything
below an anchor's first description line. An **adopted** task keeps its deadline and priority until
you move the initiative to *next*.

After adopting, the deployment's `SYNC_CREATE_THRESHOLD` has to be raised above 0 before prisme can
create anything: at 0, one planned creation holds back the whole pass — deliberately, because during
adoption any creation would be a mistake. When that happens, Focus and Settings say so: *the last
sync wrote nothing*, with how many things it had to create and the threshold. The message goes away
with the next pass that is not refused.

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

### Scripting the API — adopting in bulk

Everything a screen does is a call on the API, so a script can do it too. The recipe below brings a
Notion *Processes* database in as rituals; the same shape serves any row the queue cannot *Adopt*.

- **Where.** The API's own host — not the web's — under **`/api/v1`**: `https://<api-host>/api/v1/…`.
  A path without the prefix answers `404 not_found`. Send `Authorization: Bearer <token>`. With the
  `read:meta` scope, `GET /api/v1/openapi.json` describes every route, its body and its scope.
- **Scopes.** A refusal names the scope it wanted (`403 … does not hold the read:areas scope`), but
  they are cheaper to tick once. For this recipe: `read:areas` (rituals and areas), `read:adoption`
  (the queue), `write:ritual` (create a ritual), `write:adoption` (link, ignore, rescan). Setting a
  store's area column needs `admin:settings`; do it on the screen instead and keep the token narrow.
- **Before you start.** Every row must have an area, or it cannot match a ritual (which always has
  one). A *Processes* row gets its area from the store's area column — **Settings → Notion →
  Processes** — so set that first, then *Rescan*. In the queue, `areaKey: null` means it is not set.

The loop, in order:

1. **Read.** `GET /adoption/queue?source=processes_db&when=all&limit=200` — `limit` is at most 200.
   `source` is the store's role key (or `project` for Todoist projects). Each item has a `title`,
   `areaKey`, `externalKind`, `externalId`, and — once a match exists — `proposedId`, `matchRule` and
   `confidence`.
2. **Create.** `POST /rituals` with `name` (the page's title, exactly), `areaKey`, `cadence`
   (`daily`, `weekly`, `monthly`, `quarterly`, `yearly`) and `targetAdherencePct`. A row's cadence is
   in its Notion page; its target is nowhere in Notion, so you choose it. `externalPageId` is
   optional — linking sets it.
3. **Rescan.** `POST /adoption/scan` with `{}`. The answer is `{ ran, queued, … }`. **`ran: false`
   means another pass holds the lock, so nothing was read — not that it failed.** Wait and repeat
   until `ran` is `true`; it can take a couple of minutes. Only then does the row carry a proposal.
4. **Link.** For each item with a `proposedId`: `POST /adoption/decisions` with `prismeId` =
   `proposedId`, `externalKind` and `externalId` from the item, and the item's own `matchRule` and
   `confidence`. This is the screen's *Link* button; on a *Processes* row it also makes the page the
   ritual's process page. A row that still reads `adoptRefusal: needs_cadence` after it has a
   `proposedId` is not stuck: *Adopt* is what is refused, *Link* is the way in.
5. **Ignore** what is not a habit — a process marked *on demand*. `POST /adoption/ignore` with
   `externalKind`, `externalId` and an optional `reason`. It is permanent: there is no un-ignore.

Steps 2, 4 and 5 change prisme's own records; none of them writes to Notion or Todoist. They have no
dry run of their own, so print the list of rituals you would create and the rows you would ignore,
read it, then send it — an ignore cannot be taken back.

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
