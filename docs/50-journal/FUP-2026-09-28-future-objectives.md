# FUP · 2026-09-28 · An objective whose period has not started is kept out of sight

**Asked:** the owner adopted objectives set for a period that has not started yet, and found them
`active` and at the top of the Objectives screen. They are not what the current period is for, so
the owner did not want them shown directly. The owner chose that adoption should make such an
objective a **draft**.

## What was there

- **Adoption always set `active`.** The insert hard-coded it, and ADR-0033's amendment from the
  same morning wrote "Status `active`". An objective written on the Objectives screen starts as a
  `draft`, because that is the API's default. So a page adopted ahead of its period counted as work
  under way, while the same objective written by hand did not.
- **The screen sorts periods newest first**, so a future year led the page. It also counted towards
  *Active objectives* and appeared among the objectives with nothing behind them. The review's
  progress step, which asks for `status=active`, listed it too.
- **Status alone could not fix the screen.** A draft for next year still sorted first. So the screen
  had to decide by date as well.

## What was done

- **The domain** gains `adoptedObjectiveStatus(type, period, today)`: `draft` while the period's
  first day is after today, and `active` otherwise.
- **The API.** *Adopt* passes the instance's calendar day to the store, the same `calendarDayIn`
  the queue's *Ended* filter uses, and the store seeds the status from it.
- **The Objectives screen** splits objectives into those whose period has started and those still
  to come (`isUpcoming`, `splitUpcoming` in `objectives-view.ts`). The periods to come are folded
  under **Upcoming** at the bottom, in a closed `<details>` that names how many there are and for
  which periods. The counts, the key-result tile and the orphans only read the started ones. A new
  empty state covers a screen where every objective is still to come.
- **The review** leaves upcoming objectives out of its progress step and out of the objectives in
  its orphans step.
- **[ADR-0033](../20-decisions/0033-a-store-area-column-names-an-entry-area.md) point 5 amended**,
  on the owner's decision.
- **Tests:**
  - domain units for before the period, its first day, and a period already over;
  - web units for `isUpcoming` at both edges and for an unreadable period, and for the split
    ignoring status;
  - an API integration test that adopts next year, next month and this month on the pinned clock,
    then adopts next month again on its first day.

## Decisions taken

- **Draft on adoption is the owner's choice.** Keeping `active` and changing only the screen was
  offered. They chose `draft`, which matches an objective written by hand.
- **The screen hides by date, not by status.** An objective can be `active` ahead of time: adopted
  before this change, or set so by hand. A date rule also brings an objective back on the first day
  of its period with nothing to change. Status still says whether the owner has committed to it.
- **A period already over is adopted `active`.** Whether it was met is a review's judgement, not
  adoption's.
- **Nothing makes a draft `active` later.** Committing to an objective is a person's decision. The
  review's *Author objectives* step already counts drafts, and that count is the reminder.
- **The objectives already adopted are left as they are.** Their `active` status is recorded, and a
  bulk rewrite would be prisme deciding for the owner. The screens hide the future ones anyway, and
  *draft* on an objective's page sets one back.
- **The web's `today` stays UTC**, as the rest of that screen already reads it. The API's adoption
  uses the instance's timezone. They can differ for an hour or two around midnight on the first day
  of a period. That only moves when the screen shows the objective, never a stored value.

## Surprises

- **Two creation paths for one entity gave it two starting statuses.** Nothing had compared them.
  ADR-0033's amendment wrote `active` without a reason. The screen's author form relied on the
  API's default, so no line of code said `draft` either.

## Follow-ups

- **The KPI dashboard and the Year Review still show every objective's attainment**, whatever the
  window. `measure.ts` lists all objectives and does not filter by the requested range. A 2027
  objective therefore appears on the 2026 Year Review, at no progress. Filtering by overlap with the
  window is the natural fix, and it is separate from this change.
- **For the owner:** mark *draft* on the future objectives already adopted, if the badge matters.
  Where they show is already handled.

## Specs touched

- [ADR-0033](../20-decisions/0033-a-store-area-column-names-an-entry-area.md) point 5, and its row
  in the ADR index.
- [`13-migration.md`](../13-migration.md) §4 and [`18-user-guide.md`](../18-user-guide.md) §5.
