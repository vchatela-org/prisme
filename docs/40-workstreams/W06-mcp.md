# W06 · MCP server

**Depends on:** W05 · **Wave:** 3
**Files you may touch:** `apps/api/mcp/**`

## Why

The point of prisme having an MCP surface is that an agent can run a review, propose a `now` set, or
answer "what should I do today" without a human copying data between tools.

It is also the sharpest edge in the system. An agent with a write token and a confused plan can
restructure a real backlog faster than a human can interrupt it.

## Read first

- [`../14-threat-model.md`](../14-threat-model.md#4-the-mcp-surface) — the whole section
- [`../16-sync.md`](../16-sync.md) — the `plan`/`apply` split you are mirroring
- [`../10-model.md`](../10-model.md) — the vocabulary your tool descriptions must use

## Scope

1. **Read tools**: `focus_now`, `list_initiatives`, `area_balance`, `kpi`, `objectives`,
   `list_takeaways`, `sync_status`, `explain_score`.
2. **Write tools**: `capture`, `promote_takeaway`, `score_initiative`, `set_status`,
   `propose_now_set`, `start_review`, `record_review_decision`, `plan_preview`, `apply`.
3. **Dry-run by default**: every write tool returns a **diff** and takes no action. Executing
   requires a `confirmation_token` returned by that dry run — bound to that exact diff, short-lived,
   and rejected if state has moved since.
4. **Scopes**: read and write scopes are distinct, so a read-only token is genuinely read-only.
5. **Audit**: every MCP-initiated write is recorded in the event log with the token identity as
   actor.
6. **Tool descriptions**: precise enough that an agent chooses correctly. State what a tool will
   *not* do as clearly as what it will.

## Out of scope

The REST API (W05) · the token store and scope enforcement (W14) · reconciler internals (W04).

## Contract

- An MCP server mounted on the API process, sharing its authentication and authorization.
- Thin: every tool delegates to the same service layer the REST API uses. **No business logic here.**
- A machine-readable tool manifest.

## Definition of done

- A write tool invoked without a confirmation token performs no write and returns a readable diff.
- A stale confirmation token — state changed since the dry run — is **rejected**, proven by a test.
- A read-scoped token cannot invoke any write tool.
- Every write appears in the event log with the correct actor.
- An end-to-end exercise: an agent reads the focus list, proposes a `now` change, and applies it
  only after explicit confirmation.
- Tool descriptions reviewed by running a real agent against them and checking it picks the right
  tool unprompted.

## Notes

- **The confirmation token must be bound to the diff, not merely to the session.** A token that
  authorises "whatever apply does next" is not a control; it just adds a round trip. Hash the diff
  into the token and compare on use.
- Assume the agent is confused rather than malicious. The failure to design against is a well-meaning
  agent looping on a misunderstood instruction — which is why threshold refusals matter more than
  authentication here.
- Return small, structured results. An agent that must read 200 initiatives to answer one question
  will do it badly and expensively.
- **Never put a real title into a tool description or example.** Examples use `fixtures/`.
