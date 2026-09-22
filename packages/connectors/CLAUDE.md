# packages/connectors

**Everything prisme knows about the outside world arrives here.**

Owned by [W03](../../docs/40-workstreams/W03-connectors.md) (read) and
[W04](../../docs/40-workstreams/W04-reconciler.md) (write).
Specs: [`16-sync.md`](../../docs/16-sync.md) · [`11-ownership.md`](../../docs/11-ownership.md).

## Non-negotiables

1. **Responses are untrusted input.** Parse every one with Zod before any other code sees it. Data
   arriving from the user's own workspace still contains markup, arbitrary URLs and content pasted
   from the open web — and it flows into rendering *and* into agent context.
2. **External stores are addressed by role key**, never by name or ID: `objectives_db`,
   `takeaways_db`, `media_db`, `areas_db`, `processes_db`, `reviews_db`, and — since ADR-0025 —
   `initiative_pages_db`, `project_pages_db`, `initiative_page_template`, `project_page_template`.
   No real name or ID may appear in this repository
   ([`17-privacy.md`](../../docs/17-privacy.md)).
3. **Never guess a mapping.** An unexpected shape fails the run with a message naming the field.
   Guessing produces silent corruption of real data.
4. **No domain logic here.** This package maps wire formats to typed records and does nothing
   clever. Decisions belong in `packages/domain`.
5. **Write only what [`11-ownership.md`](../../docs/11-ownership.md) says prisme owns.** In
   particular: prisme writes `deadline`, and **never** `due`.

## Shape

```
connectors/
  errors.ts      one error type, a closed set of failure kinds
  role-key.ts    role → external id, and the read/write/create capability per role
  parse.ts       the boundary: parse or fail, with the path redacted
  sanitise.ts    text + allow-listed marks, URL collection, deny-by-default fetch
  hash.ts        canonical content hashing
  watermark.ts   the two-minute overlap, and no-op suppression
  metrics.ts     the instrumentation port — no prom-client dependency here
  http/          backoff, transport seam, the retry and failure policy
  task-tool/     wire schemas, mapping, subtree walk, client        (read: W03)
  doc-tool/      wire schemas, property and block mapping, client   (read: W03)
  testing/       `@prisme/connectors/testing` — recorded transports and clients
```

The write path (W04) belongs beside the two `*-tool/` directories, not inside them: a module that
can write is worth being able to find.

## Conventions

- Every client is an interface with a recorded-fixture implementation for tests.
- Idempotency keys on every write, so a retry after a timeout cannot apply the same change twice.
- Backoff with jitter on `5xx`; honour `Retry-After` on `429`; **stop immediately** on an invalid
  token — retrying a bad credential risks lockout.
- Collect URLs found in third-party content; never fetch one without an allow-list.

## The pinned API version

Document-tool requests carry a **pinned** version header, held in `doc-tool/client.ts`. It stays
pinned — the tool dates its breaking changes, and an unpinned version is a silent upgrade — and the
*value* has to be a version that exists: the tool rejects a string it does not recognise, so a
guessed date is not a way to move forward.

A version accompanies **breaking** changes, so a bump is not a one-line edit. Every endpoint this
package calls is checked against the new version before the bump lands, and the wire schemas are
part of that check — a field can be renamed while the schema still parses, and then the mapping
reads a default instead of the truth.

A wrong pin is not loud. The read paths report a refused query as **"not read"**
(`apps/sync/src/adoption/run.ts` swallows the error deliberately, because the message would carry
the role binding), so a version/endpoint mismatch looks like an instance that has bound nothing.

## The watermark trap

Change timestamps in the document tool round **down** to the minute, so querying `>= last_run`
misses edits made in the same minute as the previous run. Overlap the watermark by two minutes and
compare a content hash to suppress no-ops.

Without this, sync looks healthy and quietly loses edits — the worst possible failure mode.

## Testing

**No test may call a real API.** A suite depending on someone's real workspace fails for the wrong
reasons and leaks instance data into fixtures.

When recording a fixture from a real response: **redact every title, name, ID and URL before
saving**. Keep the shape — that is the only part a contract test needs.
