# FUP · 2026-10-29 · Completions are read from the activity log

**Agent:** Claude · **Duration:** one run · **PR:** [#207](https://github.com/vchatela-org/prisme/pull/207) · **Outcome:**
[ADR-0040](../20-decisions/0040-completions-are-read-from-the-activity-log.md). The backfill and the
capacity refresh now read the activity log and merge it with the completion history. A recurring
task's occurrences are counted from now on. No schema change.

## What was found first

- The alignment review of 2026-10-29 (finding D2) measured the owner's instance over about two
  months. `completion_history` held exactly what `tasks/completed/by_completion_date` returned. The
  activity log's completed items were **560**, against **288** rows. The **269** missing were all
  occurrences of recurring tasks. The rest were completions the history also had, plus a few
  un-completions and deleted tasks.
- **`completion_history` was already keyed by the completion**, `(external_task_id, completed_at)`.
  Migration 0006 chose that key for recurring tasks, and the store's integration suite already proves
  one task can hold many rows. So migration 0025, reserved for this change, is unused.
- The task tool's own API description says that completion entries in the log carry the section in
  `extra_data`. They carry no recorded duration. `date_from` is inclusive, `date_to` exclusive, and
  `next_cursor` is required in every response.

## What was done

- **Connector.** `fetchCompletionEvents(since, until)`: two filtered reads of `/api/v1/activities`
  (`object_type=item`, `event_type=completed` and `uncompleted`). Both are cursor-paged and bounded
  like completion history, and Zod-parsed: an entry that is not an item, or not the type its read
  asked for, fails the read. The title is sanitised. Recorded fixtures cover two pages of the log
  with a recurring task; a malformed fixture has a project entry. The recorded client serves the log.
- **Sync.** `apps/sync/src/backfill/completions.ts` holds the merge, as a pure function, plus the
  read that feeds it. The backfill and the capacity refresh both call it. The backfill report and
  both log lines count the completions only the log reported.
- **Docs.** `16-sync.md` §2, `12-scoring.md` §4, `10-model.md` §9, `19-how-it-works.md` §5 and §8,
  the ADR index, `STATUS.md`.

## Decisions taken

- **Keep the completion history, and pair it with the log.** Dropping it would lose one-off
  durations. It would also re-key every row the earlier reader stored by the log's instant, and
  nothing documented says the two instants agree. A paired completion is the history's entry
  unchanged, so a re-run adds the occurrences and nothing else.
- **Pair from the latest backwards, within one day, and read one day wider than each window.** This
  needs no exact equality, and a pair cannot be split between two slices. A pair more than a day
  apart, or straddling a read's edge, can be miscounted by one; the ADR says so.
- **An un-completion takes back the completion before it, within the read.** Without that, a task
  ticked by mistake and reopened would count. A completion taken back in a later window than the one
  that stored it stays stored, as it always did.
- **Never replace a window wholesale.** The log's reach depends on the plan, so a re-run after it has
  aged would delete occurrences stored while it still reached them.
- **No duration for an occurrence.** The open task's current duration would be applied to past
  occurrences and rewritten by a later edit. An occurrence falls through to its ritual's declared
  duration, or to the default.
- **Section: the entry's own, else the open task's while it is still in the same project.** A task
  that has moved is located by project only. One full read of the open tasks per run supplies this.
- **No `initiator_id` filter.** It keeps parity with the history, which also listed collaborators'
  completions. Changing what counts on shared projects is a separate decision.

## Checks run locally

Node 24.21.0, where the repository pins 26, so CI is what validates the runtime. The connector's
contract tests (ten new) and the sync unit suites (the new `completions.test.ts`, plus the
backfill, capacity-refresh and adoption suites) pass. Root typecheck, eslint per package group,
prettier and the privacy scan with the local supplement are listed in the pull request. The
integration project was left to CI: no SQL changed, and the shared local test database was in use
by other branches' migrations.

## After merge

- **Re-run the backfill once on the live instance** with a `--from` earlier than the cursor's start
  and inside the log's reach. A `--from` inside the covered range resumes at the cursor's end and
  re-reads nothing. The daily refresh fills the trailing four weeks on its own.

## Not done

- No screen says how far back the activity log reaches.
- Un-completions are not retracted across windows.
- Collaborators' completions on shared projects still count, as before.
