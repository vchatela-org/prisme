# W15 · Creation flows

**Depends on:** W04, W05, W07 · **Wave:** 5
**Files you may touch:** `apps/web/app/(create)/**`, `packages/connectors/write/create/**`

## Why

prisme has to be somewhere you *add* things, not only somewhere you look at them. Three shapes,
which are the shapes work actually arrives in: a small thing, an initiative, and a large project.

This runs last because it writes to both external tools and builds on everything the earlier waves
established.

## Read first

- [`../10-model.md#creating-things-from-the-ui`](../10-model.md) and
  [`../13-migration.md`](../13-migration.md) — the no-duplicate guards apply here too
- [ADR-0011](../20-decisions/0011-optional-narrative-page.md) ·
  [ADR-0019](../20-decisions/0019-project-as-optional-container.md)

## Scope

1. **Quick capture** — a small thing:
   - creates a task in the area's project or section; prisme records a linked capture;
   - it stays a task. Not everything is an initiative;
   - optional page: **create from template**, or **link an existing one**;
   - promoting it later creates an initiative **bound to the same task** — never a second one.
2. **New initiative**:
   - created in prisme, with an anchor task in the task tool;
   - the page button in its three states — create / open / link existing (ADR-0011);
   - scoring inline at creation, because a score assigned later is a score never assigned.
3. **New project** — the large-effort shape:
   - a project in prisme with ordered sections;
   - a page in the document tool from the project template;
   - a dedicated project in the task tool with sections mirroring the subtopics;
   - **partial failure must be recoverable** — see Notes.
4. **Create-versus-adopt is always explicit.** Before creating, search for an existing match and
   offer to link it instead. Never infer.
5. **Keyboard-first**: capture reachable from the command palette anywhere, in seconds.

## Out of scope

The adoption queue (W12 — the opposite direction) · the reconciler (W04) · template management in
the document tool.

## Contract

- `POST /api/v1/captures`, `/initiatives`, `/projects` — each returning the created entity with all
  external references resolved.
- A create-flow component set in `apps/web`, usable from the command palette and from each surface.

## Definition of done

- All three flows create exactly one object per tool, verified by a follow-up `plan` showing
  **`create: 0`** — the guard that proves nothing was double-created.
- Promoting a capture reuses its existing task; no second task appears.
- "Link existing" binds without creating, for both pages and projects.
- Project creation produces the correct section structure in both tools.
- A simulated failure partway through project creation leaves a recoverable state, not orphans in
  one tool.
- Capture from the command palette takes under ten seconds, decisions deferred.

## Notes

- **Multi-tool creation is not atomic**, and this is the real difficulty of this workstream. There
  is no transaction spanning two SaaS APIs. Create in prisme **first**, record intended external
  references as pending, and let the reconciler converge the rest. A half-created project must be
  resumable, never a set of orphans nobody can find.
- The no-duplicate guards are not only W12's concern. A creation flow that retries after a timeout is
  exactly how a duplicate appears — use idempotency keys and check for an existing reference first.
- Search-before-create is what keeps the model honest over time. Without it, prisme slowly
  accumulates near-duplicates of things that already exist.
- Scoring at creation matters: an unscored initiative sits in the inbox indefinitely, which is how
  the previous system's "missing score" backlog came about.
