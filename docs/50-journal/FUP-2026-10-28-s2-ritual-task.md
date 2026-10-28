# FUP · 2026-10-28 · S2: a ritual is tied to its recurring task, or recorded by hand

**Agent:** Claude · **Duration:** one run · **PR:** [#185](https://github.com/vchatela-org/prisme/pull/185) · **Outcome:** a ritual's recurring task
is chosen on Rituals, a *Link* from the queue actually binds it, and a habit that is not a task is
recorded by hand on its row. S2 is closed.

## What was found first

S2 said the task could be tied "only through the adoption queue's *Link*". It could not be tied at
all. A *Link* decision writes `entity_link`, and the only thing that turns a link into an
`entity_external_ref` binding is the reconciler, which binds initiatives' anchors and nothing else.
Adherence is read through that binding (`loadRituals` in the backfill store), and no production
code ever wrote one for a ritual. Every ritual read *not measured yet*, whatever had been linked.
And an unlabelled recurring task never reaches the queue in the first place: the classifier reads
it as Run, which is left in place.

## What was done

- **`ritualPeriodOf`, `ritualOpportunities` and `ritualTaskLink` in `@prisme/domain`.** The period
  rule (Monday week, calendar month, quarter or year; seven chances a week for a daily habit, one
  otherwise) moved out of the backfill so the API names the same period the refresh buckets by.
  The backfill's `adherence.ts` now calls it.
- **Its recurring task.** `PATCH /rituals/:id` and `POST /rituals` take `externalTaskId`. The API
  store's `tieRitualTask` writes the binding (`prisme_kind = 'ritual'`) and a human link, in the
  ritual write's transaction. Another task replaces it, `null` unties it, and either removes the
  old binding *and* its link, so the task can be offered again. A task another entity holds is a
  `409`, and the whole write rolls back, the ritual's other fields included.
- **`GET /task-tool/recurring-tasks`**, scoped `write:ritual` like the write it serves. It reads the
  task tool live through the `ExternalDirectory` port, as the area-mapping picker does. It returns
  an identifier, a title, the area the task's location maps to (a section's mapping before its
  project's, as attribution reads them) and what in prisme holds it.
- **The queue's *Link* binds.** A task linked to a ritual becomes its recurring task in the
  decision's transaction. It is refused (`409`) while the ritual has another task, or while
  another entity holds the task. The decision's `bound` is now read from the binding instead of a
  hard-coded `false`.
- **Done this period.** The ritual DTO carries `externalTaskId` and `currentPeriod` (period start,
  opportunities, what is recorded so far). A ritual with no task shows *This week: 3 of 7 days*
  (or *This month: not yet*) with **Done** and **Undo**. They write the absolute count through the
  existing `POST /rituals/:id/adherence`. A ritual with a task gets a `409` there: the capacity
  refresh rewrites its window from the task's completions, and a hand-recorded period would be
  overwritten without a word.
- **The web.** *Its recurring task* in the ritual form: open recurring tasks, this area's first,
  one held elsewhere shown and disabled, and *None — record it by hand here*. When the tool cannot
  be read, the form says so and keeps the task the ritual has. Each row says what it is measured
  from. The queue's *Link* refusal is worded for a task as well as a page.

## Decisions taken

- **Bound by the API, not left for the reconciler.** `entity_external_ref` already has several
  writers in the API (`linkExternal`, a capture's promotion, S1's conversion). A ritual has no
  outward write and no reconciler action that could bind it, so a pending link would never be
  honoured.
- **No schema change.** The binding is `entity_external_ref`, which the backfill already joins.
  `ritual` gains no column, and there is no migration.
- **At most one task per ritual, and a different one is refused on *Link*.** This is
  `ritualPageLink`'s rule for the process page, for the same reason: replacing would undo a choice
  made on Rituals. Rituals itself replaces freely, because that is where the choice is made.
- **Absolute counts, not increments.** *Done* sends the new total for the period the API named. A
  double click writes the same row twice instead of counting twice.
- **No backfill on tie.** A newly tied task counts from the next daily capacity refresh, over its
  four-week window. Older periods fill in only with `prisme-sync backfill`. Reconstructing history
  from the API would put the backfill's attribution in a second process.
- **The picker offers every open recurring task**, not only the ritual's area: a recurring task is
  usually named for the action and may sit in another area's project. Subtasks are included.

## Checks run locally

Node 24.21.0 (the repo pins 26; CI runs that):
- typecheck of `apps/api`, `apps/sync` and `apps/web`;
- the unit suites of `packages/domain`, `apps/api`, `apps/sync` and `apps/web` lib, including the new
  `lanes.test.ts` (domain) and `rituals-view.test.ts` (web);
- the whole integration project against `prisme_test` (373 tests), including nine new ritual tests
  (`integration.test.ts`) and two new *Link* tests (`adoption.integration.test.ts`);
- eslint per package, prettier, and the privacy scan with the local supplement.

The local harness was driven in a browser: a daily ritual defined with no task, *Done* twice and
*Undo* once (*This week: 1 of 7 days*, latest 14 %), and the picker's *Todoist could not be read*
state — the harness has no task tool, so the picker's list is covered by `rituals-view.test.ts`
and the API's integration test instead.

## Not done

- The adherence of a newly tied ritual is not reconstructed at once; see *Decisions*.
- No MCP tool ties a task or records a period.
- S3 (a review session counting as the review ritual) is untouched. *Done this period* is the
  by-hand answer until it is built.

## Specs touched

- `docs/10-model.md` §9, `docs/11-ownership.md` §8 (a new row for the ritual's task, and the
  adherence row), `docs/13-migration.md` §5 (recurring task), `docs/18-user-guide.md` §2.5–2.6,
  `docs/19-how-it-works.md` §3.4, §4, §8 and S2.
