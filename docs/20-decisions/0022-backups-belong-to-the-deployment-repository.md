# ADR-0022 · Database backups belong to the deployment repository

**Status:** Accepted · 2026-09-15

## Context

prisme is a system of record (ADR-0001) and keeps *all* of its state in PostgreSQL (ADR-0018):
scores, year-scoped weights, the `now` set, capacity history, the conflict ledger and — critically —
`entity_link`, the mapping from prisme entities to external objects. Most of that is judgement, not
data mirrored from somewhere else. [`13-migration.md`](../13-migration.md#7-rollback) says the
database can be dropped and re-ingested, and that is true of the *mirrored* rows only; the
judgement rows exist nowhere but here, and `entity_link` is what makes "adopt never creates"
(ADR-0010) hold across a rebuild. Losing the database is therefore not an outage, it is a loss.

The target cluster runs PostgreSQL from a plain Helm chart with **no database operator** — no
`Cluster` custom resource, no backup CRD, no operator-managed schedule
([`15-runtime.md`](../15-runtime.md#3-database)). Nothing supplies a backup by default.

That left a question the specs had been stating as a prerequisite — "confirm a backup exists before
the first outward `apply`" — without ever saying *whose* prerequisite it is or where the work
happens. Read one way it looked like a task prisme itself had to grow: a backup endpoint, a dump
CronJob in this repository, an operator to adopt. Read the other way it is ordinary infrastructure
work that the deployment repository already does for every other stateful application it runs. The
ambiguity was quietly blocking: no workstream owned it, so it sat in front of P2 looking like a
dependency.

## Decision

**Backup and restore are infrastructure, owned entirely by the private GitOps deployment repository.
prisme ships no backup capability and never will.**

Concretely, and checkable against the code:

- **No backup code in this repository.** No `pg_dump` invocation, no dump-to-object-storage client,
  no scheduled backup entrypoint, no `/backup` or `/restore` route, no MCP tool, no button in the
  web UI. A grep for `pg_dump` over this repository returns nothing.
- **No credentials for it.** prisme's application role holds DML only and no DDL
  ([`15-runtime.md`](../15-runtime.md#roles)); it gets no object-storage credential and no second
  connection string. A backup runs as its own workload with its own credential, and prisme cannot
  reach it.
- **The mechanism is a CronJob in the deployment repository**, one per stateful application, which
  is the pattern that repository already uses for the other databases it runs. prisme is another row
  in that pattern, not a special case: dump on a schedule, retain, copy off-cluster, restore when
  asked.
- **prisme's side of the contract is to stay restorable**: all state in PostgreSQL (ADR-0018), no
  persistent volume and no local files, forward-only migrations with a written reversal, and a
  documented schema version per image tag so a dump can be matched to a binary.
- **The go-live gate is a human step in the deployment repository, not a code path.** Before the
  write freeze is lifted for the first time (`SYNC_WRITE_ENABLED=true`,
  [`13-migration.md`](../13-migration.md#5-sequence) step 8), a restore must have been *rehearsed*
  once — not merely scheduled. prisme does not check this, refuses nothing on its account, and has
  no way to know. It is a checklist item with a human owner.
- **It blocks no workstream.** No brief depends on it, no image build waits for it, and P0 and P1
  are read-only regardless. It gates exactly one moment — the first outward write — and it can be
  done at any point before then.

## Consequences

- Nothing in this repository has to be built, tested or reviewed for backups. The question is closed
  for every workstream agent: if the task mentions backups, it is out of scope here.
- A dump contains the full private instance — real objectives, real titles, real external IDs. Keeping
  it out of this repository keeps that data out of the one place it must never be
  ([`17-privacy.md`](../17-privacy.md)). Dumps are `seed/`-class data living off-cluster, and are
  never an input to a test or a fixture.
- Backup coverage becomes invisible from inside prisme. There is no metric, no readiness check and no
  banner saying "your last backup is three weeks old", because the application genuinely does not
  know. The deployment repository monitors its own CronJobs, as it does for everything else.
- The failure mode is honest but real: someone deploys prisme without adding the backup CronJob, and
  nothing complains. The mitigation is that the deployment repository adds backups for a stateful
  application as a matter of routine, and that lifting the write freeze is a deliberate,
  once-in-the-project step with this on its checklist.
- A restore is a full-database restore to a point in time. There is no per-entity undo here; the
  event log covers "we applied something wrong" ([`13-migration.md`](../13-migration.md#7-rollback))
  and a restore covers "the database is gone".

## Alternatives

**Ship backups inside prisme** — a CronJob in this repository, or an admin endpoint that streams a
dump. Rejected on three counts: it needs a credential with far broader reach than the application
role, which widens the blast radius of a web-process compromise for no feature gain; it puts a file
containing the entire private instance inside the application's own threat surface; and it
duplicates, worse, something the deployment repository already does correctly for several other
databases. A personal application that backs itself up is a database administrator no one hired.

**Adopt a PostgreSQL operator with a backup CRD** (CloudNativePG or similar). Technically the
nicest answer — declarative schedules, verified restores, point-in-time recovery. Rejected for now:
no operator is present in the target cluster, introducing one is real infrastructure work for a
single-instance personal deployment, and it would change the database from "a connection string" to
"a platform prisme has opinions about". Worth revisiting if the cluster ever grows an operator for
its own reasons — and if it does, this ADR does not need superseding, because the owner is
unchanged. Only the mechanism moves.

**No backups; rely on re-ingest.** Appealing, because the external tools are never harmed and
prisme can rebuild from them. Rejected: re-ingest restores the mirror and destroys the judgement.
Scores, weights, capacity history, the conflict ledger and every adoption decision are gone, and
`entity_link` comes back empty — which means the next `plan` no longer knows that existing work is
already adopted. That is the exact condition ADR-0010's guards exist to prevent.

**Backup the deployment, not the database** — snapshot the persistent volume. Rejected: there is no
persistent volume (ADR-0018), and a volume snapshot of a running PostgreSQL is a crash-consistent
copy, not a verified dump.
