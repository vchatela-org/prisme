# ADR-0013 · Objective progress is self-assessed, and legacy scoring properties are removed

**Status:** Accepted · 2026-09-15

## Context

Objective progress can be computed — tasks done ÷ total — or judged. Computing it is tempting
because it is automatic and always current.

It is also wrong. A count of closed tasks is not an achievement. Progress toward "communicate better
with my partner" has no denominator, and progress toward a project can be 80% of tasks and 20% of
the outcome. An automatic number here would be precise and misleading, and it would be trusted
because it is precise.

## Decision

**`progress_self` — 0–100, set by hand, by judgement — is the primary measure**, and it is what
syncs outward.

`progress_computed` is derived from task completion, shown **beside** it, and never written
outward.

**The divergence between the two is the signal:**

| Pattern | Reading |
|---|---|
| self ≪ computed | The tasks were the wrong tasks — activity without progress |
| self ≫ computed | Progress came from outside the tracked work, or the breakdown is stale |
| both low, late in period | The objective is at risk, honestly |

Related: the legacy scoring properties on the takeaways database in the document tool are
**removed**. Scoring lives in prisme (ADR-0006). A formula on a database nobody re-scores produces
a growing "missing score" backlog and quietly stops meaning anything.

## Consequences

- A number that reflects reality, at the cost of requiring a judgement at review time — which is
  exactly when that judgement should be made.
- The divergence is a review finding neither number provides alone.
- Progress can be stale between reviews. Acceptable: objectives move at review cadence anyway.
- Removing the legacy properties is irreversible for historical rows. Their values were already
  unreliable, which is why they are being removed.

## Alternatives

**Computed progress only.** Rejected: precise and misleading, and it rewards closing tasks over
achieving outcomes.

**Self-assessed only, no computed number.** Rejected: the comparison is the most valuable part.
