# ADR-0031 · Every outward write is audited in its own table, and the table is pruned by age

**Status:** Accepted · 2026-09-27

## Context

docs/13-migration.md §5 step 8 lifts the write freeze: it is the first time prisme changes the
document tool or the task tool. The owner asked two things before lifting it on a live instance:
**a screen that shows what prisme did to either tool, with basic filters**, and **a record kept for a
configurable time, so it does not fill the database**.

Measured against the code before this record, neither existed:

- The only trace of an outward write was one `sync_action` row in `event_log`, written by the
  reconciler's `apply` for an action that **succeeded**. A failed call left nothing. The row named
  neither the tool nor the operation nor what was sent — `after` held the action's tag and its
  one-line detail — and it was written for actions that change only prisme's own tables (a rollup, a
  status move) exactly as for one that reached an API.
- The creation ledger's calls — projects, sections, captures and pages — left no event at all.
  `creation_intent` holds each intent's *latest* state and attempt count, not a history of calls.
- Nothing was ever deleted. `event_log` carries a trigger that refuses `DELETE`, deliberately: it is
  the KPI source, the replanning input, and the rollback procedure in docs/13-migration.md §7 reads
  its before/after values.
- `GET /events` existed; no screen listed events.

So the audit cannot be `event_log` with a retention policy added — pruning `event_log` would break
the KPIs and the rollback — and it cannot be assembled from `event_log` and `creation_intent`
either, because neither records failures or what was sent.

## Decision

**1. A table of its own: `external_write`, one row per outward call.** Tool, operation, which half
of the sync made it (`reconciler` or `creation`), the pass's run id, the prisme entity it was made
for when the pass knew it, the external object, **what prisme asked for** (the draft, the patch or
the location, in prisme's vocabulary), the outcome, and for a failure the connector's failure kind
and its message. The operation vocabulary is the whole write surface — one entry per method on the
three writer ports — and lives in `packages/domain` (`WRITE_AUDIT_*`), so the database CHECK, the API
and the screen share it. `event_log` is untouched and keeps its `sync_action` rows.

**2. It is recorded by the writers, decorated where they are constructed.** `auditTaskToolWriter`,
`auditCreationWriter` and `auditDocumentCreationWriter` in `@prisme/connectors/write` wrap a writer
so that every call it is given is recorded, whether it succeeded or failed. The CronJob and the
API's `POST /sync` hand the reconciler an audited writer and nothing else — the same move the write
freeze makes (the freeze is the object in hand, not a flag), for the same reason: a record a call
site must remember to make is a record some call site forgets. The frozen writers are wrapped too;
a frozen pass never calls them, so a row from one is a defect worth seeing.

**3. The write outranks its record.** The row is inserted after the call returns, and a failure to
insert it is logged and **does not fail the call**. What follows a write is load-bearing: the
reconciler binds a created anchor and stores `last_applied`, the ledger stores the created id.
Failing a write the tool has already accepted, because a row about it could not be written, would
skip that bookkeeping — and the next pass would repeat the write, which for a create is the duplicate
[ADR-0010](0010-adopt-never-creates.md) exists to prevent. The cost is stated rather than hidden: a
process that dies between the call and the insert leaves a write with no row here. The event log
(for the reconciler) and the creation ledger (for creations) still show the effect.

**4. The entity is carried in async context, not through the ports.** The writer ports take a draft
and an external id and are shaped by the ownership matrix; adding an entity to them would let a
caller name one it was not acting for. The pass wraps the calls it makes for an entity in
`withWriteSubject` (`apps/sync/src/audit/subject.ts`), and the sink reads it. A call outside any
subject is recorded without one — still true, only less specific.

**5. Rows are immutable, and deleted by age.** A trigger refuses `UPDATE`; `DELETE` is allowed
because pruning is what the table is for. The application role already holds `DELETE` through the
default privileges, so the migration carries no `GRANT`.

**6. The window is chosen on the Settings screen, and enforced by the daily full pass.**
`audit_setting` is a singleton the API upserts (`PUT /audit/retention`, `admin:settings`); no row
means the default applies. Default **90 days**, floor **7**, ceiling **3650** — `WRITE_AUDIT_RETENTION`
in `packages/domain`, repeated as a CHECK. The floor exists because a window shorter than the week of
reviews in §5 step 9 would delete the record of the first outward writes before anybody had read it;
zero would mean "delete everything tonight", not "off". The prune runs at the end of every full pass
in `prisme-sync` — once a day, beside the capacity refresh and the adoption scan, under the freeze
too, and a failure there does not fail the pass. Shortening the window deletes nothing until that
pass runs.

**7. The records are read on `/audit`, and returned with what was sent.** `GET /audit/writes`
(`read:sync`) filters by tool, operation, outcome, origin, entity, a time range and a
case-insensitive search over what was sent; the screen offers them as toggles and period presets in
the URL. Unlike the creation ledger's DTO, which omits `draft` because no screen needs it, this DTO
**carries `request`**: showing what was sent is the screen's whole purpose. It is instance data under
the rules every title follows — rendered to the owner, never logged, never committed — and no MCP
tool exposes it.

## Consequences

- Lifting the freeze now has a record a person can read. docs/13-migration.md §5 step 9 ("watch the
  conflict ledger") gains a second place to look.
- The row count grows with the number of **actions**, not passes — a pass that changes nothing
  writes nothing — so at a personal instance's volume the default window holds hundreds of rows, not
  millions, and one `DELETE` a day is enough. No batching, no partitioning.
- A write whose process dies mid-call can be missing here (decision 3). The event log and the ledger
  remain the authorities on *effects*; this is the authority on *calls*.
- A seventh operation added to a writer port must be added to `WRITE_AUDIT_OPERATIONS`, the CHECK in a
  migration, and the screen's labels — the decorators do not compile without the first.
- Reads are not audited. They change nothing, and at every pass there are many of them.

## Alternatives

**Prune `event_log` instead.** Rejected: it is the KPI source and the rollback's before/after, and
its append-only trigger is a guarantee other specs cite. A retention policy there would silently
shorten how far back throughput and replanning can see.

**Record at each call site** — in `apply`'s operation switch and the converge loop. Rejected: two
places today, a third tomorrow, and an unaudited write the day somebody adds one. Decorating the
writer is structural.

**Insert a `pending` row before the call and complete it after.** It would leave a row even when the
process dies mid-call. Rejected for now: it makes rows mutable, doubles the writes per call, and needs
a sweeper for rows left pending — machinery for a failure the event log and the ledger already cover.
Revisit if a missing row is ever the thing that matters.

**An environment variable for the window** (`AUDIT_RETENTION_DAYS`). Considered and rejected by the
owner in favour of the Settings screen: instance configuration moved onto the screens in #102, and a
window changed by a GitOps commit and a rollout is a window nobody tunes.

## Revisit when

- the audit needs to survive a crash between call and record (see the pending-row alternative);
- volume grows enough that a daily `DELETE` is slow (batch it, or partition by month);
- an agent needs to read the audit (it would need an MCP tool and a decision about exposing
  `request` to an agent's context).
