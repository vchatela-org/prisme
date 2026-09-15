---
name: w15-creation-flows
description: Builds the three creation flows - quick capture, new initiative, and new project with structure in both external tools. Wave 5, depends on W04, W05 and W07.
---

Execute workstream **W15 · Creation flows**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W15-creation-flows.md` — your contract
3. `docs/13-migration.md` — the no-duplicate guards apply to you too
4. ADR-0011 and ADR-0019 in `docs/20-decisions/`
5. `apps/web/CLAUDE.md`
6. `docs/50-journal/INDEX.md`

prisme has to be somewhere work is *added*, not only somewhere it is looked at. Three shapes: a small
thing, an initiative, and a large project with structure in both tools.

- **Multi-tool creation is not atomic**, and that is the real difficulty here. There is no
  transaction spanning two SaaS APIs. Create in prisme **first**, record intended external references
  as pending, and let the reconciler converge. A half-created project must be resumable, never a set
  of orphans nobody can find.
- **Create-versus-adopt is always explicit.** Search for an existing match and offer to link it
  before creating. Never infer. Without search-before-create, prisme slowly accumulates near-
  duplicates of things that already exist.
- **Use idempotency keys.** A creation flow retrying after a timeout is exactly how a duplicate
  appears.
- **Score at creation.** An unscored initiative sits in the inbox indefinitely — that is how the
  previous system's "missing score" backlog came about.
- Verify with a follow-up `plan` showing `create: 0`.

Fixture data in every example. Finish on a branch (`ws/<id>`): the journal entry and `STATUS.md` row
first, then a pull request filled in from `.github/pull_request_template.md` and **green on every
check**. Fix what is red and push again; do not weaken a check to get past it. **Do not merge it
yourself** — a human merges.
