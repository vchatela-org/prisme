# W03 · Connectors — read path

**Depends on:** — · **Wave:** 1
**Files you may touch:** `packages/connectors/**`

## Why

Everything prisme knows about the outside world arrives through here. The read path is needed before
anything else can be tested against reality, and it is entirely independent of the domain model — so
it starts on day one.

## Read first

- [`../11-ownership.md`](../11-ownership.md) — what prisme reads versus writes
- [`../16-sync.md`](../16-sync.md) — incremental sync, watermarks, the two-minute overlap
- [`../14-threat-model.md`](../14-threat-model.md) — **responses are untrusted input**
- [`../17-privacy.md`](../17-privacy.md) — external databases are referenced by **role key**

## Scope

1. **Task-tool client**: incremental sync via sync token, full fetch, projects, sections, tasks at
   any depth, labels, completion history with durations.
2. **Document-tool client**: query by role key, change-timestamp watermark with a **two-minute
   overlap** and content hashing to suppress no-op updates, pagination, rich-text extraction.
3. **Role-key binding**: `objectives_db`, `takeaways_db`, `media_db`, `areas_db`, `processes_db`,
   `reviews_db` resolved from configuration. **No real database name or ID may appear in this
   repository.**
4. **Validation at the boundary**: a Zod schema per response shape, parsed before any other code
   sees the value. An unexpected shape fails the run with a clear message — **never guess a
   mapping**.
5. **Sanitisation**: rich text is normalised through an **allow-list**. URLs found in third-party
   content are collected but never fetched.
6. **Resilience**: exponential backoff with jitter on `5xx`; honour `Retry-After` on `429`; stop
   immediately on an invalid token — retrying a bad credential risks lockout.
7. **Instrumentation**: `prisme_external_requests_total{tool,status}`, latency histograms.

## Out of scope

The write path and idempotency keys (W04 owns those) · reconciliation logic · any domain reasoning —
this package maps wire formats to typed records and does nothing clever.

## Contract

```ts
export interface TaskToolClient {
  syncIncremental(token?: string): Promise<{ changes: TaskChange[]; token: string }>;
  fetchAll(): Promise<TaskSnapshot>;
  fetchCompletions(since: Date): Promise<Completion[]>;
}

export interface DocToolClient {
  queryByRole(role: RoleKey, since?: Date): Promise<DocRecord[]>;
  fetchPage(id: string): Promise<DocPage>;
}
```

Both are interfaces with a recorded-fixture implementation for tests.

## Definition of done

- Contract tests pass against recorded responses in `fixtures/connectors/` — **redacted** before
  they are saved.
- A malformed response fails validation with a message naming the field, rather than producing
  `undefined` three layers deeper.
- The watermark overlap is proven by a test: an edit in the same minute as the previous run is still
  detected.
- Content hashing suppresses no-op updates — verify a re-read of unchanged data yields zero changes.
- Backoff and rate-limit handling tested with simulated `429` and `5xx`.
- **No test touches a real API.** A suite depending on someone's real workspace fails for the wrong
  reasons and leaks instance data into fixtures.

## Notes

- **Rounded timestamps are the classic bug.** Change timestamps in the document tool round down to
  the minute, so `>= last_run` misses same-minute edits. The two-minute overlap plus hashing is the
  fix; without it, sync looks healthy and quietly loses edits.
- **Redact before saving a fixture.** Capturing a real response to debug something is fine;
  committing it is a privacy incident. Replace titles and IDs with synthetic values first.
- Treat every response as hostile input. It contains markup, arbitrary URLs and content pasted from
  the open web, and it flows into rendering and into agent context.
- This workstream is mechanical and well-specified — a good candidate for a cheaper model.
