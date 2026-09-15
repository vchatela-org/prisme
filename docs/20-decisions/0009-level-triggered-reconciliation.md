# ADR-0009 · Level-triggered reconciliation, not event handling

**Status:** Accepted · 2026-09-15

## Context

Keeping three stores consistent can be event-driven (react to webhooks) or level-triggered (compare
full desired state to actual state, converge). The prior implementation was event-driven, built from
UI-configured flows, one per project. It drifted and was never finished.

## Decision

prisme is a **reconciler**. Every run compares desired state with actual state and converges — the
controller pattern, as used by `terraform plan` / `apply` and by Kubernetes.

- `plan` has no side effects and can be run at any time.
- `apply` re-plans immediately before executing; a stale plan is never applied.
- The planner is a **pure function** `plan(desired, observed, lastApplied) → Action[]`. All I/O
  lives in thin adapters either side.
- Webhooks, if ever added, are **hints only** — "run sooner" — never the carrier of state.

## Consequences

- Self-healing: restarts, API errors, missed notifications and manual edits all correct themselves
  on the next run.
- Debugging is reading one plan, not replaying a sequence of events.
- The hard logic — ownership, conflicts, inheritance, the no-duplicate guards — lives in a pure
  function that can be exhaustively tested with no network and no clock.
- Latency is minutes rather than seconds. Irrelevant for a system whose decisions change weekly, and
  the force-sync button covers the one case where waiting is annoying.
- Each run costs a fixed amount of API traffic regardless of whether anything changed. Comfortably
  within both tools' limits at a 15-minute cadence.

## Alternatives

**Event-driven flows.** Fast, and no polling. Rejected: one missed event drifts forever with no
mechanism to notice, which is the failure already observed.

**A commercial two-way sync product.** No code to write. Rejected: it mirrors every task 1:1 into
the document tool — the duplicate task list this design exists to avoid — holds tokens to both
tools, and has no allocation model.
