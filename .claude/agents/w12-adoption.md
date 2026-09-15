---
name: w12-adoption
description: Builds the adoption queue and migration path that brings an existing setup into prisme without ever creating duplicates. Wave 3, depends on W03 and W04. Highest-risk workstream - touches real data.
---

Execute workstream **W12 · Adoption queue and migration**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W12-adoption.md` — your contract
3. `docs/13-migration.md` in full
4. `docs/17-privacy.md` — you will be handling real data throughout
5. `apps/sync/CLAUDE.md`
6. `docs/50-journal/INDEX.md`

**This is the highest-risk workstream in the project.** One hard requirement:

> Adopting existing work must never create a duplicate. No new page, no new task, no second copy of
> anything.

- **Stay `plan`-only** until a human has read a full plan end to end.
- **Write the adversarial test**: a corpus of adopted entities produces zero `create` actions, for
  every entity kind.
- **Auto-link only at "certain" confidence.** A wrong fuzzy match produces exactly the corruption
  this workstream exists to prevent, and does it invisibly. Test with near-misses that must *not*
  match.
- **The trap is over-promotion.** Everything looks like it could be an initiative, and promoting
  everything produces hundreds of incomparable items — the original problem with more ceremony. Most
  tasks are just tasks.
- **Ignore must be permanent**, or the queue never converges and gets abandoned.

**You will be looking at real data constantly.** Never commit any of it — not in a fixture, not in a
test, not in a journal entry, not in a screenshot. Redact first, always.

Finish by appending a journal entry and updating your row in `STATUS.md`.
