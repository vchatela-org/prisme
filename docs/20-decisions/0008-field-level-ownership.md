# ADR-0008 · Ownership is per field, never per object

**Status:** Accepted · 2026-09-15

## Context

Bidirectional sync needs a conflict rule. The obvious formulation is per object — "the document tool
owns initiatives, the task tool owns tasks" — and it collapses immediately, because a single
initiative has fields that genuinely belong on both sides. Its priority is a decision; its due date
is a plan.

Object-level ownership forces a choice between copying everything (two task lists to maintain) and
merge logic (unpredictable, and it loses decisions).

## Decision

**Every field has exactly one owner**, recorded exhaustively in
[`11-ownership.md`](../11-ownership.md). That document is the authority; if code disagrees with it,
the code is wrong.

Conflicts resolve by rule: a change made externally to a prisme-owned field is reverted on the next
run and logged. No merge logic exists anywhere.

## Consequences

- Conflict resolution is deterministic and explainable.
- A field whose owner is ambiguous is a design smell — it is usually two fields doing one job, which
  is precisely what `deadline` and `due` turned out to be (ADR-0003).
- Repeated conflicts on one field mean its ownership is wrong. The fix is to revisit the matrix or
  add an intent-channel action, not to keep reverting.
- The matrix must be maintained. An unmaintained ownership document is worse than none, because it
  is cited with confidence.
- One nuance needs machinery: prisme propagates priority to subtasks but must not overwrite a
  hand-set value. That requires per-field `last_applied` tracking ([`16-sync.md`](../16-sync.md)).

## Alternatives

**Object-level ownership.** Rejected as above.

**Last-write-wins.** Rejected: silently discards deliberate decisions, and makes the system's
behaviour depend on clock skew between two SaaS providers.
