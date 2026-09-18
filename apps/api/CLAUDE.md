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

### `mcp/` — what W06 built

Seventeen tools on `POST /mcp`, outside `/api/v1` and outside the OpenAPI document. The protocol is
implemented here rather than taken from the reference SDK
([ADR-0024](../../docs/20-decisions/0024-mcp-without-the-sdk.md)) — so **conformance is ours**, and
`mcp/protocol.test.ts` is what holds it.

- **A tool is declared, never dispatched by hand.** `mcp/tool.ts` is `http/route.ts` for this door:
  name, scope, schemas, handler. `defineWriteTool` cannot produce a tool without a `plan`, so there
  is no way to write one here that acts on first call.
- **The endpoint reads the tool's scope before it authenticates**, and hands *that* to the
  authorizer. This is what makes the kill switch reach a tool added later without anyone writing a
  check for it — do not replace it with a single scope for the whole endpoint.
- **A plan must be able to go stale.** Read `before` from the world, and put nothing clock-dependent
  in a diff: a timestamp inside makes every confirmation stale on arrival. Use the `observe` op for
  state a plan reads only so the hash can move — never `create`, which feeds the count ADR-0010
  guard 3 is about.
- **A refusal belongs in `plan`.** A dry run that cannot show the refusal is not a preview of the
  write.
- `tool-manifest.json` is generated and checked in. `vitest -u` rewrites it; the point is that a
  reviewer reads the diff, because a tool description is not reviewed anywhere else.

## Layout

```
api/
  http/       the route kit: scopes, one error shape, parsing, mounting, OpenAPI
  dto/        request and response schemas, and the fields each write refuses
  routes/     REST, one module per resource — declarations, not logic
  services/   shared by routes and MCP tools; the only place a rule lives
  store/      the port, and its one implementation in SQL
  client/     the response types the web application imports
  sync/       the POST /sync port, and the reconciler behind it
  mcp/        the tool kit, the tools, the JSON-RPC dispatcher and its endpoint (W06)
  auth/       assertion verifier, token store, authorizer, kill switch (W14)
```

**A route is declared, never mounted by hand.** `http/route.ts` takes a method,
a path, a required scope, the schemas on either side and a handler; the router,
the OpenAPI document and the contract test are all generated from that one
object, so they cannot disagree. `routes/contract.test.ts` reads back what the
application actually registered and fails on anything reachable that the
registry does not describe — which is the only way a route could exist without
a scope.

## `auth/` — what is already built

W14 landed the mechanism, so a new route or tool inherits it rather than arranging it:

- **Every principal reaches a handler through one authorizer.** Assertion *or* bearer, never both;
  identity only from a verified signature; the gateway's plaintext identity headers are not read
  anywhere ([ADR-0021](../../docs/20-decisions/0021-verified-forward-auth-assertion.md)).
- **The kill switch withholds scopes** rather than setting a flag, so a write route added later is
  covered on the day it is written. Do not add a second "are writes frozen" check.
- **`createConfirmationService` and `hashPlan`** are the diff-bound confirmation mechanism. W06 wires
  them to its write tools; nothing else should invent its own.
- **`assertUrlAllowed`** is the SSRF guard for any URL prisme fetches. Deny by default, by origin.

## Testing

Integration tests run against a real PostgreSQL instance seeded from `fixtures/` — never from real
data. Test the authorization negative cases explicitly: a read-scoped token must not reach any write
path.

**Database-backed suites are named `*integration.test.ts`**, which puts them in the `integration`
Vitest project. That project runs its files one at a time: they share one PostgreSQL and truncate it
between tests, so two running in parallel means one empties the other's tables mid-test. Name a new
one accordingly, or it will fail in ways that look like somebody else's bug.
