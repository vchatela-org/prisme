# W12 · Adoption queue and migration

**Depends on:** W03, W04 · **Wave:** 3
**Files you may touch:** `apps/sync/adoption/**`, `apps/web/app/(adoption)/**`, migration files

## Why

Bringing years of existing work into the model is the operation most likely to damage real data. One
hard requirement:

> **Adopting existing work must never create a duplicate.** No new page, no new task, no second copy
> of anything.

## Read first

- [`../13-migration.md`](../13-migration.md) — the whole document
- [ADR-0010](../20-decisions/0010-adopt-never-creates.md) — the four guards
- [`../17-privacy.md`](../17-privacy.md) — you will be handling real data throughout

## Scope

1. **Seed migration**: import any pre-existing external-ID mapping into `entity_link` before any
   heuristic runs. This is the cheapest and most reliable identity source available.
2. **Candidate discovery**: every external object with no prisme link, classified by the mapping in
   [`../13-migration.md`](../13-migration.md#what-becomes-what).
3. **Identity resolution** in the documented order. **Only "certain" matches auto-apply**;
   everything else is a proposal.
4. **Adoption queue UI**: adopt / ignore / merge, in bulk where it is safe. *Ignore* is permanent and
   recorded.
5. **Adoption creates a linked entity only**: `origin = adopted`, bound to the existing external
   object. It creates nothing outward, ever.
6. **Convergence**: the queue shrinks. Ignored items never return.
7. **Verification tooling**: a command that reports link coverage, unresolved candidates, and any
   entity that would produce a `create`.

## Out of scope

The reconciler itself (W04) · capacity backfill (W13) · creation flows (W15 — the opposite
direction) · **database backups** — the restore rehearsal that gates the first outward write is
infrastructure work in the deployment repository, not yours to build or to check
([ADR-0022](../20-decisions/0022-backups-belong-to-the-deployment-repository.md)). It does not block
this workstream: everything here is `plan`-only.

## Contract

- `prisme-sync adopt --plan` — reports candidates and proposed matches, changing nothing.
- Route `/adoption` — the queue.
- `entity_link` rows carry `match_rule`, `confidence`, `decided_by`, `decided_at` for every decision.

## Definition of done

- **The adversarial test**: a corpus of adopted entities produces **zero** `create` actions, for
  every entity kind.
- Auto-linking happens only at "certain" confidence — verified with near-miss fixtures that must
  *not* match.
- *Ignore* survives a re-scan; the queue provably converges.
- Unlinking removes only the link. The external object is untouched — prove it.
- A real dry run against live data shows `create: 0` and a plan a human agrees with.
- Link coverage is reported, and the unresolved remainder is small enough to work through by hand.

## Notes

- **This is the highest-risk workstream in the project.** Keep it `plan`-only until a human has read
  a full plan end to end. Prefer refusing over guessing, every time.
- **The trap is over-promotion.** Everything looks like it could be an initiative, and promoting
  everything produces a backlog of hundreds of incomparable items — which reproduces the original
  problem with more ceremony. Most tasks are just tasks.
- An automatic fuzzy match that is wrong creates exactly the corruption this workstream exists to
  prevent, and does it invisibly. Set the threshold conservatively and make a human confirm.
- **You will be looking at real data constantly.** Never commit any of it: not in a fixture, not in
  a test, not in a journal entry, not in a screenshot. Redact first, always.
