# apps/api

**REST API, MCP server, and the in-process reconciler entrypoint.**

Owned by [W05](../../docs/40-workstreams/W05-api.md) (REST),
[W06](../../docs/40-workstreams/W06-mcp.md) (`mcp/`), and
[W14](../../docs/40-workstreams/W14-security.md) (`auth/`).
Spec: [`14-threat-model.md`](../../docs/14-threat-model.md).

## Non-negotiables

1. **Deny by default.** Every route declares a required scope. A route without one **fails a test** —
   that test is what keeps this true as routes multiply. No ambient authority, including for the
   single user.
2. **Parse at the boundary.** One Zod schema per endpoint, parsed before anything else. Explicit
   field allow-lists on writes — **never** spread a parsed body into an update.
3. **Return DTOs, never database rows.** Returning a row means a new column silently becomes public
   API, which is how an internal field ends up in an agent's context.
4. **Reject writes to read-only fields** with `400` naming the field. Silently ignoring such a write
   teaches the caller it succeeded ([ADR-0008](../../docs/20-decisions/0008-field-level-ownership.md)).
5. **Errors leak nothing** — no stack traces, no SQL, no upstream messages. A correlation ID and a
   generic message.
6. **No business logic.** Delegate to `packages/domain`. The MCP tools and the REST routes must
   share one service layer, or they will disagree.

## The MCP surface is the sharpest edge

An agent with a write token and a confused plan can restructure a real backlog faster than a human
can interrupt it. Assume confusion, not malice.

- Read tools open within scope; **every write tool is dry-run by default**, returning a diff.
- Execution requires a confirmation token **bound to that exact diff**, short-lived, rejected if
  state has moved. A token authorising "whatever apply does next" is a round trip, not a control.
- Every MCP-initiated write lands in the event log with the token identity as actor.

## Layout

```
api/
  routes/     REST, one module per resource
  mcp/        tool definitions — thin wrappers over services   (W06)
  auth/       assertion verifier, token store, scope middleware (W14)
  services/   shared by routes and MCP tools
```

## Testing

Integration tests run against a real PostgreSQL instance seeded from `fixtures/` — never from real
data. Test the authorization negative cases explicitly: a read-scoped token must not reach any write
path.
