# FUP · 2026-10-28 · S10: a general project split across areas is not offered as a Project

**Agent:** Claude · **Duration:** one run · **PR:** [#195](https://github.com/vchatela-org/prisme/pull/195) · **Outcome:** the adoption scan leaves
in place a task-tool project whose sections' tasks land in two or more areas, so it no longer sits
in the queue as a Project that can only be ignored. S10 is closed.

## What was found first

The classifier proposed every project with two or more sections as a `Project`, which has exactly
one area (ADR-0029). The scan already knew the mappings — `adaptProjects` resolves a project's own
area through them — but never asked where its sections went.

## What was done

- `adaptProjects` counts, per project, the distinct areas its non-archived sections resolve to with
  `areaOfLocation` — the section's own mapping, else the project's — as `sectionAreaCount`.
- `classify` keeps a project with `sectionAreaCount ≥ 2` in place (`task`, *a general project whose
  sections map to several areas*), before the dedicated-project rule. It is never queued; the scan
  counts it among what it left in place.
- Tests in `adapt.test.ts` (a section inheriting the project's area, a section mapped elsewhere) and
  `classify.test.ts` (split → stays; one area → project).

## Decisions taken

- **The attribution rule, not "sections with mappings".** A project mapped to one area with one
  section mapped to another feeds two areas just as much as two mapped sections do. Counting the
  same resolution attribution uses keeps the scan and the share chart in agreement.
- **Left in place, not a new kind.** `task` already means *leave it where it is*; a new kind would
  need a queue column, a filter and a label for something nobody acts on.
- **Rows already queued go on the next scan.** The scan rewrites the queue's mirror; nothing is
  migrated.

## Checks run locally

Node 24.21.0: `apps/sync` typecheck; the adoption suite (157); the whole `unit` project before
pushing; eslint and prettier on the changed files; the privacy scan with the local supplement.

## Not done

- A project that is split later, after it was adopted as a Project, keeps its Project; ADR-0029's
  one-area rule governs it from there.

## Specs touched

- `docs/13-migration.md` §4, `docs/18-user-guide.md` §2.6, `docs/19-how-it-works.md` S10.
