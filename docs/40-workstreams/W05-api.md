# W05 · REST API

**Depends on:** W01, W03 · **Wave:** 2
**Files you may touch:** `apps/api/**` (excluding `apps/api/mcp/**` and `apps/api/auth/**`)

## Why

One API serves the web UI, the MCP server and any script. Every surface reads the same data through
the same contract, so there is one place where authorization, validation and shape are decided.

## Read first

- [`../10-model.md`](../10-model.md) — the entities you expose
- [`../14-threat-model.md`](../14-threat-model.md) — deny by default, parse at the boundary
- [`../11-ownership.md`](../11-ownership.md) — read-only fields must be rejected on write, not
  silently ignored

## Scope

1. **Resources**: areas and year weights · projects · initiatives (including scoring, status
   transitions, dependencies) · objectives and key results · tasks (read-only mirror) · takeaways ·
   rituals · reviews · the adoption queue · settings · sync status.
2. **Query surface**: the Focus list, backlog with filters and sorting, area balance, KPI series,
   timeline data. These are the endpoints the UI actually needs — design them for the screens in
   [`../10-model.md`](../10-model.md), not as generic CRUD.
3. **Validation**: one Zod schema per endpoint, parsed before anything else. Explicit field
   allow-lists on writes — never spread a parsed body into an update.
4. **Authorization hooks**: every route declares a required scope. A route without one **fails a
   test**. W14 supplies the mechanism; you supply the declarations.
5. **`POST /sync`**: trigger the reconciler in-process behind an advisory lock; return last-run
   metadata.
6. **OpenAPI**: generated from the schemas, not written by hand.
7. **Errors**: a consistent shape, with a correlation ID and **no internal detail**.

## Out of scope

MCP tools (W06) · the authentication mechanism itself (W14) · reconciler internals (W04) · UI.

## Contract

- A stable REST surface with a generated OpenAPI document, versioned under `/api/v1`.
- Typed client types exported for the web application to consume directly.
- Every response DTO is explicit — **never** return a database row.

## Definition of done

- OpenAPI generates and validates; the type-checked client compiles against it.
- A route with no declared scope fails a test. Write that test first; it is the guard that keeps
  deny-by-default true as routes are added.
- Writing to a read-only field returns `400` naming the field, rather than succeeding silently.
- Integration tests run against a real PostgreSQL instance seeded from `fixtures/`.
- Pagination, filtering and sorting work on the backlog endpoint at realistic volume.
- Error responses leak nothing: no stack traces, no SQL, no upstream messages.

## Notes

- **Design the endpoints around the screens.** Generic CRUD forces the UI into N+1 request patterns
  and then the UI grows its own aggregation logic, which is how two sources of truth appear.
- Return explicit DTOs. Returning rows means a new database column silently becomes public API, and
  that is how an internal field ends up in an agent's context.
- The read-only-field rejection matters more than it looks: it is the API-level expression of
  ADR-0008, and silently ignoring such a write teaches the caller that it succeeded.
- Seed integration tests from `fixtures/` only.
