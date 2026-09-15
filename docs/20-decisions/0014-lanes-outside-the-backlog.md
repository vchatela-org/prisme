# ADR-0014 · Run, Signals and Rituals are lanes outside the backlog

**Status:** Accepted · 2026-09-15

## Context

A single task list ends up doing three unrelated jobs at once: recurring upkeep, machine-generated
notifications, and real project work. Mixed together they are indistinguishable, and the list stops
being usable — the feeling of "I can't keep up" is largely that mixture rather than the volume.

Scoring them together is worse. Upkeep is not an outcome, notifications are not work, and habits are
not tasks — a habit task is never "done", so it either recurs forever or is closed dishonestly.

## Decision

Four lanes, each with its own treatment:

| Lane | What it is | Treatment |
|---|---|---|
| **Change** | Initiatives | The ranked backlog. The only scored lane |
| **Run** | Recurring upkeep | Budgeted in **hours per week**, not a share. Excluded from ranking |
| **Signals** | Machine-generated notifications | Own project, excluded from ranking *and* capacity. Cleared in batches |
| **Ritual** | Habits | Measured by **adherence over time**, never by completion |

**Run counts toward capacity; Signals do not.** Excluding upkeep from the capacity measurement would
hide exactly the pattern the system exists to reveal — upkeep quietly consuming most of the
available time. Excluding notifications is right because responding to an alert is not a choice
about how to spend a week.

## Consequences

- The ranked backlog contains only comparable things.
- Upkeep becomes a number against a budget instead of an invisible drain.
- Habits get the measure that actually reflects them, which is how a stated goal sitting near zero
  becomes visible.
- Every incoming item needs a lane assignment. Mostly inferable from structure, occasionally a
  judgement.
- Run's budget is expressed in hours while areas use percentages. Deliberate — upkeep is naturally
  measured in time, and capping it is more useful than giving it a share.

## Alternatives

**One list, priority flags to separate.** Rejected: the flags are the thing that has already
decayed, and it is the current situation.

**Treat Run as an area with a percentage.** Rejected: an hours cap is the more natural control, and
upkeep should not compete for a share of intentional time.
