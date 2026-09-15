# ADR-0006 · Scoring methods are pluggable and versioned

**Status:** Accepted · 2026-09-15

## Context

The scoring formula in use before prisme was known to be flawed: urgency counted twice, only 11
distinct values across 16 input combinations, and division by size rewarding exactly the small work
that already got picked first.

Replacing one formula with another would repeat the mistake in a year. A prioritization formula
encodes judgement, and judgement improves with evidence.

## Decision

A **`ScoringMethod` is a plugin**: a pure, versioned function registered by id.

- Scores are stored as rows `(initiative, method_id, method_version, score, factors, computed_at)` —
  **never** a column on the initiative.
- One method is **active** for ordering; any number run in **shadow** and are stored but unused.
- Parameters are data, editable in settings, not constants in code.
- `wsjf-balanced` ships first. It is the first method, not the last.

**Invariant:** no code outside the scoring package may read a method-specific field. Everything
reads the active method through the registry.

## Consequences

- Changing method is configuration, not migration.
- Two rankings can be compared on real data before one takes effect.
- History records *how* something was ranked, not merely its current rank — so "ranked first for six
  weeks and never picked" becomes a visible, and interesting, fact.
- Scores must be recomputed rather than read from a cached column, which costs a little query work.
- Methods must be explainable. A ranking that cannot be interrogated stops being trusted the first
  time it surprises the user, and the whole system becomes decoration.

## Alternatives

**A single formula in a column.** Simplest, and fast to query. Rejected on all three counts above —
particularly the loss of history, which cannot be reconstructed later.
