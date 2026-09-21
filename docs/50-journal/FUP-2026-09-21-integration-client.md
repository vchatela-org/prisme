# FUP · 2026-09-21 · The integration suite now builds the application's client

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes the follow-up W15 recorded and W11's shape predicted: *"the integration harness builds a bare
postgres client; the API builds a Drizzle-wrapped one — two bugs have now been found that are
invisible to the suite for exactly this reason … Making `openTestDatabase` use `createDatabase`
would close a class rather than an instance."*

This is the first of the follow-up series that finalises what the sixteen workstreams recorded and
left open. It is labelled `FUP` rather than `W16` on purpose: it is not a workstream with a brief,
and giving it a workstream number would imply one.

## What was done

- **`apps/api/src/test-support/database.ts`** builds its application client through
  `createDatabase`, the constructor `main.ts` uses, instead of `postgres(url, …)`. The
  schema-owner connection stays bare and says why.
- **`apps/sync/src/test-support/database.ts`** is new, and all three sync suites
  (`adoption/store`, `backfill/store`, `create/store`) now share it. Each of the three had built
  its own bare client; three copies of a defect is three chances to fix the wrong thing.
- **`apps/api/src/test-support/client-construction.test.ts`** is the guard: a source walk over
  every `.ts`/`.tsx` under the three applications, failing on any bare `postgres(` construction.
  One escape hatch, spelled out as a `bare-client-ok` marker rather than implied — the two
  schema-owner connections, which run DDL and `truncate` and never a tagged-template write. It was
  **watched fail**: a bare client planted in `routes/integration.test.ts` reds it by file and line.
- Three defects the change exposed, all fixed here.

## Decisions taken

**The harness uses the application's constructor, not an approximation of it.** The alternative —
adding the missing serializers to a bare test client — would have reproduced production's
*behaviour* while leaving the *construction* different, which is how this class survived two
previous fixes.

**The migration connection stays a bare client.** It runs DDL and `truncate`; the serializers in
question govern tagged-template writes, and wrapping it would be cargo-culting the fix rather than
applying it.

**`jsonb` is read as `::text` and parsed in exactly one place.** `json()` in the API store was
documented as "the driver hands `jsonb` over as **text**". That was true of the bare client and
false of the wrapped one, and it is the whole of the finding — see below.

**The guard is a source walk, not a runtime assertion.** What goes wrong is the *construction*; a
client that has already been built cannot be asked whether it was built the right way. It is the
same shape as `packages/ui`'s two source guards, for the same reason.

## Surprises

**The class had three more instances than the two that were known, and two of them were
production defects nobody had hit yet.**

1. **`GET /events` answered `500` on the real client.** `event_log.before`/`after` hold a jsonb
   **string** when a field changes from `'next'` to `'done'`, and the driver's jsonb parser turns
   that into a JS string. The reader could not tell a parsed string from raw JSON text, so
   `JSON.parse('done')` threw. On the bare test client the *write* had been double-encoding, which
   is what made the read work — the test was passing because both ends were wrong in opposite
   directions. Fixed by selecting the columns as `::text`, which is unambiguous at the source.

2. **`prisme-sync backfill` failed outright on the client it runs with.** Drizzle replaces the
   shared client's serializers for `date[]` and `timestamptz[]` (OIDs 1182/1185) with the identity
   function, so passing a JS array reaches the socket writer as an array and the driver raises a
   `TypeError` naming neither the column nor the statement. `recordSlice`,
   `replaceCapacityWeeks` and `recordAdherence` all did this. `text[]`, `integer[]` and `uuid[]`
   are untouched, which is why only the date-shaped arrays broke. Fixed by carrying them as
   `text[]` and casting in SQL — the same idiom the stores already use for dates.

   Worth noting where this leaves W13's "proved against a live database": the proof was of
   *attribution*, which is a read, and the off-by-one was found by a second run through the
   in-memory store. The write path had never run against the wrapped client at all.

3. `apps/sync`'s creation-store suite seeded `jsonb` with the driver's `client.json(…)`, which
   works on a bare client and fails on the wrapped one — now `JSON.stringify(…)::jsonb`, as every
   other `jsonb` write in the repository does.

**A test that passes on both a right and a wrong client is not a test of either.** The events test
was green for months. It is the clearest illustration in this repository of why "the suite is
green" and "the suite is meaningful" are different claims, and it is why the guard walks source
rather than asserting behaviour.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| Nothing outstanding from this change | The three defects are fixed and the guard holds the construction | — |
| A `TASKTOOL_BASE_URL` / `DOCTOOL_BASE_URL` pair in `@prisme/config` | Still open from W15: driving the outward path locally needs the constant patched by hand | a later follow-up |
| The committed fixture harness | Now the seventh session that needed and did not have one | a later follow-up |

## Checks

Read back from the pull request after the final push — the body carries each check by name, result
and commit. Locally before pushing:

| Check | Result |
|---|---|
| `npx vitest run` (both test database URLs set) | 1 928 passed, 111 files — including 173 integration assertions against a real PostgreSQL 17 |
| `tsc -b` and `tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `eslint apps/api/src apps/sync/src` | clean |
| `prettier --check .` | clean |
| `pnpm build` | all packages and three apps |
| `./scripts/privacy-scan.sh` | clean, 43 patterns |

The new guard was **watched fail** before it was trusted: a bare client planted in an integration
suite reds it by file and line, and removing it greens the file again.

## Privacy

Fixture and invented data only. Every identifier in every touched test is made up (`home`,
`ext-1`, `Rebuild the garden shed`), and the three defects were reproduced with synthetic rows
written by the suites themselves. No real goal, project, task, weight or workspace identifier
appears in this entry or in the diff. The deny-list and secret scans are green.

## Specs touched

None. `apps/api/CLAUDE.md`'s testing note — *"integration tests run against a real PostgreSQL
instance seeded from `fixtures/`"* — was accurate and is now more nearly true; nothing in it needed
correcting.
