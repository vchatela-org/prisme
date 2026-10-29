# FUP · 2026-10-29 · An objective follows its window

**Agent:** Claude · **Duration:** one run · **PR:** — · **Outcome:**
[ADR-0037](../20-decisions/0037-an-objective-follows-its-window.md). Every pass moves an open
objective to the status its window gives it: active from the period's first day, still open through a
review window, missed if nobody judged it by the end of that window. The Objectives screen says until
when a closing objective can be judged.

## What was found first

- Statuses moved only by hand. ADR-0033 point 5 said so in as many words (*nothing makes it `active`
  later*), and ADR-0035 listed *change the status on a timer* among its rejected alternatives. Both
  are owner decisions, so the reversal is recorded as a superseding ADR rather than done quietly.
- On the live instance (counts only), two objectives were `active` for periods that have not
  started: one annual for a later year, and next month's. Nothing would ever have moved them.
- A key result's anchor (S15) already followed the status: `keyResultAnchorDeadline` wants an
  `active` objective whose period has started. During the review window that is still true, so the
  anchor keeps its deadline and is not closed. Once the objective is judged, the reconciler stops
  managing the task and leaves it where it is.

## What was done

- **Domain.** `OBJECTIVE_REVIEW_GRACE` (annual: to 31 January; monthly: seven days),
  `objectiveWindowOf`, `objectivePhaseOf` (`upcoming`/`running`/`closing`/`ended`) and
  `objectiveWindowSteps`, the rule as pure steps with reasons. A draft whose whole window has passed
  takes both steps, active then missed, so its history says it was under way.
- **Sync.** `objective-windows/`: `advanceObjectiveWindows` and its PostgreSQL store. Each step is a
  compare-and-set on the status read, plus a `status_changed` event (`actor = 'sync'`,
  `after.reason`), in one transaction. It runs first in every pass: in `main.ts` for the CronJob and
  in the API's runner for `POST /sync`. A failure there is logged and the pass goes on.
- **API.** The objective DTO carries `window` (`startsOn`, `endsOn`, `judgeBy`). The `PATCH` route
  description states the rule.
- **Web.** `awaitsJudgement` and `windowLine`. A closing objective's card reads *judge it met or
  missed by …* in the warning colour, and the screen counts *Period over, to judge*.
- **Docs.** `10-model.md` (Objective), `16-sync.md` (the step), `18-user-guide.md` (Objectives),
  `19-how-it-works.md` (the object row and the yearly cadence), ADR-0033 and ADR-0035 status lines,
  and the ADR index.

## Decisions taken

- **The grace periods** are the owner's choice: the end of January for a year, and seven days for a
  month.
- **Auto-close as `missed`, with a reason.** This is the owner's choice over *leave it awaiting
  judgement*. The reason on the event is what keeps a closed-by-window `missed` distinguishable, and
  *met* stays one click away.
- **Back to `draft` when active too early.** ADR-0033 deliberately left those alone. Doing it now is
  what *auto start on their expected windows* means for an objective that was switched on early.
- **No new event kind and no migration.** `status_changed` already exists. The reason rides in
  `after`, which is `jsonb`.

## Checks run locally

Node 24.21.0, where the repository pins 26, so CI validates the runtime: domain objective tests
(phases at every boundary, both grace rules across a year end and a short month, every step, judged
objectives never moving), the step's unit tests (ordering, a lost race, `plan`), its PostgreSQL suite
(statuses and events land together, nothing twice, a person's change wins), the web view tests, and
the whole suite as listed in the pull request.

## Not done

- No MCP tool reports `window`. The objectives tools return the DTO, so it is present, but no
  description mentions it.
- The Year Review and the monthly review do not yet list *to judge* as a step of their own. The
  Objectives screen is where the count is.
- Nothing notifies anybody on the last day of a review window.
