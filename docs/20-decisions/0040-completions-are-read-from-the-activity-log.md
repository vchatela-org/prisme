# ADR-0040 · Read completions from the activity log, and keep the completion history beside it

**Status:** Accepted · 2026-10-29 · decided by the owner, 2026-10-29. Amends how
[W13](../40-workstreams/W13-backfill.md) and the capacity refresh read completions
([`16-sync.md`](../16-sync.md) §2). Changes no schema: `completion_history` was already keyed by the
completion.

## Context

Every capacity figure — each area's `actual_share`, the balance factor, Run hours, a ritual's
adherence — is built from `completion_history`. Since the move to the task tool's v1 API, that table
was filled from one endpoint, `GET /api/v1/tasks/completed/by_completion_date`. It lists tasks that
became **checked**.

A **recurring** task never becomes checked. Completing it moves its date, and the task stays open.
So every occurrence of a recurring task — the daily routine, the weekly preparation, the chores —
was invisible. An alignment review on 2026-10-29 measured it on the owner's instance: over the same
two months, `completion_history` held the endpoint's count, and the activity log
(`GET /api/v1/activities?object_type=item&event_type=completed`) held **about twice as many**
completions. **Every missing completion was a recurring occurrence.**

The consequences reach every number prisme measures:

- area shares and the balance factor are computed on biased data. An area whose work is mostly
  recurring read 0% where its true share was about a quarter;
- `ritual_adherence` for a ritual tied to its recurring task can never fill, because that task's
  completions never arrive. [ADR-0014](0014-lanes-outside-the-backlog.md)'s Ritual lane measures
  nothing;
