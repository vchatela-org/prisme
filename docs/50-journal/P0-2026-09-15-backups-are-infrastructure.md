# P0 · 2026-09-15 · Database backups are infrastructure, not a prisme feature

**Agent: documentation session** · **Duration: short** · **Outcome:** complete

## What was done

Closed the ambiguity around the "confirm a backup exists" prerequisite that had been sitting in the
runtime doc and in the foundation-docs journal entry without an owner. Written:
[ADR-0022](../20-decisions/0022-backups-belong-to-the-deployment-repository.md). Updated:
`15-runtime.md` (a *Backups — outside the application* subsection and the deployment interface),
`13-migration.md` (the step-8 gate), `14-threat-model.md` (out of scope), the ADR index, `OPEN.md`,
`STATUS.md` (a new *Before the first outward write* checklist), the W00 and W12 briefs, and
`apps/sync/CLAUDE.md`.

## Decisions taken

**Backup and restore belong to the GitOps deployment repository, as a scheduled dump CronJob beside
the ones it already runs for its other databases. This repository ships no backup capability at
all** — no `pg_dump`, no endpoint, no MCP tool, no metric, no credential that could take one.

The prerequisite was real, but it had been phrased as a bare instruction with no owner and no
location, which made it read like an unassigned task in front of P2. It is neither a workstream
dependency nor application code; it is one row in a pattern the deployment repository already
applies to every stateful application it runs.

Two things were pinned down rather than left to inference:

- **Where the gate actually is.** [Step 8](../13-migration.md#5-sequence) — lifting the write
  freeze — and nowhere earlier. Steps 1–7 write nothing outward, so until then the worst case is a
  database that can be rebuilt by re-ingesting both tools. The gate is now a checklist in
  `STATUS.md` with a human owner, not a condition any code checks.
- **What "a backup exists" has to mean.** A *rehearsed restore*, not a scheduled dump. A dump nobody
  has restored is a belief, not a backup.

## Surprises

- **The migration doc's rollback table understates the loss.** "Drop the database and re-ingest"
  is true of the mirrored rows and false of everything that matters: scores, weights, capacity
  history, the conflict ledger, and `entity_link`. An empty link table after a rebuild means the
  planner no longer knows that existing work was already adopted — the precise condition ADR-0010's
  guards exist to prevent. That argument is now in the ADR, and it is the reason backups are
  load-bearing rather than tidy.
- **The temptation is structural, not hypothetical.** A backup entrypoint would sit very naturally
  beside the migration runner in W00, and a "safety copy before apply" would look prudent in W04.
  Both are called out as out of scope in the briefs, because each would hand the application a
  credential much broader than its DML-only role.

## Follow-ups

- **Deployment repository, before step 8 — not before any workstream:** add a dump CronJob for
  prisme's database following the existing per-application pattern there, with retention and an
  off-cluster copy, then rehearse a restore once and tick the checklist in `STATUS.md`.
- **Revisit only if the cluster grows a PostgreSQL operator** for its own reasons. The mechanism
  would move to a backup CRD; the owner would not change, so ADR-0022 would not need superseding.
- A dump is the whole private instance in one file. It is `seed/`-class data — off-cluster, never an
  input to a fixture, a test or an entry here.

## Specs touched

`15-runtime.md` §3 and §6 · `13-migration.md` §5 · `14-threat-model.md` §8 · `STATUS.md` ·
`OPEN.md` recently-closed · W00 and W12 out-of-scope sections · `apps/sync/CLAUDE.md`.
The earlier follow-up in [`P0-2026-09-15-foundation-docs.md`](P0-2026-09-15-foundation-docs.md)
("confirm database backups exist") is answered by ADR-0022 and needs no further action in this
repository.
