# ADR-0037 · Let an objective's window move its status: start, close, and a month to judge

**Status:** Accepted · 2026-10-29 · decided by the owner, 2026-10-29 — supersedes the *nothing
makes it `active` later* and *objectives already adopted are not changed* rules of
[ADR-0033](0033-a-store-area-column-names-an-entry-area.md) point 5, and, for objectives only, the
*change the status instead* alternative that
[ADR-0035](0035-only-what-is-under-way-is-prioritized-or-measured.md) rejected

## Context

An objective is `annual` or `monthly` and has a period. Until now its status moved only by hand.
[ADR-0033](0033-a-store-area-column-names-an-entry-area.md) point 5 adopted an objective for a period
still to come as a `draft`, and said *nothing makes it `active` later: that is a person's
decision*. [ADR-0035](0035-only-what-is-under-way-is-prioritized-or-measured.md) kept work that is not
under way out of every list by date and not by status, and it rejected rewriting a status on a timer.
Nothing ever closed an objective at the end of its period.

The owner reviewed their own instance on 2026-10-29 and decided the opposite: *"objectives (yearly
and monthly) must auto start and end on their expected windows."* What the instance showed:

- An objective for a later year was `active`, and so was next month's. Both were adopted or set
  before the dates mattered, and both stayed that way because nothing moved them.
- A year's objectives are not judged on 31 December. The owner reviews them, and tidies the task
  tool for what was and was not done, *"somewhere in January"*. Closing an objective on its last
  day would take it out of every list before that review.

## Decision

An objective's **window** is its period plus a **review window** after it
(`OBJECTIVE_REVIEW_GRACE`, `objectiveWindowOf`):

| Type | Period | Can be judged until |
|---|---|---|
| `annual` `Y` | `Y-01-01` – `Y-12-31` | `Y+1-01-31` |
| `monthly` `Y-MM` | the month | seven days after its last day |

Read against today in the instance's timezone, an objective is `upcoming`, `running`, `closing`
(period over, still judgeable) or `ended` (`objectivePhaseOf`). The window moves its status
(`objectiveWindowSteps`):

1. **A draft becomes `active` when its period starts.** Nobody has to switch a year on.
2. **An `active` objective whose period has not started becomes a `draft`.** This covers objectives
   adopted or set early, and it is the case that ADR-0033 left alone on purpose.
3. **An objective still open when its review window ends becomes `missed`.** A person judges `met`
   or `missed` during the window. The window closing on its own is the default, not a verdict.
4. **A judged objective (`met`, `missed`, `dropped`) never moves.** Judging early, before the period
   ends, is allowed and stands.

Each change is written to `event_log` as `status_changed` on the objective, `actor = 'sync'`, with
`after.reason` set to `period_started`, `period_not_started` or `review_window_ended`. A closed-by-window
`missed` can therefore always be told apart from a judged one.

**Where it runs:** first in every reconciler pass, from the CronJob and from `POST /sync` alike,
before the reconciler reads the objectives (`advanceObjectiveWindows`). It writes prisme's own table
only, so it runs under the write freeze too. It is level-triggered: it compares every open
objective's status with its window, so a missed pass or a restored backup converges on the next one.
Each change is a compare-and-set on the status it read, so a person who judges an objective while a
pass runs wins.

**What the window does not do:**

- **It writes nothing outward.** A key result's task keeps its deadline (the period's last day) and
  stays open in the task tool during the review window, for the owner to tick off or carry. Once the
  objective is judged, or closed by its window, prisme stops managing the task. It never closes,
  moves or deletes it.
- **It does not move a period.** [ADR-0034](0034-an-open-objective-moves-and-its-page-follows.md)
  still governs that, and a moved period simply gives the objective a new window.
- **Initiatives are unchanged.** ADR-0035's rule still holds for them, by date and not by status.

The Objectives screen says how long a closing objective can still be judged, and counts those
objectives as *Period over, to judge*. The objective's DTO carries its `window` (`startsOn`,
`endsOn`, `judgeBy`), so the screen compares dates and never computes them.

## Consequences

- **The status now describes the window.** ADR-0035's *by date, not by status* filters on screens
  stay in place, because a pass may not have run yet, and they now agree with the status within one
  pass.
- **On the live instance, the first pass after this ships** sets back to `draft` every active
  objective whose period has not started. It does nothing else until 2027-01-01, when 2027's drafts
  start. 2026's annual objectives close on 2027-02-01 unless judged in January.
- **The cost:** the closing rule picks `missed`. A met objective nobody marked reads as missed after
  the window. The reason on the event says what happened, and *met* on the objective's page still
  corrects it, because a person's change is always allowed. A wrong default that is visible and
  corrigible was preferred to an objective left open for ever.

## Alternatives

- **Keep statuses manual and filter by date (ADR-0035's choice).** Rejected by the owner. Statuses
  that lag reality made lists and counts disagree, and they needed a click each January.
- **Close on the period's last day.** Rejected: the review happens after the period, and closing
  first hides what is being reviewed.
- **Close as `met` or `missed` from self-assessed progress.** Rejected: that automates the judgement
  ADR-0013 keeps human, and a threshold such as 70% would be invented.
- **Never auto-close, and leave the objective awaiting judgement for ever.** Offered to the owner and
  not chosen: an objective open for a year that ended keeps counting as current work.
- **A longer monthly window, 14 days.** Offered and not chosen. A month reviewed in its first week is
  the monthly review's own rhythm.