- OQ-5's trigger (four weeks of adherence for one ritual) and OQ-7's trigger (three months of
  completion history for one process page's work) can never fire. Both are built on the completions
  that were missing.

The activity log has one entry per completion, occurrences included. It also has what the history
lacks: an entry per **un-completion**. Its entries carry the task id (`object_id`), the instant
(`event_date`), the project (`parent_project_id`), and a free-form `extra_data` that holds the title
and, on completion entries, the section. They do **not** carry a recorded duration.

## Decision

1. **The activity log is the source of which completions happened.** Both readers of completions —
   the backfill and the capacity refresh the full pass runs — read it through one function
   (`readCompletions`, `apps/sync/src/backfill/completions.ts`). The connector's
   `fetchCompletionEvents(since, until)` reads `GET /api/v1/activities` with `object_type=item`, one
   read for `event_type=completed` and one for `event_type=uncompleted`, bounded by `date_from`
   (inclusive) and `date_to` (exclusive), paged by `next_cursor`, at most 200 per page and 50 pages.
   Every page is parsed with Zod. An entry that is not an `item`, or not the event type its read
   filtered on, fails the read. The title in `extra_data` is sanitised like every other title
   ([ADR-0032](0032-completed-task-titles-are-recorded.md)).
2. **The completion history stays, as the record of the task at completion.** It carries what the
   log does not: a one-off task's recorded duration and section, and the exact `completed_at` the
   rows already hold. It is read over the same windows and merged by this rule:
   1. an **un-completion takes back** the latest completion of the same task before it, within the
      read. One with nothing before it in the read is ignored;
   2. per task, the history's entries **pair** with the log's remaining completions from the latest
      backwards, and never more than **one day** apart. A paired completion **is the history's
      entry**, unchanged: same key, same duration, same section;
   3. a log completion left **unpaired** is a completion of its own, keyed by the log's instant.
      This is a recurring occurrence, almost always;
   4. a history entry left unpaired **stands**. The log's reach depends on the plan (below), and
      history it no longer reaches must not disappear because a newer reader looked.
3. **Where an unpaired log completion is located:** the project the entry names. The section is the
   entry's own when it carries one. Otherwise it is the open task's current section, **only while that
   task is still in the project the entry names**. Otherwise the completion is located by project
   only. A task that has moved since is never guessed back into its old section. One full read of the
   open tasks per run supplies the current location.
4. **Both records are read one day wider than each window, either side.** Only completions keyed
   inside the window are returned. A pair can then never be split between two windows, so a
   completion checked just before a slice boundary and logged just after it is stored once.
5. **`completion_history` is unchanged.** Its key was already `(external_task_id, completed_at)`, one
   row per completion, chosen in 0006 because "a recurring task completes many times under one id".
   No migration is needed. Because a paired completion keeps the history's key, re-running the
   backfill over history stored by the earlier reader **adds the recurring occurrences and nothing
   else**. It cannot double-count the one-off completions already stored, even if the two records'
   instants disagree.

## Consequences

- **After this ships, the owner's instance needs one backfill re-run** over the history the log
  still reaches: `prisme-sync backfill --from <date>` with a `--from` **earlier than the cursor's
  start**. A `--from` inside the covered range resumes at the cursor's end and re-reads nothing. The
  daily capacity refresh fills the trailing four weeks on its own from its next full pass.
- **Recurring work now counts.** Area shares move, sometimes a lot. An area that read as starved
  because its work is recurring reads as what it is. The balance factor responds within the window.
  A ritual tied to its recurring task gets an adherence series, which is what OQ-5 and OQ-7 wait on.
- **A recurring occurrence has no recorded duration.** The log does not carry one, and copying the
  open task's current duration onto past occurrences would be a guess. So an occurrence's minutes
  come from the next tier: the declared duration of its ritual's process page, or the default
  estimate. Run time is therefore estimated unless the ritual is tied and its page declares a
  duration. The capacity screens already say how much of a reading is estimated.
- **The activity log's reach depends on the account's plan.** The plan's `activity_log_limit` is a
  number of days, or `-1` for no limit. On the owner's account the log reached about two months back
  without a limit being hit. On a plan with a limit, older recurring occurrences are simply not
  there. The backfill then records the completion history alone for those windows, as before. A
  window older than the log's reach returns nothing, not an error.
- **One un-completion case is bounded, not solved.** An un-completion is honoured only inside the
  read that holds both it and its completion (a 28-day slice plus a day either side). A completion
  stored by an earlier run and taken back in a later window stays stored. This was already true of
  the completion history reader, which never deleted a row.
- **One timing case is bounded, not solved.** If the two records' instants for one completion
  disagree by more than a day, or straddle the edge of a read, that completion can be miscounted by
  one. Where the instants agree, none of this arises.
- **Collaborators' completions.** The log reports every completion in projects the account can see,
  shared ones included. So did the completion history. The read does not filter by `initiator_id`,
  to keep parity. A shared project whose completions should not count is left unmapped, as before.
- **A completed task that was later deleted** is still in the log, and is now counted. The work was
  done.
- **Each window costs about three requests instead of one**, plus one full read of the open tasks
  per run. The backfill and the refresh are rate-limited reads already sliced into 28-day windows, so
  this fits the tool's limits.

## Alternatives

- **Drop the completion history and read the log alone.** Rejected. One-off completions would lose
  their recorded durations, which are the only real measurement of effort
  ([`12-scoring.md`](../12-scoring.md) §4). Every row stored by the earlier reader would be re-keyed
  by the log's instant: a second row wherever the two instants differ, which nothing documented rules
  out. History beyond the log's reach would also stop being refreshed.
- **Match the two records by exact `(task, instant)` only.** Rejected. Exact equality between "when
  the task was checked" and "when the log recorded it" is not documented. A miss turns into a double
  count of real one-off work, which is the failure this table's key exists to prevent.
- **Replace each window wholesale with what the two reads return.** Rejected. The log's reach is
  limited by plan, so a re-run after the log has aged would delete recurring occurrences stored while
  it still reached them.
- **Add a `source` column to `completion_history`.** Not needed. The pairing rule keeps the earlier
  rows' keys, so nothing has to tell the two readers' rows apart. Migration 0025, reserved for this
  change, is unused.
- **Take a recurring occurrence's duration from the open task.** Rejected for now: it applies today's
  value to past occurrences, and a later edit would rewrite them. A ritual's process page is the
  declared source for recurring work, and that tier already exists.
- **Filter by the account's own `initiator_id`.** Deferred. It changes what counts on shared
  projects, which is a separate decision from fixing what was missing.
