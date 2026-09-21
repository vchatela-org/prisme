# FUP · 2026-09-21 · The document tool is finally readable

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes the gap the user's own summary calls *"the single biggest one … repeated across four journal
entries"*: **nothing in this repository loaded the role bindings**. `createDocToolClient` had no
caller outside test code, so the document tool was never read — which gated W12's document-tool
classifier and W13's declared-duration tier at once, and is a prerequisite for closing W15's *Create
page* (a second pull request).

W03 built the client and the schema and recorded that "the loader itself is unwritten". W12 and W13
each found the consequence and each recorded it as a missing dependency with no owner. This is the
owner.

## What was done

- **`packages/db/migrations/0008_bindings.sql`** — `role_binding`, the table
  [`15-runtime.md` §2](../15-runtime.md) has said since P0 that the identifiers load into.
- **`apps/sync/src/bindings.ts`** — parse a seed file, replace the table, read it back as the
  `RoleBindings` a connector addresses stores through.
- **`prisme-sync bindings --from <path>`** — the command. A path rather than a default, for the
  reason `backfill --from` takes a date: the seed directory is gitignored and its mount point is
  deployment detail, and a command that silently read nothing from a path that does not exist would
  look like a success.
- **`main.ts` wires the client into both passes that were waiting for it** — `adopt` and `backfill`
  now construct a `DocToolClient` from the stored bindings.
- **`DOCTOOL_DURATION_PROPERTY`** in `@prisme/config` — the property name the declared-duration tier
  reads, which had no home at all before this. Unset leaves the order two-tier, and the report says
  so.
- **`fixtures/bindings.json`** — the loader's test fixture, invented identifiers, and the reason it
  is not `seed.example/bindings.json` is below.

## Decisions taken

**A role with no binding is not addressable, and every caller already handles that.** The connectors
throw `unbound_role`; `adoption/run.ts` and `backfill/processes.ts` both catch it and report
**"not read"**. So an instance that has bound three of six roles scans what it has and says so,
rather than failing a pass over a store it never claimed. Nothing new was needed to make partial
binding safe — which is the strongest evidence that the connectors were written for this and only
the loader was missing.

**The command replaces the whole table.** A merge would leave a role bound to a store the file no
longer mentions, and the operator would have no way to unbind one short of truncating the table by
hand. Same instinct as a scan replacing its candidate mirror wholesale (ADR-0009).

**No CHECK on `role`.** The vocabulary is `ROLE_KEYS`, and it grows — ADR-0025 proposes four more
keys. A CHECK would mean a migration for every addition, and the loader parses the file through
`roleBindingsSchema`, so an unknown role is refused *before* it reaches the table. A stale row is
therefore possible and inert, and there is a test that says so.

**The duration property is configuration, not seed data.** The document tool keys its properties by
whatever an instance calls them, so no name may be compiled in — but it is a name rather than an
identifier, and `AUTH_ALLOWED_SUBJECTS` is precedent for instance data arriving as configuration.

**`DOCTOOL_BASE_URL` was deliberately not added.** It is a separate W15 follow-up (driving the
outward path against a stub) and nothing here needs it; the client's built-in default is correct for
a real instance.

## Surprises

**The example file cannot be the fixture, and that is the interesting part.**
`seed.example/bindings.json` ships `REPLACE-ME` in every slot, and the loader **refuses** it: an
instance that copies the example and forgets to edit would otherwise bind six stores to one nonsense
identifier and fail at the first query — a 404 from the document tool, nowhere near the file that
caused it. Refusing names the file and the role. The consequence is that the documentation of the
format and the fixture for the loader have to be two files, and `fixtures/bindings.json` is the
second. Found by writing the test that read the example and watching it fail, which is the only way
it could have been found.

**Zod's message for an unknown role lists the vocabulary and not the offending value.** A hand-edited
file needs the other one, so the loader checks the role itself before parsing and names it. The
schema still parses the result — the check is for the message, not for the guarantee.

**Two of this session's edits silently did nothing.** A `python` string replacement whose anchor did
not exist on the branch in question wrote the file back unchanged, and the following typecheck
passed because nothing had changed. Both were caught later — one by a typecheck error that made no
sense, one by looking for the symbol — but the lesson is cheap to state: an edit script asserts that
its anchor matched. The second half of gap 1 is large enough that the same mistake would have cost
much more than it did here.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| *Create page* | ADR-0025 proposes the vocabulary; that is the second pull request of this pair and it needs the bindings this one loads | this wave |
| `DOCTOOL_BASE_URL` / `TASKTOOL_BASE_URL` in `@prisme/config` | Still open from W15: the outward path cannot be driven against a stub without patching a constant by hand | a later follow-up |
| Nothing loads `areas.json` or `areaMappings` from the seed path | `seed.example/README.md` documents `pnpm seed:load` as loading all of `seed/`. Only the bindings have a loader; the areas and mappings arrive through the API today | a later follow-up |

## Checks

Locally before pushing:

| Check | Result |
|---|---|
| `npx vitest run` (both test database URLs set) | 1 943 passed, 112 files |
| `tsc -b` and `tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `eslint apps/sync/src packages/config/src` | clean |
| `prettier --check .` | clean |
| `pnpm build` | all packages and three apps |
| `./scripts/privacy-scan.sh` | clean, 43 patterns |
| `pnpm db:migrate` | `0008` applied to a real database, in the new suite's `beforeAll` |

## Privacy

Fixture and invented data only. The identifiers in `fixtures/bindings.json` are invented
(`binding-processes-0005`); the file is readable synthetic strings precisely so that nothing here
needs a UUID's shape, which the deny-list has refused twice in this project. The tests assert that an
identifier never reaches a log line or an error message. No real workspace identifier appears in this
entry or in the diff.

## Specs touched

[`docs/15-runtime.md`](../15-runtime.md) §2 — the *External bindings* section said where the
identifiers come from and not how they arrive; it now names the command and what a partial binding
means. The optional table gained `DOCTOOL_DURATION_PROPERTY`. `seed.example/bindings.json` gained a
`_loaded_by` note, because the file is the format an operator reads and it said nothing about what
consumes it.
