# 00 · Vision

## The failure mode

Personal productivity systems are usually judged on execution — tasks closed, streaks kept, inbox
at zero. By that measure they often work well. And yet the person using one can still look back
over three months and find that almost none of their stated priorities moved.

That is not an execution failure. It is an **allocation** failure, and it has a mechanism:

**Capacity follows friction, not values.** Work that is small, well-defined and pleasant closes
quickly. Work that is large, vague or emotionally heavy waits — indefinitely, and independently of
how important it was declared to be. A task list ranks by what's *askable*, never by what's *worth
asking*. Left alone, a system will quietly spend most of a quarter on upkeep and infrastructure
while the areas its owner called most important receive almost nothing.

Four structural reasons it can't self-correct:

1. **Several priority systems, none in charge.** A task tool's priority flags, a document tool's
   select fields, a scoring formula, a weekly top-three. Nothing feeds anything else, so each decays
   on its own and none is trusted.
2. **No common key across tools.** Comparing work in two different areas requires both areas to be
   the same kind of thing in both tools. They rarely are.
3. **Goals can't reach the work.** Objectives written as documents never become tasks. Objectives
   written *as tasks* are never read as objectives — they sit undated at the bottom of a list with
   a year-end deadline, invisible.
4. **No history.** Neither a task tool nor a document tool keeps a usable time series. "Am I
   drifting?" is unanswerable by construction, so drift is only ever noticed long after it matters.

## What prisme is

The **decision layer** that sits between thinking and doing.

```
Document tool  ──►  prisme  ──►  Task tool
   (why)          (what first)     (how)
      ◄───────── progress ─────────┘
```

It owns what neither other tool can hold: capacity allocation, comparable scores, dependencies and
schedule, the event history, and the review rituals that turn all of it into decisions.

## What prisme is not

- **Not another task manager.** It never tries to be where you work. Dates, subtasks, recurrence,
  mobile capture, notifications — all of that stays in the task tool, which is good at it.
- **Not a document tool.** Narrative, reflection and reference stay where prose belongs. prisme
  stores structure and numbers, and links out for everything else.
- **Not a mirror.** It deliberately does *not* copy tasks 1:1 into a second system. That is the
  failure mode of every off-the-shelf sync product: you end up maintaining two task lists. prisme
  syncs *decisions* downward and *progress* upward, and copies as little as possible.
- **Not an optimiser.** No formula decides whether one life area matters more than another. That is
  a values judgement; prisme's job is to make it explicit, then keep you honest about it.
- **Not a multi-tenant product.** Single owner, self-hosted. Security still applies in full — see
  [`14-threat-model.md`](14-threat-model.md) — but there is no tenancy model to design.

## The five ideas that make it work

**1 · Allocate before you rank.**
Each area gets a share of discretionary capacity, set once a year. Scoring ranks only *within* an
area. Whether a home-improvement job beats a relationship goal is not something a score can answer
honestly — so it is answered once, deliberately, as a budget.

**2 · Score initiatives, never tasks.**
The unit of decision is an **initiative**: an outcome finishable in roughly one to six weeks.
Anything bigger gets sliced. Tasks never carry a score; they inherit priority from their initiative.
This collapses a backlog of hundreds of tasks into a few dozen comparable things.

**3 · Deadlines prioritize, dates plan.**
A deadline is a hard external constraint and feeds urgency. A due date is when you intend to sit
down and do something. They are different fields with different owners, so they never fight:
prisme writes deadlines, you write dates.

**4 · One owner per field, never per object.**
"Notion owns initiatives, Todoist owns tasks" sounds clean and falls apart immediately, because a
single initiative has fields that genuinely belong on both sides. Ownership is assigned per *field*
([`11-ownership.md`](11-ownership.md)). Conflicts then resolve by rule instead of by merge logic.

**5 · Reconcile, don't react.**
Event-driven sync drifts forever after one missed webhook. prisme is level-triggered, like a
Kubernetes controller or `terraform plan`: every run compares full desired state against actual
state and converges. Restarts, API errors and manual edits all self-heal.

## What success looks like

- "What should I work on now?" is answered without opening a planning tool.
- The declared-versus-actual capacity chart is uncomfortable, then stops being uncomfortable.
- A weekly review fits in the time budgeted for it, because the preparation is already done.
- An objective with no initiative behind it is visible as such, in the month it happens rather than
  in December.
- Changing the scoring method is a configuration change, not a migration.

## Why not just buy something

The loop *goals → ranked work → capacity feedback → review* is not owned by any existing product.
Sync tools copy tasks between systems without a model. Calendar-first planners schedule what you
already decided. Prioritization frameworks score a list but ignore allocation and have no
connection to where work actually happens. Each covers one edge of the loop; none closes it.

> **Note on scope.** The concrete diagnosis that motivated this project — the real measurements of
> where capacity actually went — is deliberately not reproduced here. This repository is public and
> impersonal; see [`17-privacy.md`](17-privacy.md). The general mechanism above is what matters for
> anyone reading the code.
