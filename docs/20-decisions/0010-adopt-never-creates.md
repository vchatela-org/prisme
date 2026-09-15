# ADR-0010 · Adopting existing work can never create duplicates

**Status:** Accepted · 2026-09-15

## Context

An existing setup contains years of work that does not match this model. Bringing it in is the
highest-risk operation prisme performs: the failure mode is silent duplication in someone's real
task list and document workspace, discovered late and tedious to undo.

"Be careful" is not a control.

## Decision

Four independent guards, because any one of them can be defeated by a confident bug:

1. **Unique external references.** A database-level unique index on `(kind, external_id)`. An
   external object bound once cannot be bound again.
2. **Provenance.** Every entity carries an immutable `origin ∈ {created_in_prisme, adopted}`. The
   planner emits a `create` **only** for `origin = created_in_prisme AND external_ref IS NULL`. An
   adopted entity is structurally incapable of producing a create.
3. **Labelled plans with a threshold.** Every action is tagged `create | adopt | update | skip`, and
   `apply` refuses a plan exceeding `SYNC_CREATE_THRESHOLD`. During adoption the threshold is `0`.
4. **Seeded links.** Any pre-existing external-ID mapping is imported first, as a migration, before
   any heuristic runs.

Additionally: **write freeze is the default** (`SYNC_WRITE_ENABLED=false`), and identity resolution
auto-applies only exact, certain matches — everything else is a proposal a human accepts.

## Consequences

- prisme never moves or transforms anything, so throwing the database away and re-ingesting is
  always available and costs nothing but scoring judgements.
- The adversarial test — adopted entity in, zero creates out — is mandatory and is the executable
  form of guard 2.
- Adoption requires human attention proportional to the ambiguity, not to the volume.
- *Ignore* must be permanent, or the queue never converges and gets abandoned.

## Alternatives

**Trust the matching logic and auto-link.** Rejected: a wrong fuzzy match produces exactly the
corruption this guards against, and does it invisibly.

**Migrate data into a new structure.** Rejected: destructive, irreversible, and it breaks both tools
during the transition.
