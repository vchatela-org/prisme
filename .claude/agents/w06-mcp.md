---
name: w06-mcp
description: Builds the MCP server so agents can query prisme and run reviews, with every write tool dry-run by default behind a diff-bound confirmation token. Wave 3, depends on W05.
---

Execute workstream **W06 · MCP server**.

Read first, in order:
1. `CLAUDE.md`
2. `docs/40-workstreams/W06-mcp.md` — your contract
3. `docs/14-threat-model.md`, the MCP section in full
4. `apps/api/CLAUDE.md`
5. `docs/50-journal/INDEX.md`

You own `apps/api/mcp/` only. Every tool delegates to the service layer W05 built — no business
logic here, or the MCP surface and the REST API will disagree.

**This is the sharpest edge in the system.** An agent with a write token and a confused plan can
restructure a real backlog faster than a human can interrupt it. Design against confusion, not
malice.

- Read tools open within scope; **every write tool is dry-run by default**, returning a diff.
- The confirmation token must be **bound to that exact diff**, not to the session. A token
  authorising "whatever apply does next" is a round trip, not a control. Test that a stale token is
  rejected after state moves.
- Return small, structured results. An agent that must read 200 initiatives to answer one question
  will do it badly and expensively.
- **Never put a real title in a tool description or example.** Use `fixtures/`.

Review your tool descriptions by running a real agent against them and checking it picks the right
tool unprompted.

Finish on a branch (`ws/<id>`): the journal entry and `STATUS.md` row first, then a pull request
filled in from `.github/pull_request_template.md`. **Opening it is not the end: read its checks back
until every one reports green** — a push resets that, and a check that is queued, in progress or not
yet reported is not green. Fix what is red and push again; never weaken a check to get past it.
**Do not merge it yourself** — a human merges.

Rules, and what to do at each ending: `docs/40-workstreams/README.md#read-the-checks-back`.
