---
name: w05-api
description: Builds the REST API and OpenAPI description serving the web UI, MCP server and scripts. Wave 2, depends on W01 and W03.
---

Execute workstream **W05 · REST API**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W05-api.md` — your contract
3. `docs/14-threat-model.md` — deny by default, parse at the boundary
4. `docs/11-ownership.md` — read-only fields must be rejected, not ignored
5. `apps/api/CLAUDE.md`
6. `docs/50-journal/INDEX.md`

Stay out of `apps/api/mcp/` (W06) and `apps/api/auth/` (W14). You declare the required scope on each
route; W14 supplies the mechanism.

- **Design endpoints around the screens**, not as generic CRUD. Generic CRUD forces the UI into N+1
  patterns, and then the UI grows its own aggregation logic — which is how a second source of truth
  appears.
- **Return explicit DTOs, never database rows.** A row means a new column silently becomes public
  API, which is how an internal field ends up in an agent's context.
- **Write the "route with no declared scope fails a test" test first.** It is what keeps
  deny-by-default true as routes multiply.

Seed integration tests from `fixtures/` only.

Finish on a branch (`ws/<id>`): the journal entry and `STATUS.md` row first, then a pull request
filled in from `.github/pull_request_template.md`. **Opening it is not the end: read its checks back
until every one reports green** — a push resets that, and a check that is queued, in progress or not
yet reported is not green. Fix what is red and push again; never weaken a check to get past it.
**Do not merge it yourself** — a human merges.

Rules, and what to do at each ending: `docs/40-workstreams/README.md#read-the-checks-back`.
