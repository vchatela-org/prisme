# ADR-0004 · Score initiatives, never tasks

**Status:** Accepted · 2026-09-15

## Context

Scoring every task is the obvious design and it does not survive contact with a real backlog:
hundreds of items, each needing several judgements, re-scored as circumstances change. Scores decay
immediately, and a stale score is worse than none because it is trusted.

## Decision

The **initiative** is the only scored unit — an outcome finishable in roughly one to six weeks.
Anything larger is sliced, and the slice is scored. Tasks carry no score and inherit priority from
their initiative.

## Consequences

- A few dozen comparable things instead of hundreds of incomparable ones. Re-scoring at a review
  becomes feasible, so scores stay fresh.
- Initiatives phrased as outcomes have a completion condition, which activities do not. This alone
  prevents the "open for two years" failure.
- Work must be framed as outcomes before it can be prioritized. That is extra thinking at capture
  time, and it is the thinking that was missing.
- Not everything becomes an initiative. Loose tasks stay loose tasks — promoting everything
  reproduces the original problem with more ceremony.

## Alternatives

**Score every task.** Rejected: unmaintainable, and it makes small tasks compete with large
outcomes, which is exactly the bias the system exists to correct.

**Score projects only.** Rejected: too coarse. A six-month project offers no guidance about what to
do this week.
