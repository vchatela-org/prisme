# ADR-0001 · prisme owns the prioritization model

**Status:** Accepted · 2026-09-15

## Context

The prioritization model — areas, initiatives, scores, dependencies, schedule — has to live
somewhere. Three candidates: the document tool, the task tool, or a dedicated store.

A previous attempt put it in the document tool, encoded as relations and formulas across per-project
databases. It worked for one project and broke at N: every new project needed normalized columns, a
new relation, a new formula and its own automation flow. The central board it fed ended up with zero
rows.

## Decision

**prisme holds the model in its own PostgreSQL database.** The document tool remains the thinking
layer; the task tool remains execution.

## Consequences

- No per-project configuration. Adding a project costs nothing.
- Computation, history and cross-tool comparison become possible — none of which either external
  tool supports.
- The event log enables KPIs and trends that are otherwise unobtainable.
- prisme becomes a system of record, so it needs backup, migrations and a real security posture.
  Migrations and security are built here; **backup is infrastructure and is not**
  ([ADR-0022](0022-backups-belong-to-the-deployment-repository.md)).
- The model can no longer be edited directly in the document tool. That is a real loss of
  convenience, and the reason the UI has to be good rather than merely functional.

## Alternatives

**Model in the document tool.** Everything stays editable in a familiar place. Rejected: it is the
approach that already failed, it cannot compute or keep history, its rate limits make it a poor
read path, and dependencies and scheduling fight its data model.

**Model in the task tool.** Closest to where work happens. Rejected: no structure for goals,
scores or dependencies, and it would overload the one tool that currently works well.
