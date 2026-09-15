# packages/domain

**The business rules. Pure — no I/O, no clock, no randomness.**

Owned by [W01](../../docs/40-workstreams/W01-domain-scoring.md) and
[W02](../../docs/40-workstreams/W02-schedule-engine.md).
Specs: [`10-model.md`](../../docs/10-model.md) · [`12-scoring.md`](../../docs/12-scoring.md).

## Non-negotiables

1. **No I/O.** No database, no HTTP, no filesystem. A lint rule enforces it — do not add an
   exception.
2. **No ambient time.** `now: Date` is always a parameter. A function calling `Date.now()` is
   untestable and produces scores that cannot be reproduced.
3. **No randomness.** Same inputs, same outputs, every time, including ordering. Sort explicitly;
   never rely on map or set iteration order.
4. **Nothing outside `scoring/` may read a method-specific field.** No `wsjf` column, anywhere, ever.
   Read the active method through the registry ([ADR-0006](../../docs/20-decisions/0006-pluggable-scoring.md)).
5. **A weight always requires a year.** There is no "current weight" accessor, and adding one would
   break [ADR-0007](../../docs/20-decisions/0007-year-scoped-weights.md).

## Shape

```
domain/
  entities/     types and invariants
  scoring/      registry, ScoringMethod contract, wsjf-balanced
  capacity/     actual share, balance factor
  selection/    now-set selection, WIP limits
  schedule/     CPM passes, replanning              (W02)
```

## Conventions

- Fibonacci inputs are a **union type** (`1 | 2 | 3 | 5 | 8 | 13`), never `number`, so an invalid
  4 or 6 cannot be constructed.
- Invariants are enforced at construction — an illegal entity should be impossible to build, not
  merely detectable afterwards.
- Every scoring result carries `factors` and `explain`. A ranking that cannot be interrogated stops
  being trusted the first time it surprises the user.

## Testing

Property-based first: monotonicity, bounds, determinism, invariance to unrelated fields. Golden
files in `fixtures/scoring/` pin inputs to outputs — **a diff in a golden file requires a `version`
bump**, and CI enforces the pairing.

Fixture data only. Never reach for real values to make a test "realistic".
