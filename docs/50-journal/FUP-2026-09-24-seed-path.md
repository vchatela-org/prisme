# FUP · 2026-09-24 · The seed path, which two specs said existed

**Agent:** Claude · **Duration:** one session · **PR** [#74](https://github.com/vchatela-org/prisme/pull/74) · **Outcome:** complete

**Stacked on [#73](https://github.com/vchatela-org/prisme/pull/73)**, which is merged first: the
register row this change closes 🟢 is added by that one, so the row and its closure cannot arrive in
the same diff without the row existing twice. The branch therefore carries #73's three documentation
commits, and this pull request's diff is the seed path alone once #73 lands. The alternative — one
pull request for both — was rejected for a reason the release entry already recorded: the two files
that collect a row per pull request are the ones that conflict, and mixing a lockfile move into a
documentation-only change makes both harder to read than the stacking does.

[`docs/17-privacy.md`](../17-privacy.md) says areas, weights, tool mappings and external IDs load
from `seed/`. [`docs/13-migration.md`](../13-migration.md) step 1 depends on it. Neither was true:
`parseBindingsFile` read the `documentTool` key and returned, so the `areaMappings` array **in the
same file** was parsed by nobody; `seed/areas.json` had no loader at all; and `pnpm seed:load` —
which [`seed.example/README.md`](../../seed.example/README.md) tells the reader to run — existed in
no `package.json` in the repository. `POST /areas` and `PUT /areas/:key/mappings` have no UI caller
and no CLI, so a live instance's areas and mappings could only be set by hand-written calls.

They load from `seed/` now, in one command, and every rule the format states is enforced by name.

## What was done

- **`prisme-sync areas --from <path> [--force]`** — a new command, and
  [`areas.ts`](../../apps/sync/src/areas.ts) behind it: areas and their year weights, parsed
  strictly, upserted, never deleted.
- **`prisme-sync bindings --from <path>` also writes the area mappings** from the same file. The
  array was in the documented format and reached nothing; `saveMappings` is called from the branch
  that was already reading the file.
- **`pnpm seed:load` is real**, running the two in order — areas first, because a mapping names an
  area. The script builds the CLI it runs, so it works from a clean checkout.
- **Area/weight/mapping parsers** built on the domain's own schemas (`areaSchema`,
  `areaWeightSchema`, `assertWeightsSumTo100`), so the shapes written are the shapes the model
  defines rather than a second copy of them.
- **`seed-cli.ts`**: argument parsing for both commands, in its own module for the reason
  `backfill/cli.ts` gives — importing `main.ts` from a test would execute the command line.
- **21 unit tests and 8 integration tests**, on the parsing refusals and on the three properties the
  writing half exists for.
- **Four documents corrected**: `docs/15-runtime.md` §2 gains *The area catalogue* and says the
  mappings load; `seed.example/README.md` says what `seed:load` runs and what re-running does;
  `docs/13-migration.md` step 1 names the command it was always describing.

## Decisions taken

**Prose keys are ignored; data keys are strict.** Every seed file carries `_comment` and `_rules`
beside its data and a hand-written one grows them, so a `_`-prefixed key is skipped. Any *other*
unrecognised key is refused **by name**, at both levels — a typo like `areaWeight` for `areaWeights`
would otherwise load nothing and report success, which is the failure this whole path exists to
close. The same rule inside an entry catches a mistyped field.

**Absence is not a value, so nothing is deleted and no field is overwritten by omission.** A role
binding is replace-wholesale, because removing a role from the file must unbind it. An **area is
not**: work hangs from it, so an area the file omits is left exactly as it was. Inside an area, a
field the file does not carry is left alone — `"active"` absent is not `"active": true`, or
re-running the loader would silently reactivate an area somebody archived in the application. That
distinction is why `AreaSeed` exists beside the domain's `Area`: `Area` requires `active`, so it
cannot express "not stated", and collapsing the two is how the bug would be written.

**A year the file agrees with is left alone; a year it disagrees with is refused.** This pair is the
whole of the `--force` design and it is not a compromise between two rules. Without the first,
`pnpm seed:load` errors on every re-run and stops being usable; without the second, it silently
replaces a decision the yearly review made (ADR-0007: a weight is fixed for a whole calendar year).
So a matching year is a quiet success — reported as *already agreed* — and a differing one stops the
run with the flag named. Both were driven against a real database, not only tested.

**Mappings are replaced per area the file mentions, and only those.** An area's locations come from
the file entire, which is `replaceMappings`' rule. A location the file claims that **another area
already holds — an area the file does not mention — is refused**, naming the area that holds it. The
unique index would refuse it too, with a constraint violation naming a table the operator has never
heard of.

**Two refusals name an external identifier, and the sibling loader does not.** `bindings.ts` prints
keys and never identifiers, because a log is a thing people paste into an issue. The mapping
refusals name the conflicting location, deliberately: *a location conflicts with an area the file
does not mention* cannot be acted on without saying which, and an unactionable refusal is not a
refusal. It goes to the operator's own terminal, about their own file. The reasoning is in the
module, and the counts and area keys that reach the *log* still carry no identifier.

**A run-budget edit is derived rather than refused.** The file cannot express "clear this field", so
a file that changes a Run lane's kind would leave a stored weekly budget on something that must not
have one — and the check constraint would refuse an edit the file asked for, naming a constraint.
The update clears it whenever the kind is not `run`, which is not a guess: a budget belongs to the
Run lane and to nothing else, so the value is determined.

**No event is appended.** `PUT /areas/:key/weights/:year` records a `weight_changed` event, because
that is a decision made in the application and the year-review chart is drawn from the log. A seed
load is the initial configuration of an instance with no history. `bindings.ts` makes the same call.

**`zod` is now a direct dependency of `apps/sync`.** The seed file is an untrusted hand-written
input and the repository's rule is one schema per boundary; the alternative was forty lines of
hand-rolled type guards, which is exactly the kind of code that is wrong in small ways. It is a
workspace-consistent addition, not a new package.

## Surprises

**`fixtures/areas.json` is not a seed file, and the strict parser refuses it.** It looks like one —
it carries `areas` and `areaWeights`, and `apps/api`'s seeder reads exactly those two keys — but it
also carries `areaContext2026W37` and `_displayNote`, which belong to the scoring tests. Under the
`_`-prefix rule the first is a data key the parser does not know, so it is refused. That is the
correct outcome and the distinction is worth keeping in view: the fixture set is a *test dataset*,
[`seed.example/`](../../seed.example) is the **format**, and only the second is what a loader may
accept. The unit test says so where a reader will meet it.

**The format example is the parser's positive case, so the two cannot drift.** The bindings test
uses `seed.example/bindings.json` as a *negative* case — every identifier in it is `REPLACE-ME`,
which the loader refuses on purpose — so the loader's positive case had to be a fixture of its own
invention. `seed.example/areas.json` has no placeholder, weights that sum to 100, and a weight for
every area, so it **loads**: the unit suite parses the file the documentation tells a person to copy,
and a change to either that the other does not follow is a red test.

**An area's share of capacity is checked against the file's own area list, not against the
database.** A year that names only some of the areas sums to 100 by construction — the omitted area
is absent from the map rather than zero in it — so no sum check can see it, and the area would
quietly carry a zero share on every chart. Refusing it needs the file's list of `kind: 'area'`
entries, which is why the check lives in the parser and not in the domain invariant that looks like
it covers it.

**A backtick inside a SQL comment inside a template literal ends the template.** The column comment
explaining why the run budget is derived named the constraint in backticks, which terminated the
tagged template and produced an esbuild error pointing at a word rather than at a line. Obvious in
hindsight; recorded because the message names the token, not the mistake.

## Verified by running

Against a **throwaway database** (`prisme_seed_check`), migrated, then dropped — never the shared
test database, and never an instance.

| What was driven | Result |
|---|---|
| `pnpm seed:load` on an empty, migrated database | 5 areas created, 3 weights for 2026, 3 mappings across 2 areas; `run` carries its weekly budget |
| The same command a second time | **0 created, 0 weights written**, `2026 already agreed with the file and were left alone` — idempotent, and it says so |
| The file's 2026 weights changed to 45/35/20, no flag | refused: *2026 already has weights that differ from the file … Re-run with --force*, and **exit 1** |
| The same, with `--force` | 3 weights written, the year replaced |
| `select` on `area`, `area_weight`, `area_mapping` after each run | the rows above, matching the file exactly |

Local checks: `areas.test.ts` 21 passed, `seed-cli.test.ts` and `bindings.test.ts` green,
`apps/sync` **390 unit tests** and **61 integration tests** passing, `typecheck` clean,
`eslint apps/sync` clean, `prettier --check` clean on every changed file.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The API round trip was **not** driven end to end | The read path over these tables is covered by the API's own integration suite, but nothing yet proves that *these rows* render as areas with names through `GET /areas` on a live stack. The check is the harness, and the colour work needs it anyway | the next change in this batch |
| `fixtures/` still carries no `area_mapping` rows | Unchanged by this work and still a row in the register: attribution and the balance factor are only partly exercised by a plain seed | this batch, later |
| The seed path has no test in `apps/sync` that runs the built CLI | The commands are covered through their functions; the wiring between `main.ts` and them is covered by the drive above, by hand | a later follow-up |
| `areas.ts` writes tables the API also writes | The precedent is `saveBindings` writing `role_binding` directly, and the loader is configuration-only. Two implementations of `replaceMappings` now exist | a later refactor, if a third appears |

## Not done

- **No ADR.** Nothing here decides anything the model did not already decide: the seed path is
  described in two specs, the year-scoped weight rule is ADR-0007, and the lane rule is ADR-0014.
  This implements them.
- **No deployment change.** The deployment repository's bootstrap runbook still has no step for
  areas, weights or mappings — a row in the register, and a change to that tree rather than this one.
- **The `--force` flag is not offered by `bindings`.** A role binding is replaced wholesale, so
  there is nothing for it to protect, and accepting it would let a mistyped flags line load anyway.
- **The colour-pin generator and the bounded `capacity_week` refresh.** The next pull request in
  this batch.
- **No `seed/` was left behind.** The throwaway it was driven with is removed; the reproduction is
  the command sequence above, and `seed.example/README.md` is how a real one is built.

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `typecheck` | local + CI | local clean |
| `lint` | local (per tree — the whole-repo run is OOM-killed on this machine) + CI | local clean, `eslint apps/sync`, `prettier --check` on every changed file. CI runs it whole |
| `test` | local + CI | local: `apps/sync` 390 unit and 61 integration passed, with the two test-database URLs set |
| `build` | local + CI | `pnpm --filter @prisme/sync... run build` clean |
| `privacy deny-list` | local + CI | local clean — the seed files a run was driven with were gitignored and are removed |
| every other required check | CI | see the rollup on the pull request |

**One dependency was added** — `zod` to `apps/sync` — so `pnpm-lock.yaml` moves with it, and
`dependency review` is the check that reads it.

## Privacy

No instance data of any kind. Every value the run was driven with was invented and written for this
check — `check-project-0001`-shaped identifiers, `seed.example`'s `alpha`/`beta`/`gamma` — and the
`seed/` directory holding it was gitignored (`git check-ignore` reports `.gitignore:11`) and has
been deleted. The throwaway database was dropped. Nothing in this entry, the diff, the tests or the
commit messages names a real area, weight, project, task, identifier, hostname or workspace: the
areas the tests use are the format example's invented ones, and the external identifiers are
`ext-project-…` strings written in the test file. Deny-list and secret scans are green.

## Specs touched

- [`docs/17-privacy.md`](../17-privacy.md) — **not edited, and that is the point**: its §2.1 claim
  that areas, weights and mappings load from `seed/` is now true. It was cited as unimplemented in
  the entry one row up the register.
- [`docs/15-runtime.md`](../15-runtime.md) §2 — the bindings block gains the `areaMappings` half and
  *The area catalogue* subsection: the two commands, the three refusals, and why re-running is safe.
- [`docs/13-migration.md`](../13-migration.md) §5 step 1 — names `prisme-sync areas` and
  `prisme-sync bindings`, which is what "configure area mappings; seed weights" always meant.
- [`seed.example/README.md`](../../seed.example/README.md) — what `pnpm seed:load` runs, in what
  order, why that order, and what a second run does.
- [`apps/sync/CLAUDE.md`](../../apps/sync/CLAUDE.md) — the **Shape** block names `areas.ts` and
  `seed-cli.ts`, so the next reader finds the seed path without grepping for it. No ADR is
  contradicted; no new one is raised.
- [`STATUS.md`](../../STATUS.md) — the seed-path row closes, and P1's checklist item 2 names the
  command it now has.
