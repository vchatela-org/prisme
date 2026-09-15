# W01 · Domain model and scoring registry

**Depends on:** — · **Wave:** 1
**Files you may touch:** `packages/domain/**`, domain table migrations

## Why

This is the heart of the system, and it is pure — no I/O, no clock, no randomness. Everything
downstream is wrong if this is wrong, and everything downstream is easy if this is right.

## Read first

- [`../10-model.md`](../10-model.md) — the entities, in full
- [`../12-scoring.md`](../12-scoring.md) — the scoring contract
- [ADR-0004](../20-decisions/0004-score-initiatives-not-tasks.md) ·
  [ADR-0005](../20-decisions/0005-allocate-before-ranking.md) ·
  [ADR-0006](../20-decisions/0006-pluggable-scoring.md) ·
  [ADR-0007](../20-decisions/0007-year-scoped-weights.md) ·
  [ADR-0014](../20-decisions/0014-lanes-outside-the-backlog.md) ·
  [ADR-0019](../20-decisions/0019-project-as-optional-container.md)

## Scope

1. **Types and schema** for every entity in [`../10-model.md`](../10-model.md): Area, `area_weight`,
   Project, Initiative, Task mirror, Objective, KeyResult, Takeaway, Ritual, ReviewSession, event
   log, `entity_external_ref`, `entity_link`, `last_applied`, `sync_conflict`.
2. **Invariants enforced in code, not convention**:
   - unique index on `(kind, external_id)`;
   - `origin` immutable after insert;
   - `depends_on` is acyclic — reject cycles at write time with the path in the error;
   - an initiative has exactly one area;
   - a weight always requires a year. **No "current weight" accessor may exist.**
3. **Scoring registry**: the `ScoringMethod` interface, registration, active/shadow selection,
   parameter schemas, and append-only `initiative_score` storage.
4. **`wsjf-balanced` v1**: cost of delay, WSJF, balance factor, the 14-day deadline override.
   `factors` and `explain` populated on every result.
5. **Capacity computation**: `actual_share` over a rolling window, with the duration preference
   order from [`../12-scoring.md`](../12-scoring.md#4-measuring-capacity). Run counts; Signals do not.
6. **Now-set selection**: in-flight keeps its slot, free slots fill from the top skipping areas that
   already hold one, WIP capped by configuration, and the resulting priority mapping.

## Out of scope

Any I/O — no database calls, no HTTP, no `Date.now()` · the API · the schedule engine (W02) ·
persistence wiring beyond the migrations that define the tables.

## Contract

```ts
// packages/domain
export function computeScores(initiatives, areas, method, params, now): ScoringResult[]
export function selectNowSet(scored, areas, limits): Selection
export function computeCapacity(completions, areas, window, now): AreaCapacity[]
export const scoringRegistry: Registry   // register / get / listActive / listShadow
```

Every exported function is **pure**: `now` and configuration are arguments, never ambient.

## Definition of done

- Property-based tests pass: raising `value` never lowers a score; `balance_factor` stays within
  `[0.5, 2]`; repeated evaluation is identical; unrelated fields do not affect the result.
- Golden fixtures in `fixtures/scoring/` pin inputs to outputs, and a diff in one **requires** a
  `version` bump — wire that check into CI.
- The worked example in [`../12-scoring.md`](../12-scoring.md#6-worked-example) reproduces exactly,
  including the two cases where ranking and selection disagree.
- Adversarial invariant tests: a dependency cycle is rejected; `origin` cannot be mutated; asking
  for a weight without a year does not compile.
- Zero imports of anything performing I/O. Enforce with a lint rule, not a promise.

## Notes

- **This workstream deserves the most capable model available.** It is cheap to run, easy to verify,
  and expensive to get wrong.
- The invariant that matters most: **nothing outside this package may read a `wsjf` field.** Export
  the score through the registry only. Add the lint rule yourself — it is the guard that keeps
  ADR-0006 true a year from now.
- Fibonacci values are a closed set. Model them as a union type, not `number`, so an invalid 4 or 6
  cannot be constructed.
- Use fixture data only. Never reach for real values to "make the test realistic".
