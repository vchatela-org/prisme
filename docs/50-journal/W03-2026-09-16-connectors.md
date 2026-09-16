# W03 · 2026-09-16 · Connectors, the read path

**Agent:** Claude Opus 5 · **Duration:** one session · **PR** #18 · **Outcome:** complete

## What was done

`packages/connectors` now holds the complete read path to both external tools: the two client
interfaces from the brief, the wire schemas behind them, and the four rules that make the boundary a
boundary rather than a comment. Each rule got its own module, because a rule with an address is a
rule that can be tested:

| Module | What it refuses to let happen |
|---|---|
| `parse.ts` | A response reaching any other code unparsed, or a failure that does not name the field |
| `role-key.ts` | A store addressed by anything but a role key; a read against a role prisme may not read |
| `sanitise.ts` | Markup being produced at all; a URL from content being fetched |
| `watermark.ts` | A same-minute edit being lost |
| `http/request.ts` | A rejected credential being retried |

Both clients are the real implementation over an injected transport, and `@prisme/connectors/testing`
exports recorded-fixture versions built the same way. 144 tests, no network reachable from any of
them.

## Decisions taken

**A Zod issue path is filtered before it reaches an error message.** The document tool keys a page's
properties by their *user-defined names*, so a raw path reads `results.0.properties.<someone's
column>.number` — instance data, on its way into a log line, from the one code path that runs when
something is already going wrong. A path segment now survives only if it looks like a wire key
(lower-case snake_case) or an array index; everything else becomes `<redacted>`. The rule errs
towards redaction, and losing a little debuggability is the right side to err on. Messages are also
built from the issue's `code` and `expected` rather than Zod's rendered text, which can quote the
input.

**"Unknown type" and "wrong payload" are different events.** A property type prisme has never heard
of is recorded as `unsupported` and skipped — a tool adding a feature next quarter must not break a
sync. A type prisme *does* know, carrying a payload it does not document, fails the run. These get
conflated, and conflating them costs either way round: fail on both and every upstream release is an
outage; shrug at both and a changed `number` field writes a wrong value into a real workspace.

**Three property types are declined rather than unsupported.** `people`, `email` and `phone_number`
are the most sensitive properties a personal workspace has and no prisme feature needs one;
`files` carries expiring signed URLs, and storing one is storing a credential. They map to
`not_read` with a count. Recording that a property exists, and nothing about it, is a different
statement from not understanding it, and the type says which.

**`reviews_db` is write-only, enforced in the read path.** docs/14-threat-model.md §5 already said
so; `assertReadable` makes `queryByRole('reviews_db')` throw rather than leaving it to a token scope
that may be broader than intended.

**A day-long duration is not 1440 minutes of capacity.** The task tool records durations in minutes
*or* days, and those are not the same measurement — one is "this took 45 minutes", the other is a
block-out in a calendar. Flattening the second would let one all-day task outweigh a fortnight of
real work in the capacity actuals. `recordedMinutes` is populated only for the minute form; the raw
value is carried alongside for W13 to decide on.

**Instrumentation is a port, not the registry.** `prisme_external_requests_total{tool,status}` is
incremented through a two-method interface, so the package has no `prom-client` dependency and a
test asserts what was recorded by reading an array. See the follow-up about the histogram.

**The recorded clients are the real clients.** A hand-written fake would satisfy the interface and
prove nothing about the schemas, the mapping, the pagination or the hashing — and it would keep
passing for months after the wire format moved. Building them over a recorded transport instead
means the contract tests exercise everything except the socket.

## Surprises

**The watermark test needed to assert the bug first.** Writing "the overlap catches a same-minute
edit" is not enough: it passes just as well against an implementation that quietly dropped the
overlap and queried from the beginning of time. The test now asserts that the naive `>= last_run`
really does miss the edit — the tool rounds the timestamp *below* the watermark — before asserting
that the overlap catches it. Half the value of that test was in the half nearly left out.

**Realistic identifier shapes would have required weakening the privacy control.** Both tools use
identifier shapes the deny-list refuses on sight — 32-character hex, long numeric IDs — and a
faithfully-shaped fixture would have had to be added to `.privacyignore`, i.e. a hole in the exact
control that catches a real ID pasted into a file. The fixtures use `task-0001` and `doc-page-0001`
instead. Nothing in the read path parses an external ID, so the shape is the one part of the wire
format a contract test does not need. Two test cases had the same problem from the other direction
and are assembled from parts, each with a comment saying why.

**CodeQL found three ReDoS holes that every local check had passed.** `typecheck`, `lint`, `test`
and both privacy scans were green; the pull request came back with three high-severity
`js/polynomial-redos` alerts, all of them the same idiom — `value.replace(/[…]+$/, '')` to strip
trailing characters. An anchored `+` over a character class is quadratic, and one of the three ran
on **paragraph text from the document tool**, so a paragraph ending in a long run of punctuation
would stall a pass while it held the advisory lock. Replaced with a linear backwards scan
(`util/trim.ts`), with a regression test that feeds it 100,000 exclamation marks. Worth recording
for two reasons: the idiom is idiomatic, so it will be written again; and this is the gate earning
its place — it caught something no other check in the set could have.

**The form encoder does not escape `*`.** The full-sync token is `*`, and the recorded transport
matched on `sync_token=%2A` — so every "full pass" test was quietly served the incremental fixture.
Fourteen tests failed at once, which is the good version of this mistake; the same bug in a matcher
that was slightly less wrong would have passed. The transport now parses the body rather than
pattern-matching it.

## Follow-ups

- **`prisme_external_request_duration_seconds` does not exist.** The brief asks for latency
  histograms; docs/15-runtime.md §5 lists no such metric, and adding one means editing
  `@prisme/observability` and that spec table — neither in this workstream's tree. The sample
  carries `durationSeconds` already, so the adapter needs one line once the metric lands.
  **Owner:** whoever wires the sync app to these clients (W04), with a one-line spec change.
- **No environment variable carries the role bindings.** docs/15-runtime.md §2 says the identifiers
  load from the seed path into the database, so the clients take a `RoleBindings` object and
  `roleBindingsSchema` parses whatever the caller loaded. The loader itself is unwritten.
  **Owner:** W04.
- **The endpoint paths have never been exercised against a live API.** No test may reach one, which
  is correct and also means the URL templates, the API version header and the query filter shape are
  unverified. The first real run will find anything wrong in seconds; nothing downstream depends on
  them being right before then. **Owner:** W04/W12, at the first `plan`.
- **`fetchPage` recurses three levels into block children and stops.** A deeper page loses its
  deepest prose. The bound is a constructor option; raising it costs requests. Revisit if a real
  page turns out to be deeper. **Owner:** W12.
- Nothing here writes, and `@prisme/connectors` has no `last_applied` or idempotency-key machinery.
  That is W04's, deliberately.

## Specs touched

None. Everything implemented here was already written down: docs/16-sync.md §2 and §6,
docs/11-ownership.md §5, docs/14-threat-model.md §5, docs/17-privacy.md §1. The one place reality
diverged from a brief — the missing latency histogram — is a follow-up above rather than a spec edit,
because the spec is not wrong, it is simply silent.
