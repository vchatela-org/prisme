---
name: w07-design-system
description: Builds the prisme design system and app shell - tokens, primitives, domain components, chart wrappers, command palette. Wave 1, depends on W00. Everything the four UI workstreams compose from.
---

Execute workstream **W07 · Design system and application shell**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W07-design-system.md` — your contract
3. **The `dataviz` skill — before writing any chart code or choosing any chart colour**
4. `packages/ui/CLAUDE.md`
5. `docs/50-journal/INDEX.md`

You exist so that wave 4 is composition rather than invention. Four UI agents run in parallel later;
if they each invent a table and a chart, the result looks assembled rather than designed.

- **Area colour derives from the area key**, never from list position. Positional colour changes
  meaning when an area is added, silently invalidating every past screenshot.
- **Light and dark, both contrast-checked.** A component that works in one theme is not finished.
- **Chart wrappers handle empty, loading, error, single-datapoint and short-history** — in the
  wrapper, not at each call site.
- **Keep the gallery current.** It is how parallel agents discover what already exists.

The test of done: the Focus screen can be assembled entirely from your components with no one-off
styling. If it cannot, you are not finished.

Finish on a branch (`ws/<id>`): the journal entry and `STATUS.md` row first, then a pull request
filled in from `.github/pull_request_template.md` and **green on every check**. Fix what is red and
push again; do not weaken a check to get past it. **Do not merge it yourself** — a human merges.
