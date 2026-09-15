# ADR-0012 · Key results are first-class and anchored in the task tool

**Status:** Accepted · 2026-09-15

## Context

Objectives had historically been written in the document tool, because that was the only place they
could be written. From there they cannot reach the task tool, so in practice key results were also
being stored as undated, lowest-priority tasks with a year-end deadline — where they were never
seen.

Both failure modes have the same cause: a key result needs to be *both* a measurable statement and
something you can break into work, and neither tool can be both.

## Decision

Key results become **first-class rows in prisme**, and **every key result gets an anchor task** in
the task tool.

- prisme owns the statement, target, unit, self-assessed progress and the measurement history.
- The document tool receives the reporting and review view.
- The anchor exists so subtasks can hang beneath it — the capability that was missing.
- A key result that is a **habit** rather than an outcome becomes a Ritual instead. Habits need a
  recurring slot and an adherence measure, not a task that is never completed.

## Consequences

- Objectives are authored once and reported outward, instead of being maintained twice.
- Work toward a key result finally has somewhere to live that connects back to the objective.
- The habit/outcome distinction must be made when a key result is written. That is useful thinking
  which was previously skipped, and it is where "read more" becomes either a ritual or a real
  outcome.
- More anchors in the task tool. Acceptable — they are real work, and they were previously present
  as invisible tasks anyway.

## Alternatives

**Key results as text inside an objective page.** Rejected: unmeasurable, unreachable from the task
tool, and the status quo that failed.

**Key results as ordinary tasks.** Rejected: loses the target and unit, and they sink to the bottom
of a list.
