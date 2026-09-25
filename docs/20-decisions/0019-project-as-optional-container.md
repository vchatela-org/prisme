# ADR-0019 · Project is an optional container between area and initiative

**Status:** Accepted · 2026-09-15

## Context

Two shapes of work exist in practice, and both are legitimate:

- **Small:** a parent task inside an area's section of a general project, with subtasks beneath it.
- **Large:** a dedicated project in the task tool with its own sections, plus a page in the document
  tool — used for multi-month efforts like a house renovation or an event.

A model with only Area → Initiative cannot express the second. Forcing a large effort into a flat
list of initiatives loses its structure and its shared context.

## Decision

**`Project` is an optional container**: Area → Project? → Initiative.

- prisme owns name, area, status, deadline and the ordered list of sections.
- Creating one creates a page in the document tool from the project template, and a dedicated
  project in the task tool with sections mirroring the subtopics.
- Initiatives may belong to a project or sit directly under an area.
- Most initiatives have no project.

## Consequences

- Both working shapes are first-class, so neither has to be distorted to fit.
- Large efforts keep their structure in the tool where the work happens.
- Project creation is a genuine multi-tool operation, and must respect the no-duplicate guards
  (ADR-0010) — adopting an existing project creates nothing.
- Rollups need a rule for whether a project's capacity counts to one area. **One area per project**,
  settled by [ADR-0029](0029-one-area-per-project.md) — a project counts toward its own `area_key`,
  and work that belongs elsewhere is mapped at the section.
- An extra optional level in queries and UI. The cost of representing reality accurately.

## Alternatives

**No project level.** Simpler model. Rejected: cannot represent a large effort, which is a real and
recurring shape of work.

**Project as an initiative with sub-initiatives.** Reuses one entity. Rejected: a project is not an
outcome finishable in one to six weeks, so it would break the scoring unit's definition (ADR-0004)
and make scores incomparable.
