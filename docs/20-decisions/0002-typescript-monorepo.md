# ADR-0002 · TypeScript monorepo

**Status:** Accepted · 2026-09-15

## Context

prisme needs a rich UI, a REST API, an MCP server and a reconciler. The UI is the demanding part:
Gantt charts, drag-and-drop, dense tables, live charts.

## Decision

A **TypeScript monorepo** (pnpm workspaces). Next.js for the web UI, Hono for the API and MCP
server, PostgreSQL via Drizzle, the official MCP TypeScript SDK.

```
apps/{web,api,sync}   packages/{domain,connectors,ui}
```

## Consequences

- One language across UI, API, MCP and reconciler; types shared at compile time rather than
  regenerated across a boundary.
- Strongest ecosystem for the UI work, which is where most of the effort will go.
- `packages/domain` stays pure and is consumed by every app — the scoring and planning logic has
  exactly one implementation.
- Node's runtime footprint is larger than a compiled binary. Acceptable for a personal deployment.
- Analytical work later (trend fitting, revealed-preference scoring) is less comfortable than in
  Python. If that becomes real, it belongs in a separate service reading the same database, not in
  a rewrite.

## Alternatives

**Python backend + React frontend.** Better for analytics; matches the reconciler sketched
earlier. Rejected: two languages, two pipelines, and shared types must be generated from OpenAPI —
a permanent tax for a benefit that is speculative today.

**Go backend + React frontend.** Best runtime footprint, and the reconciler pattern maps cleanly.
Rejected: slowest path to a rich UI, weakest SDK story for both external tools, still two
languages.
