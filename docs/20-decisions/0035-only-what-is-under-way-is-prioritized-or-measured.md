# ADR-0035 · Only what is under way is prioritized or measured

**Status:** Accepted · 2026-09-28 · decided by the owner, 2026-09-28

## Context

Earlier the same day ([#122](https://github.com/vchatela-org/prisme/pull/122), ADR-0033 point 5
amended), objectives for a period that had not started were kept out of the Objectives screen's
counts and orphans and out of the review. The owner then made it a rule for every process: *"All
processes (prioritization, KPI etc.) must all apply only on active/ongoing activities, whatever the
form they are."*

An audit against the code found three places where the rule did not hold:

1. **Selection did not know about dates or projects.** `selectNowSet` read an initiative's status,
   blockers and size. It never read `earliest_start`, which only the schedule engine used, and it
   never read the status of a project. So an initiative that may not start until next year, or one
   in a paused project, could be offered a `now` slot and was queued in Focus's *Up next*.
2. **The Backlog ranked the same work** among work under way. `rankById` numbered every scored
   initiative.
3. **KPI and Year Review attainment listed every objective**, whatever the window. `measure.ts`
   read all objectives and did not filter by the range it was asked for, so next year's objectives
   appeared on this year's review at no progress, and so did drafts.

The other forms already followed the rule. A retired area is not ranked (`isRankable`). Capacity
counts completions that happened, and adherence is recorded only for periods that happened. A ritual
carries no start and no status.

## Decision

**Work is prioritized and measured only while it is under way.** What *under way* means depends on
the form, and each form has one predicate in `@prisme/domain`:

| Form | Under way when | Predicate |
|---|---|---|
| Objective, on a screen | its period has started | `isUpcoming` (web, #122) |
| Objective, in a measurement over a window | its period overlaps the window, and it is not a draft | `objectiveCountsIn` |
| Initiative | its `earliest_start` is not after today, and its project, if any, is active | `notUnderWay` |
| Area | it is active | `isRankable` |

"Today" is the instance's calendar day, in its timezone.

1. **Selection neither offers a slot to, nor queues, an initiative that is not under way.** It is
   placed `unchanged` in `untouched` with the reason `not_started` or `project_inactive`, so it is
   left out of Focus's *Up next* and out of the review's refill step. **Work already `now` keeps its
   slot.** A person put it there, and demotion is a review's decision
   ([`12-scoring.md`](../12-scoring.md) §5.1).
2. **It is scored and not ranked.** A score describes the initiative, so it is still computed and
   shown. It gets no rank, and the rest keep contiguous positions in the method's order. The Backlog
   says why in the rank column, and `GET /backlog` returns the reason as `notUnderWay`. The score
   history (`rescore`) is unchanged.
3. **A measurement over a window counts only the objectives under way in it.** `GET /kpi` reports
   the attainment of an objective whose period overlaps `from`–`to` and which is not a draft. A draft
   was never under way. A met, missed or dropped objective was, and its review reads it. The Year
   Review keeps the year it reviews, since its window runs three years back for the charts.
4. **Nothing is stored and nothing moves.** Each item comes back on its own when its day comes, its
   period starts or its project resumes. No status is rewritten to express any of this. The status
   is still what a person decided, and *under way* is read from dates and containers on every
   request.
5. **The orphan lists follow.** In-flight work with no objective leaves out work not under way,
   because it takes none of the period.

## Consequences

- **`selectNowSet` takes a fourth argument**, the `UnderWayContext` (today and each project's
  status), and it is required. A caller cannot forget it and silently get the old behaviour.
- **The ranking reads every project on each request**, one page. For one person's projects this is
  a few dozen rows.
- **A paused project now means something.** Before this, `paused` changed nothing anywhere. Pausing
  a project now takes its queued work out of the selection and the ranking until it is active again.
- **Selection's reasons gain two values**, in the API, the web contract and the MCP `focus_now`
  manifest. The web's wording covers them, although Focus never shows an `untouched` row.
- **An anchor's priority is unchanged.** The reconciler reads statuses as they are, not selection
  ([`apps/sync/src/reconcile/priority.ts`](../../apps/sync/src/reconcile/priority.ts)). A `next`
  initiative that is not under way keeps `medium` until someone changes its status.
- **The timeline still plans it.** The schedule engine answers *when can it run*, and
  `earliest_start` is one of its constraints. Planning future work is its job, not prioritizing it.

## Alternatives

- **Change the status instead**: move work that is not under way to `later`, or objectives to
  `draft`, automatically. Rejected, because it rewrites a person's decision on a timer. The status
  would then say two things at once, and on the start date nothing would move it back.
- **Filter in the scoring method.** Rejected, because the method is a plugin
  ([ADR-0006](0006-pluggable-scoring.md)). A rule every method must repeat is a rule some method
  will miss, and the score's history would gain gaps that mean "not yet" rather than "not scored".
- **Hide it from the Backlog entirely.** Rejected, because the Backlog is where everything is
  listed, `later` included. Work that disappears until its day comes cannot be edited or re-dated
  in the meantime.
- **Leave `paused` out of the rule.** It was considered, since the owner's words were about dates.
  They said *active* too, though, and a paused project with work still offered for `now` is the
  same mismatch as a future objective counted as active.
- **Filter attainment in the web.** Rejected: the MCP `kpi` tool and any other reader would then get
  the unfiltered list. The API applies the rule, and the Year Review only narrows the window to its
  own year.
