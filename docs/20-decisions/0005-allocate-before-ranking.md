# ADR-0005 · Allocate capacity before ranking

**Status:** Accepted · 2026-09-15

## Context

The central question is whether a home repair matters more than a relationship goal. No scoring
formula can answer that honestly — any formula that appears to is smuggling in a values judgement
through its weights.

Worse, a single global ranking has a predictable failure mode: areas whose work is small, concrete
and pleasant dominate, and areas whose work is large or emotionally heavy receive nothing. The
ranking then *justifies* the drift it caused.

## Decision

**Allocate first, then rank.**

1. Each area receives a share of discretionary capacity, decided once a year (ADR-0007).
2. Scoring ranks only **within** an area.
3. A `balance_factor` — target share ÷ observed share, clamped to 0.5–2 — lifts starved areas and
   damps over-served ones.
4. Selection caps work in progress per area, so one busy area cannot occupy every slot.

## Consequences

- The values judgement is made once, deliberately, with evidence — instead of implicitly, every day,
  under time pressure.
- Cross-area comparison is a budget question, not a score question.
- Capacity must actually be measured, which requires the completion history and makes the
  measurement's limitations matter ([`12-scoring.md`](../12-scoring.md#4-measuring-capacity)).
- An area whose work is mostly untracked reads as starved. The bias errs toward surfacing neglect,
  which is the safer direction.

## Alternatives

**One global ranking.** Simple and familiar. Rejected: it is the mechanism of the failure.

**Eisenhower quadrants across everything.** Rejected: urgency dominates importance, and quadrants
rank groups rather than items.
