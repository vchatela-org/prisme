# ADR-0018 · All state lives in PostgreSQL

**Status:** Accepted · 2026-09-15

## Context

The reconciler needs durable state between runs: an incremental sync token, a change watermark,
per-field last-applied values, and the conflict ledger. An earlier sketch put this on a persistent
volume, which is the obvious choice for a job that runs alone.

## Decision

**All state is in PostgreSQL.** No persistent volume, no local files. Containers are stateless.

## Consequences

- State participates in transactions. A sync token advancing and the changes it represents commit
  together, so the two cannot diverge — which is the failure a file-based token makes possible and
  silent.
- Any replica can take over mid-stream; there is no single-writer constraint imposed by storage.
- One backup and restore procedure covers everything.
- Restarts and rescheduling lose nothing.
- A database round trip on a path that could have been a local file read. Irrelevant at this scale.
- PostgreSQL becomes a hard dependency for the reconciler to start at all. Correct — it cannot do
  anything useful without it regardless.

## Alternatives

**SQLite on a persistent volume.** Simple, and the original sketch. Rejected: pins the workload to
one node, adds a second backup story, and allows the sync token to drift out of step with the data
it describes.

**Reconstruct state from the tools on every run.** No state at all, which is appealing. Rejected:
a full fetch every 15 minutes is wasteful, and `last_applied` is genuinely underivable — there is
no way to tell "the user set this priority" from "prisme set this priority" without remembering
what prisme wrote.
