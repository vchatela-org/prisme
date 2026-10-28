# FUP · 2026-10-28 · S3: a ritual can be fulfilled by closing its review

**Agent:** Claude · **Duration:** one run · **PR:** _pending_ · **Outcome:** a ritual's *Measured
from* offers *Closing the weekly review in prisme*, and closing a session of that cadence is the
period's completion. S3 is closed.

## What was found first

Closing a review session took a capacity snapshot and touched nothing else. The *weekly review*
ritual — the habit prisme exists to support — could be measured only by tying it to a recurring task
that mirrors the review, or by pressing *Done* after the review: two records of one act. The session
table already had everything needed (`cadence`, `completed_at`), and a closed session can never be
reopened (`completed_at` is only ever set), so the closes are a stable record to count from.

## What was done

- **`ritualMeasure`, `reviewCanFulfil` and `reviewAdherence` in `@prisme/domain`.** A ritual has one
  source: `task`, `review` or `hand`. `reviewAdherence(cadence, closedAt, now)` returns the whole
  series from the instants sessions were closed, on the periods `ritualPeriodOf` names.
- **Migration 0020** adds `ritual.fulfilled_by_review` (default `false`) with a CHECK refusing it
  for a daily ritual. It has a written reversal procedure.
- **The API.** `POST /rituals` and `PATCH /rituals/:id` take `fulfilledByReview`; the DTO gains it and
  `measuredFrom`. Closing a session (`PATCH /reviews/:id` with `complete`) rebuilds the series of
  every ritual of that cadence its review fulfils; choosing the review on a ritual rebuilds that
  ritual's at once, so sessions closed before count. `422` for a daily ritual or a task beside it
  (untie it in the same write), on create, on update, and on a cadence change to daily. A hand-recorded
  period is `409`, and so is a queue *Link* of a task to such a ritual.
- **The backfill** reads the column and no longer reports such a ritual as *unmeasurable*; it still
  writes nothing for it.
- **The web.** *Its recurring task* became *Measured from*: *None — record it by hand*, *Closing the
  weekly review in prisme* (not offered for daily), or a recurring task. It is offered even when
  Todoist cannot be read. The row says *Done each time the weekly review is closed in prisme* and has
  no *Done*/*Undo*. Closing a review revalidates Rituals and KPI, and its toast says so.

## Decisions taken

- **The ritual's own cadence, not a chosen one.** A weekly ritual is fulfilled by the weekly review.
  The periods line up by construction (both are `ritualPeriodOf`), and there was no case for a
  weekly ritual counted by monthly reviews. A boolean, not a cadence column.
- **Rebuilt whole on every close, not incremented.** The series is a pure function of the closed
  sessions, so a close whose rebuild failed is healed by the next one. That is the level-triggered
  rule the capacity refresh follows for a task. It runs after the close rather than in its
  transaction for the same reason: the close is the fact, the series is derived.
- **From the first close, zeros between, the current period only once done.** A skipped week is the
  observation; a week not over yet is not a miss (the `latestAdherencePct` contract on the web).
  Nothing before the first close is written, so periods recorded by hand before the switch keep what
  they recorded.
- **One source per series, refused rather than resolved.** Two sources would write the same periods
  from two places. The API refuses a task beside the review instead of untying it silently, and the
  form sends both fields so switching is one write.
- **Discarding is unaffected.** Only an open session can be discarded, and an open session counts for
  nothing.

## Checks run locally

Node 24.21.0 (the repo pins 26; CI runs that):
- root `pnpm typecheck`;
- the whole `unit` project (2290 tests, 139 files), including new cases in the domain's
  `lanes.test.ts`, the web's `rituals-view.test.ts` and the backfill's `run.test.ts`;
- the whole `integration` project against `prisme_test` (378 tests, 16 files), including three new
  ritual tests, a *Link* refusal and a backfill store read;
- eslint per package, prettier, and the privacy scan with the local supplement.

## Not done

- No MCP tool sets `fulfilledByReview`.
- Changing a fulfilled ritual's cadence leaves the old cadence's rows in place, as it does for any
  ritual.

## Specs touched

- `docs/10-model.md` §9, `docs/11-ownership.md` §8 (a new row, and the adherence row),
  `docs/18-user-guide.md` §2.5, `docs/19-how-it-works.md` §3.4, §8 and S3.
