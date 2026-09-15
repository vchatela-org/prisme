# W04 · Reconciler

**Depends on:** W01, W03 · **Wave:** 2
**Files you may touch:** `apps/sync/**`, `packages/connectors/write/**`

## Why

This is where prisme's decisions reach the outside world, and the only place that can corrupt real
data. It is also the component whose predecessor failed — by being event-driven, per-project, and
never finished.

## Read first

- [`../16-sync.md`](../16-sync.md) — the whole document
- [`../11-ownership.md`](../11-ownership.md) — the field-by-field contract you implement
- [`../13-migration.md`](../13-migration.md) — the four no-duplicate guards
- [ADR-0009](../20-decisions/0009-level-triggered-reconciliation.md) ·
  [ADR-0010](../20-decisions/0010-adopt-never-creates.md) ·
  [ADR-0008](../20-decisions/0008-field-level-ownership.md) ·
  [ADR-0020](../20-decisions/0020-sync-cadence.md)

## Scope

1. **The planner — a pure function**: `plan(desired, observed, lastApplied) → Action[]`. Every
   difficult decision lives here; the rest is thin I/O.
2. **Action tagging**: `create | adopt | update | skip`, plus `review` and `conflict`. Counts
   summarised at the end of a plan.
3. **The no-duplicate guards**: only `origin = created_in_prisme AND external_ref IS NULL` may
   produce a `create`; `apply` refuses a plan exceeding `SYNC_CREATE_THRESHOLD`.
4. **Write path**: anchor creation and update (title, project/section, priority, deadline, label,
   description backlink with the managed-fields marker); status→priority mapping; completion.
   Idempotency keys on every write, so a retry after a timeout cannot apply twice.
5. **Overwrite protection**: propagate priority to subtasks only where the current value equals
   `last_applied`. Otherwise the field has been touched by hand and becomes permanently the user's.
6. **Conflicts**: detect changes to prisme-owned fields, revert, record in the ledger.
7. **The intent channel**: the label and completion actions in
   [`../16-sync.md`](../16-sync.md#the-intent-channel), each consumed after being honoured —
   including removing the request label.
8. **Roll-up**: progress, open task count, last activity written back to prisme.
9. **Two entrypoints, one library**: the CronJob binary and the API's in-process `POST /sync`,
   behind a PostgreSQL advisory lock.
10. **Drift detection**: the daily full pass reports `prisme_sync_drift_objects`.

## Out of scope

The adoption queue UI and identity resolution (W12) · capacity backfill (W13) · the read path (W03)
· authentication on `POST /sync` (W14).

## Contract

```ts
export function plan(desired, observed, lastApplied, config): Plan;  // pure
export async function apply(plan, clients, db): Promise<ApplyResult>;
export async function reconcile(opts: { mode: 'plan' | 'apply'; full?: boolean }): Promise<Result>;
```

CLI: `prisme-sync plan` and `prisme-sync apply`, exit non-zero on failure.

## Definition of done

- **The adversarial test**: an adopted entity, through the planner, produces **zero** `create`
  actions — asserted for every entity kind. This test is the executable form of guard 2; it must
  fail loudly if someone deletes the provenance check as redundant.
- Idempotence: `plan` twice over unchanged state yields an empty second plan.
- Conflict matrix: every prisme-owned field edited externally produces a conflict, and every
  intent-channel action produces a request instead.
- Overwrite protection: a hand-set subtask priority survives; a prisme-set one is updated.
- `apply` rejects a plan with any `create` when the threshold is `0`.
- `SYNC_WRITE_ENABLED=false` makes `apply` a no-op that says so.
- The planner has **zero I/O imports**, enforced by lint.
- A real dry run against live data shows a plan a human can read and agree with.

## Notes

- **This is the most dangerous code in the repository.** Everything it does to real data is
  irreversible from the user's point of view. Prefer a refusal over a guess, everywhere.
- Keep the planner pure with genuine discipline. The temptation to "just fetch one more thing" mid-
  plan is what makes reconcilers untestable, and this one must be exhaustively testable.
- `plan` output is read by a human before the first `apply`. Format it for reading: aligned,
  grouped, with a summary line. It is a user interface.
- **Never paste real plan output into this repository**, including a journal entry. Redact.
- Write the metrics as you go, not afterwards. `prisme_sync_drift_objects` is the signal that
  incremental sync has broken while appearing healthy, and retro-fitting it is how it gets skipped.
