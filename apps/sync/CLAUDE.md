# apps/sync

**The reconciler. The only code that can corrupt real data.**

Owned by [W04](../../docs/40-workstreams/W04-reconciler.md),
[W12](../../docs/40-workstreams/W12-adoption.md), and
[W13](../../docs/40-workstreams/W13-backfill.md).
Specs: [`16-sync.md`](../../docs/16-sync.md) · [`13-migration.md`](../../docs/13-migration.md).

## Non-negotiables

1. **The planner is pure**: `plan(desired, observed, lastApplied) → Action[]`. All I/O lives in thin
   adapters either side. The temptation to "just fetch one more thing" mid-plan is what makes
   reconcilers untestable, and this one must be exhaustively testable.
2. **`plan` before `apply`, always.** `plan` has no side effects. `apply` re-plans immediately
   before executing; a stale plan is never applied.
3. **An adopted entity can never produce a `create`.** Not "should not" — *cannot*, by the provenance
   check ([ADR-0010](../../docs/20-decisions/0010-adopt-never-creates.md)). The adversarial test is
   the executable form of that guarantee; if someone deletes the check as redundant, that test must
   fail loudly.
4. **Level-triggered, never event-driven.** Compare full desired state against actual state. Never
   write a handler that assumes it saw every event
   ([ADR-0009](../../docs/20-decisions/0009-level-triggered-reconciliation.md)).
5. **Prefer refusing over guessing.** Everything this code does to real data is irreversible from
   the user's point of view.
6. **prisme writes `deadline`, never `due`.**

## `plan` output is a user interface

A human reads it before the first `apply`, and before every risky one afterwards. Align it, group
it, summarise it. If it is hard to read, it will not be read — and then the gate is decorative.

**Never paste real plan output into this repository**, including into a journal entry. Redact.

## Two entrypoints, one library

The CronJob binary and the API's in-process `POST /sync` call the same reconciler behind a
PostgreSQL advisory lock. This is deliberate: the scheduled run and the force-sync button must be
provably the same code path, not two implementations that drift.

## State

All of it in PostgreSQL — sync token, watermark, `last_applied`, conflict ledger. No volume, no
local files ([ADR-0018](../../docs/20-decisions/0018-state-in-postgres.md)). The sync token advancing
and the changes it represents commit in one transaction, so they cannot diverge.

## Testing

Planner unit tests against JSON fixtures carry the bulk of the coverage — no network, no clock. Plus
the adversarial no-duplicate test, idempotence, the full conflict matrix, and overwrite protection.
