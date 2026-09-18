# ADR-0024 · The MCP surface is written against the specification, not the SDK

**Status:** Accepted · 2026-09-18

## Context

W06 mounts an MCP server on the API process. The obvious implementation is the reference SDK,
`@modelcontextprotocol/sdk`, and for most servers it would be the right answer: it is maintained by
the people who write the specification, and re-implementing a protocol is normally a mistake.

Two things make this case different.

**The dependency closure.** `@modelcontextprotocol/sdk@1.30.0` declares seventeen runtime
dependencies, and they are not incidental:

```
express, express-rate-limit, cors, raw-body, content-type    a second HTTP server framework
pkce-challenge, eventsource, eventsource-parser              an OAuth client and an SSE client
ajv, ajv-formats, json-schema-typed, zod-to-json-schema      a second schema validator
cross-spawn                                                  process spawning, for the stdio transport
hono, @hono/node-server, jose, zod                           already ours
```

`apps/api` is a Hono process. Taking the SDK adds Express 5 and its middleware to the tier the
threat model calls "the sharpest edge in the system"
([`14-threat-model.md §4`](../14-threat-model.md#4-the-mcp-surface)), for a transport we mount on a
route Hono already serves. It also adds an OAuth client and a process spawner to a service that
performs neither operation. Every one of those is reachable code in an image that runs with tokens
to the whole planning workspace.

**The layers it would duplicate are already built and already decided.** The SDK's value is
concentrated in session management, authorization, transport negotiation and schema conversion.
prisme has a decided answer for each, and they are not the SDK's:

| The SDK offers | prisme already has |
|---|---|
| `StreamableHTTPServerTransport` sessions | No session. Deny-by-default, credential on every request (ADR-0015, ADR-0021) |
| OAuth resource-server helpers | The authorizer: verified assertion or Argon2id bearer, never both (W14) |
| `express-rate-limit` | `auth/rate-limit.ts`, keyed on the credential after it is known |
| `zod-to-json-schema` | `z.toJSONSchema`, which Zod 4 ships and `http/openapi.ts` already uses |

Wiring the SDK would mean bridging its transport to Hono's `Context` — and `@hono/node-server`
exposes the underlying Node request only outside the Fetch API, which is the one thing every test in
`apps/api` drives the application through.

The part that is genuinely ours to get right is not the envelope. It is the diff-bound confirmation,
the per-tool scope, and the kill switch reaching a tool written next year — and none of that is
something the SDK supplies.

## Decision

**Implement the MCP server directly, against the published specification, in `apps/api/src/mcp/`.**

- Protocol revision **`2025-06-18`**, the one that removed JSON-RPC batching.
- **Streamable HTTP, stateless.** `POST /mcp` answers `application/json`; `GET` and `DELETE` answer
  `405`, which the transport specification explicitly permits for a server offering no
  server-initiated stream and no session.
- **No `Mcp-Session-Id`.** Session management is a MAY. A session would be a second thing carrying
  authority alongside the credential, and prisme has exactly one.
- `tools` is the only capability declared. No resources, no prompts, no sampling, no logging.
- The wire envelope is parsed by Zod at the boundary like every other input
  (`apps/api/CLAUDE.md` §2), and the fixture-driven conformance test is what holds us to the
  specification in place of the SDK's types.

## Consequences

- `apps/api` gains **no new runtime dependency**. The MCP surface is Hono, Zod and the existing
  `auth/` mechanism.
- Every tool is authorized by the same `Authorizer` the REST routes use, with the **tool's own
  scope** — so the W14 kill switch withholds a write tool's scope without W06 writing a check, which
  is what `auth/write-switch.ts` says it was built for.
- The MCP endpoint is testable through `app.request()`, the same Fetch-API path as every other
  suite. No Node `http` objects, no second server.
- **We own conformance.** A revision that changes the wire format is a change here, and nothing
  fails loudly if the specification moves — `mcp/protocol.test.ts` pins the shapes against the
  revision named above, and the revision is a constant in one file.
- Features arriving later — resources, prompts, elicitation, SSE streaming — are ours to write. None
  is in W06's scope, and adding one is a reason to revisit this ADR rather than to work around it.

## Alternatives

**Take the SDK and bridge it to Hono.** Rejected on the dependency closure above, and because the
bridge would put the MCP endpoint outside the Fetch-API path every other test uses — the surface
with the highest consequence of being wrong would become the one hardest to test.

**Run the MCP server as a separate process with the stdio transport.** Rejected: it contradicts
[`15-runtime.md §1`](../15-runtime.md), which places the MCP server in `prisme-api`, and a second
process would need its own copy of the service layer or a network hop to reach it. The brief is
explicit that tools delegate to *the same service layer the REST API uses*.

**Take the SDK and accept the dependencies.** Reconsider if prisme ever needs SSE streaming,
elicitation or resources, where the specification is larger and the SDK's value is higher than it is
for a tools-only server. That is a supersession, not a workaround.
