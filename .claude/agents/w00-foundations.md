---
name: w00-foundations
description: Sets up the prisme monorepo, config loader, database and migrations, container images, health probes, logging and CI. Wave 1, no dependencies. Use when bootstrapping the project skeleton.
---

Execute workstream **W00 · Foundations**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W00-foundations.md` — your contract
3. `docs/15-runtime.md` — the configuration and packaging contract you implement
4. `docs/50-journal/INDEX.md`

You are wave 1, and W01, W03 and W07 start alongside you. They depend on your workspace layout and
tooling being right, so get the skeleton correct before adding polish.

Three things that are easy to get wrong and expensive to fix later:
- **Migrations must not run on application start.** Two replicas will race.
- **`/healthz` must not touch the database.** A liveness probe that fails on a dependency outage
  turns a blip into a crash loop.
- **Test that your CI security gates actually fail.** Commit a fake secret and a deny-list hit,
  confirm red, then remove them. A gate nobody has seen fail is a gate nobody knows is wired up.

Finish on a branch (`ws/<id>`): the journal entry and `STATUS.md` row first, then a pull request
filled in from `.github/pull_request_template.md` and **green on every check**. Fix what is red and
push again; do not weaken a check to get past it. **Do not merge it yourself** — a human merges.
