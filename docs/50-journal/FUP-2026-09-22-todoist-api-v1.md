# FUP · 2026-09-22 · The task tool's v9 API is gone; prisme now speaks v1

**Agent:** Claude · **Duration:** one session · **PR** [#45](https://github.com/vchatela-org/prisme/pull/45) · **Outcome:** complete

Found while preparing the deployment, and it is not a follow-up in the usual sense: **the entire
task-tool path was dead**. Every call returned `410 Gone` —

> This endpoint is deprecated… please update your use case to rely on the new API endpoints,
> available under `/api/v1/`.

That is the incremental read, the full fetch, completion history (so capacity actuals) and the
**write** path. Nothing in this repository caught it, because nothing in this repository is allowed
to call a real API (`packages/connectors/CLAUDE.md`) — the recorded fixtures describe the shape the
wire used to have, and they kept describing it faithfully.

## What was done

- **All three call sites moved**, and a repository-wide search confirmed there were only three:
  `task-tool/client.ts` (sync, and completion history), `write/command.ts` (the write path), plus
  the URL expectations in `base-url.test.ts`.
- **`POST /api/v1/sync`** replaces `POST /sync/v9/sync` for **both** the read and the write. The
  deprecation notice names one replacement for both, and it kept v9's form-encoded body — including
  `commands`, `sync_status` and `temp_id_mapping` — and v9's response shape.
- **`GET /api/v1/tasks/completed/by_completion_date`** replaces `POST /sync/v9/completed/get_all`.
  Different method, different transport, different envelope, different paging model and — as it
  turned out — a different item shape.
- **Cursor paging replaces offset paging**, in `client.ts` and in the recorded-fixture seam, which
  now reaches its pages *through their cursors* rather than by counting requests. A client that
  ignores `next_cursor` is served page one again, so the test has teeth.
- **`until` is now sent always.** The endpoint requires it; a caller that omits it (W13's
  single-window read) gets "up to now" rather than an unbounded window.
- **The wire schema for a completion changed field**: `id`, where v9 sent `task_id`.
- **Two fixtures and one new malformed fixture**: completion history is now two pages, page one
  deliberately **shorter than the page size while still carrying a cursor**; and a completion in
  v9's shape, which must fail.
- **The privacy deny-list gained a pattern**, and `docs/17-privacy.md` §2.4 was corrected — see
  *Surprises*, this is the part of the migration that is not about HTTP.

## Decisions taken

**Paging ends on the absence of a cursor, never on a short page.** The endpoint can return fewer
items than `limit` and still hold more. The old loop's `items.length < PAGE_SIZE` test was correct
for offset paging and is silently wrong here: it truncates completion history, and completion
history is what per-area capacity actuals are built from. This is the single most consequential
line in the change, and it is why page one of the fixture is short by construction — a fixture that
happened to fill its page would have let the wrong termination rule pass.

**`until` is defaulted in the client, not at each call site.** Every caller that omits it means
"up to now", so translating that once — rather than teaching four call sites about a new required
parameter — keeps the interface W13 was written against. `now` was already an injected option on
this client, so the default is testable and no clock was introduced.

**The completion item is parsed as the task shape, strictly.** Not "accept `task_id` or `id`".
`packages/connectors/CLAUDE.md` §3 forbids guessing a mapping, and a lenient union would hide the
next rename rather than surface it. The malformed fixture is the executable form of that choice.

**The recorded fixture pages by cursor, not by call order.** The previous seam advanced an index on
every request, which would have handed the next page to a client that ignored the cursor entirely —
a green test for the exact defect being fixed. Reaching the page through its cursor is the only
version of this seam that can fail.

**The backfill fake's window was corrected to match the wire.** It filtered `[since, until)`; the
live endpoint returns `[since, until]`. It now says so, and deliberately does **not** compensate:
the dedupe that makes the overlap harmless is `(externalTaskId, completedAt)` in the store, and a
fake that hid the overlap would stop that being tested.

**The deny-list gained a second id pattern rather than replacing the first.** The old numeric
pattern still covers label ids and anything recorded earlier; the v1 shape is a different pattern
entirely, not a wider one. The leading `\b` is load-bearing and was found by testing, not by
reasoning: without it the pattern matches `operationId: 'createInitiative'`, because `createInitiative`
is exactly sixteen characters.

## Surprises

**The ids changed shape, and that is a live write hazard.** v1 object ids are opaque 16-character
alphanumeric strings; v9's long numeric ids are **rejected** with `error_code 557`,
`error_tag V1_ID_CANNOT_BE_USED`. A read and its write agree because both now come from v1 — but an
external id held over from a pre-migration sync does not, and a write against one fails rather than
applying. The reconciler re-reads in full every pass (`docs/16-sync.md` §2, ADR-0009), which is what
refreshes them; the hazard is a write issued *between* the migration and the first full pass. It
fails loudly, which is the acceptable half of the pair.

**The completion endpoint returns a task, not a completion record.** v9's `completed/get_all`
returned `task_id`; v1 returns the whole task with `id`. The field rename is the whole of the
mapping change, but it is the kind of thing that would have failed every page — and the brief that
commissioned this work described the item as "the same shape as v9's", which it is not. Measured,
not assumed, is what caught it.

**The window is closed at both ends, not half-open.** `since` and `until` are both **inclusive**.
`types.ts` documented `[since, until)` — a claim about the wire that the wire does not make. The
consequence is bounded and worth stating plainly: adjacent slices meeting on an instant both return
a completion sitting exactly on it. Nothing here changes the slicing; W13's `(task, completed_at)`
idempotence is what absorbs the overlap, and that is now the reason it is load-bearing rather than a
belt-and-braces detail.

**`task-tool-sync-full.json` and friends still parse — the read path needed no schema change.** The
sync response shape genuinely is unchanged, which is what the deprecation notice implies and what
the live response confirms. Worth recording because the opposite was the reasonable prior.

**The migration quietly weakened a privacy control.** `.github/privacy-denylist.txt` covered
`(task_id|project_id|section_id)["'= :]+[0-9]{8,}` — Todoist *numeric* ids, in three named fields.
The migration invalidated it twice over: the shape became 16-character alphanumeric, and the id
field became `id`. A real v1 identifier pasted into this repository would not have been caught, and
`docs/17-privacy.md` §2.4 would have gone on asserting the opposite. Both are corrected here rather
than left as a follow-up, because a control that silently stops covering the thing it exists for is
worse than no control — it is a false assurance, which is the failure mode this repository already
records having been saved from twice (W06, and the base-url entry).

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| A write against an id read before the migration fails with 557 | Not fixable by reading — the id is the tool's to reassign. The full pass refreshes; a deployment migrating in place should run one before enabling writes | the human, when the write freeze lifts |
| `parent_id` is in the new deny-list pattern but nothing reads it | It is on the wire and in a position someone could paste; the pattern is cheap and the file is the wrong place to be clever | nobody — recorded so a reviewer knows it was deliberate |
| camelCase id positions (`projectId: "…"`) are still uncovered | The deny-list is line-based and case-insensitive but has no camelCase variants; adding them produced a false positive on `projectId = parentExternalId`, which is a sixteen-character camelCase token in an id position | a later follow-up, needing a pattern that can tell a value from an expression |
| The committed fixture harness | Tenth session to need one. Still on disk, gitignored, still stale | a later follow-up |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `privacy deny-list` | local + CI | clean — 44 patterns, worktree **and** staged, including the local supplement |
| `gitleaks` | CI | see the rollup on the pull request |
| `security gate self-test` | CI | see the rollup on the pull request |
| `internal links` | CI | see the rollup on the pull request |
| `dependency review` | CI | see the rollup on the pull request |
| `typecheck` | local + CI | clean — `tsc -b`, and `tsc --noEmit -p apps/web/tsconfig.json` |
| `lint` | local (per package, CI runs it whole) | clean — `eslint` on `packages/connectors` and `apps/sync/src`; `prettier --check` clean on every changed file |
| `test` | local + CI | unit **1 830 passed**, 107 files; integration **186 passed**, 9 files |
| `build` | local + CI | `pnpm build` clean, three apps; `git diff --exit-code` unchanged by it |
| `golden fixtures` | CI | see the rollup on the pull request |
| `dependency audit` | CI | see the rollup on the pull request |
| `images` | CI | see the rollup on the pull request |
| `CodeQL (actions)` / `(javascript-typescript)` / `(python)` | CI | see the rollup on the pull request |

**Before and after, against the live API.** All three old paths answer `410` with the deprecation
notice; `/api/v1/sync` answers `200` and the same response shape. The numbers observed, not
inferred: a full sync returned 8 projects, 39 sections, 10 labels and 242 items with a sync token;
completion history over a three-week window returned 98 items across two cursor pages (50 then 48
— the second page short, which is the termination rule's whole point); a bogus v9-style numeric id
was rejected with `557 V1_ID_CANNOT_BE_USED`, and a create/delete pair round-tripped with a
`temp_id_mapping` id. No live call was made by any test.

**The integration database was recreated, not migrated around.** It carried migration `0009`, which
the unmerged sync-metrics branch ships and `main` does not, so `runMigrations` refused — the
database was ahead of the binary, which is the guard working. Dropped and recreated, then run
green. This change adds no migration.

## Privacy

Fixture and invented data only. The live checks were run from a scratch script **outside** the
repository and printed shapes and counts, never a title, name or id; the one object the write probe
created was deleted in the same run. Every fixture added here uses the `task-0001` style this
repository already documents, so nothing was refreshed from production. The deny-list change adds a
*pattern*, never a value, and the local supplement was active for both scans.

## Specs touched

- [`packages/connectors/src/task-tool/types.ts`](../../packages/connectors/src/task-tool/types.ts) —
  `fetchCompletions`'s window is documented as inclusive at both ends rather than `[since, until)`,
  `until` as required by the endpoint, and paging as ending on the absence of a cursor.
  **This is the one place a spec was wrong about reality**, and it was wrong in the direction that
  matters: a caller could reasonably have relied on the half-open claim.
- [`docs/17-privacy.md`](../17-privacy.md) §2.4 — the deny-list's id shapes were described as
  "Todoist numeric IDs", which the migration made untrue. Both shapes are now named.
- `docs/16-sync.md` needed **no change**: it specifies the cadence, the watermark overlap and the
  plan/apply contract, and deliberately says nothing about an endpoint or a paging model. Worth
  recording, because "the sync spec" is the obvious first place to look for this and there would
  have been nothing to find.
