# W04 · 2026-09-17 · Reconciler

**Agent:** Claude Opus 5 (workstream agent) · **Duration:** one session · **PR** #21 ·
**Outcome:** complete

## What was done

The reconciler, in four layers with one rule between them — **everything difficult is decided by a
pure function**:

| Layer | What it is |
|---|---|
| `apps/sync/src/reconcile/` | the planner. `plan(desired, observed, lastApplied, config) → Plan`, plus the ownership rules, the intent channel, the priority mapping, the roll-up and the plan's rendering. No I/O, no clock |
| `apps/sync/src/apply/` | the executor, and the `ReconcilerStore` port it records through |
| `apps/sync/src/state/` | the one implementation of that port, in SQL |
| `packages/connectors/src/write/` | the write path to the task tool, behind `@prisme/connectors/write` |

`prisme-sync plan` and `prisme-sync apply` are the CLI; `@prisme/sync` exports `reconcile` so the
API's force-sync button runs the same function rather than a second implementation of it.

Every item in the brief's *Definition of done* has a test:

- **the adversarial test** — exhaustive over the closed input space (two origins × eight statuses ×
  three link states × present/absent × labelled/unlabelled = 192 cases): an adopted entity produces
  zero creates, and the only inputs that produce one satisfy guard 2. The planner calls the domain's
  own `mayCreateExternally` rather than restating the condition, so the guard cannot drift into two
  definitions;
- **idempotence, and better** — the planner's output is applied to an in-memory world and re-planned;
  a world of conflicts, a capture, a create and a subtree settles and stays settled. A reconciler
  that rewrites the same field every fifteen minutes passes a single-plan assertion and fails this;
- **the conflict matrix** — every prisme-owned anchor field, edited externally, produces a conflict
  with a ledger row and a corrective write; every sanctioned edit produces a request or nothing;
- **overwrite protection** — the four states a subtask's priority can be in;
- **the threshold** — `apply` refuses before it writes anything;
- **the write freeze** — `SYNC_WRITE_ENABLED=false` makes `apply` a no-op that says so, and the
  writer it is handed in that state cannot reach an API at all;
- **purity, enforced by lint** — `reconcile/**` may import types from anywhere and *values* from
  nothing that does I/O. The rule was watched fail on a Node builtin and on a client import before
  it was trusted.

Metrics were written as the code was written, not after: actions by tag, conflicts, duration,
last-success, and `prisme_sync_drift_objects`.

## Decisions taken

**Every pass reads the task tool in full; the incremental read measures drift.** A level-triggered
planner compares full state to full state, and an anchor missing from an incremental response
("unchanged") is indistinguishable from one missing from a full response ("deleted") — opposite
answers from the same input. The incremental stream keeps the job the spec cares most about: any
object the full view finds changed that the stream never mentioned is one the incremental path would
have missed, which is exactly `prisme_sync_drift_objects`. `plan` skips it, because advancing a
cursor is a side effect. [`16-sync.md`](../16-sync.md#incremental-versus-full) now says so.

**`last_applied` is what separates an update from a conflict.** Same write either way; different
line in the plan and a ledger row for one of them. A value prisme has never written differs from
prisme's intent without anyone having overridden anything — that is an update, not a conflict.

**Propagation into a subtask's priority starts on the tool's default.** The domain's `mayOverwrite`
answers `false` when prisme has never written a field, which is correct and leaves the question of
how propagation ever begins. It begins on a subtask still at the priority every task is created
with: there is no decision there to protect, and [`10-model.md §6`](../10-model.md#6-task) states
the promise as *never overriding a priority set by hand*. Known cost, written where the code is: a
priority deliberately set to the lowest value is indistinguishable from one never set, and prisme
claims it once.

**prisme never completes and never deletes an external object.** Completion is the task tool's
(`11-ownership.md` §4), so it flows inward and moves the initiative to `review`. There is no
`completeTask` and no `deleteTask` in the write path — absent rather than guarded, so no bug can
reach for one.

**A captured initiative starts with placeholder estimates.** The intent channel says *make this an
initiative* and nothing about size or value, and the four scoring inputs are not nullable. The
middle of the scale ranks it in the middle of the inbox, where a human replaces all four at triage.

**The label vocabulary is a constant, not configuration.** The anchor label and the
`prisme:status:<status>` request prefix are product vocabulary with defaults in code and a
parameter on the planner. If an instance needs different ones they become environment variables in
W00's schema; inventing two variables nobody has asked for was not worth it.

**SQL is written as tagged templates.** `packages/db/src/schema` is deliberately empty and belongs
to another workstream, so there are no Drizzle tables to build a query from. Tagged templates are
parameterised by the driver — the same style as the advisory lock and the readiness probe — and
nothing in this workstream concatenates a value into a statement.

## Surprises

**Drizzle replaces the date handling on the client it wraps.** `createDatabase` returns both a
Drizzle handle and the underlying driver, and constructing the Drizzle handle swaps the
`timestamptz` serialiser *and* parser on the shared client for the identity function. The
consequence for any tagged-template query on that client: passing a `Date` throws a `TypeError`
from inside the socket writer naming neither column nor statement, and reading a timestamp back
yields PostgreSQL's text form rather than a `Date`. The store now sends ISO-8601 text and parses
both forms on the way back. **Nothing in a type checker or a test against a fake store could have
shown this** — it took running a pass against a real database.

**A column exactly as wide as its widest value has no gap after it.** `conflict` is eight
characters and the tag column was eight wide, so every conflict line read `conflictanchor`. Found by
reading real output; the plan is a user interface and it is now checked like one.

**Capturing a labelled task lowers its priority.** An initiative in `inbox` maps to the lowest
anchor priority, so the pass after a capture writes that priority to the task someone just
labelled. It follows from the documented mapping and is correct; it is also the kind of thing worth
seeing once before it happens to a real backlog.

**The append-only triggers are real.** A throwaway reset script tried `DELETE FROM event_log` and
the database refused it, exactly as W01 intended.

## Follow-ups

| What | Who |
|---|---|
| **The live dry run against real data is a human step** and was deliberately not attempted here: step 7 of [`13-migration.md §5`](../13-migration.md#5-sequence), read by hand before the freeze is lifted. What was rehearsed instead is the whole path against a local database and a recorded task tool — plan refused by the threshold, apply creating, binding, capturing, mirroring and advancing the cursor | human |
| `POST /sync` calls `reconcile` from `@prisme/sync`, behind the same advisory lock | W05 |
| The planner already honours a decided link (`entity_link` with no reference yet) and emits `adopt`. The queue that writes those rows is still to come | W12 |
| `task_mirror` is refreshed when an anchor's roll-up changes, not on every pass. Capacity actuals may want a completer mirror | W13 |
| The date-handling trap above deserves a note in `@prisme/db`, whose `createDatabase` causes it | W00 |
| The document tool is read by nothing in this workstream: prisme writes nothing to it, and the watermark is carried in the cursor untouched | W12/W15 |

## Specs touched

- [`16-sync.md`](../16-sync.md#incremental-versus-full) — a subsection stating what the reconciler
  reads and why, and what the incremental read is now for.
- [`apps/sync/CLAUDE.md`](../../apps/sync/CLAUDE.md) — the directory shape, and the lint rule that
  enforces the pure/impure split.

## Privacy

Fixture data only: invented English titles, obviously synthetic ids (`task-0001`, `init-001`), and a
`prisme.example` base URL. No plan output from a real workspace appears anywhere in this branch —
the local rehearsal ran against invented rows in a throwaway database, and its script was not
committed. The deny-list scan and `gitleaks` are green.
