# FUP · 2026-09-23 · The gate that type-checks test files, and the forty-three errors it found

**Agent:** Claude · **Duration:** one session · **PR** [#59](https://github.com/vchatela-org/prisme/pull/59) · **Outcome:** complete

Closes W06's follow-up #2: *"**No CI gate typechecks test files.** `pnpm typecheck` builds
`tsconfig.build.json`, which excludes `*.test.ts`, and ESLint does not report compile errors. Two
pre-existing type errors in `auth.integration.test.ts` and `routes/contract.test.ts` are invisible
today … Fixing the gate is a CI change and belongs in its own pull request."* This is that pull
request, including the fixing.

**It was not two errors. It was forty-three**, across five packages — and several of them are not
typos but **test fakes that had drifted from the interfaces they stand in for**.

## What was done

- **`pnpm typecheck` now type-checks test files.** The script gains a second pass,
  `pnpm -r exec tsc --noEmit -p tsconfig.json`, which uses each package's *lint/editor* config
  (tests included) rather than its build config. It runs after `tsc -b`, because a package's tests
  resolve its siblings through their emitted declarations.
- **All 43 errors fixed**, per package:

  | Package | Errors | What they were |
  |---|---|---|
  | `packages/domain` | 30 | A test helper annotated `readonly { readonly areaKey: string }[]`, which *widened* every row so every field access failed; plus `noUncheckedIndexedAccess` meeting `exactOptionalPropertyTypes` |
  | `apps/sync` | 7 | Fakes behind the interfaces: `DocToolClient` missing `createPage` (ADR-0025), `Transport` still the pre-seam `{ send }` object, `OrderInput`/`ConvergeOptions` missing the page fields |
  | `apps/api` | 3 | Hono types `app.request` as `Response \| Promise<Response>`; and an explicit `body: undefined` |
  | `packages/connectors` | 2 | Raw `'2026-10-01'` where a branded `CalendarDate` is required |
  | `packages/config` | 1 | Reading `.default` off the union of variable-row shapes |

- **`tsconfig.json`'s comment corrected** — it described the first pass as the whole of `pnpm typecheck`.

## Decisions taken

**The gate is folded into the existing `typecheck` script, not added as a new check.** A new check
name would have to be added to branch protection, which is a human's setting to change — and W14
already recorded what happens when a check is *believed* to be required but is not. Folding it in
means the check that is already required now covers strictly more, with no settings change at all.

**The build pass is left exactly as it is.** `tsconfig.build.json` excludes tests because tests are
not package surface; that reasoning is unchanged. The second pass exists because *lint and CI* want
to see them, which is a different question from what the package exports.

**Four drifted fakes were repaired rather than silenced.** Every one of the seven `apps/sync` errors
is scaffolding that no longer matches the contract it implements — `createPage` added by ADR-0025,
the transport seam becoming a function, two page fields added to the order and converge inputs. The
tempting shortcut (`as DocToolClient`, an `any`) would have left the drift in place and hidden it
better. Each is fixed by making the fake match the interface it claims.

**The `domain` helper is made generic rather than asserted.** A parameter typed with the one field
the helper reads is the whole error: it widens the return to that shape. `byKey<T extends { readonly
areaKey: string }>` is the fix, and the comment says so, because the same annotation is an easy
thing to write again.

## Surprises

**The count was off by a factor of twenty, and the reason is the point.** W06 recorded two errors,
having presumably found them by hand. The gate's first run found 43 — and it found them because it
looked everywhere rather than where someone had happened to look. Two of the seven `apps/sync` ones
are *load-bearing*: a fake `DocToolClient` with no `createPage` means that suite has not exercised
the interface it claims to since ADR-0025 landed, and nothing could have said so.

**`pnpm -r exec` stops at the first failing package.** The first run reported `packages/domain` and
exited, which reads like "domain has problems" rather than "the workspace has not been checked
further". Worth knowing before reading a partial list as the whole one — the per-package counts in
the table above were taken package by package for exactly that reason.

**The second pass is cheap.** Thirteen seconds locally for all ten packages, on a machine where the
whole repository lint is OOM-killed. It was worth measuring before arguing about it.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The lint step's type-awareness | `pnpm lint` needs the packages built for the same reason this second pass does; the CI job already builds first, and a local `pnpm lint` on a clean tree does not | if it bites |
| Nothing type-checks the *fixtures* under `fixtures/` | They are JSON, so nothing to check — noted only so the next person does not read this gate as covering them | — |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `typecheck` | local + CI | **clean**, and **watched fail**: restoring the narrow `byKey` produced `error TS2339` on six lines and exit 1 |
| `test` | local (`PRISME_TEST_*` set) | 2 113 passed, 121 files |
| `build` | local | clean, all packages and three apps |
| `lint` (eslint, changed packages) · `prettier` | local | clean |
| `privacy deny-list` | local | clean, 45 patterns |
| `internal links` | local | clean |
| rest (`gitleaks`, `dependency review`, `golden fixtures`, `dependency audit`, `images`, `CodeQL ×3`) | CI | see the rollup on the pull request |

**Read at commit:** head of this branch after the last push.

## Privacy

Fixture and invented data only. The repairs change *types*, not values; no fixture, id, title or
hostname was added or altered. The deny-list scan is clean.

## Specs touched

None. No specification described the typecheck gate, so none was wrong — the only stale statement
was a code comment in `tsconfig.json`, corrected where it was written.
