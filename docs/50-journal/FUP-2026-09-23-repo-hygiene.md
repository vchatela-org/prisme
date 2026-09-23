# FUP · 2026-09-23 · Two settings that did nothing, and a file that should never have been tracked

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes two small debts the workstream entries recorded but nobody had picked up. Both are the same
shape as the ones [W00's close-out](W00-2026-09-15-close-out.md) found: **configuration that looks
like it does something, and a tracked file that `.gitignore` already refuses.** Neither is visible to
any check, because neither is something the code *does*.

## What was done

- **`apps/web/next.config.mjs` — the `eslint` key is gone.** Next 16 removed the option and the
  `next lint` command it controlled; the key is now rejected with a warning on every build
  (`warnOptionHasBeenDeprecated` in `next/dist/server/config.js`). The key set `ignoreDuringBuilds`,
  which existed to stop `next build` re-linting with rules that disagree with `pnpm lint` — and
  `next build` no longer lints at all, so it was a setting that had stopped having an effect while
  still looking like it had one.
- **`.cache_ggshield` is untracked.** A `ggshield` cache file, tracked before the ignore rule that
  covers it (`.gitignore` line 67) was added. `git rm --cached` only — the file stays on disk, where
  the scanner wants it.
- **`apps/web/CLAUDE.md` is untouched** — nothing here changes a convention it states.

## Decisions taken

**The middleware convention is *not* changed here, and that is deliberate.** Next 16 also warns
`The "middleware" file convention is deprecated. Please use "proxy" instead.` — the same build, the
same file. It is left alone on purpose: renaming `apps/web/src/middleware.ts` to `proxy.ts` moves the
file that carries **every security header and the CSRF origin check**, and W14 already recorded this
exact failure mode once — *"middleware silently not loaded so every security header was absent"*,
with the build green either way. A rename with no check that the thing still runs is that failure
waiting to happen again. It gets its own change, with a check that a response still carries the
policy.

**`git rm --cached` rather than deleting the file.** The scanner reads it; what was wrong is that it
was committed, not that it exists. Deleting it would break the developer's next `ggshield` run to
fix a repository problem.

## Surprises

**The `eslint` key had already stopped working, and removing it changes nothing.** It reads like a
behavioural change and it is not one: `next build` no longer runs ESLint in Next 16 (there is no
`next-lint` binary and no invocation in `next/dist/build/index.js`), so `ignoreDuringBuilds: true`
had nothing to suppress. That is worth stating rather than glossing as "removed a deprecated option"
— the honest description is *removed a setting that had silently stopped being read*, which is the
same category as the three the W00 close-out found.

**The cache file holds hashes, not secrets.** Checked before untracking: two SHA-256 digests and the
paths of the test files they came from. No token, no URI, no live credential — so this is hygiene,
not a leak, and the entry says so rather than letting "a scanner cache file was in git" read as an
alarm.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| `middleware.ts` → `proxy.ts` | The file convention is deprecated; the rename moves the file carrying every security header, so it needs a check that the policy is still sent | this wave, next |
| Nothing asserts the web tier sends its security headers | `/healthz` is excluded from the matcher, and the `images` probe only checks `/healthz` — so no check would notice the middleware not loading | this wave, with the rename |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `build` (web) | local | clean — `next build` green, **the `eslint` deprecation warning is gone** and the only warning left is the `middleware` convention one, above |
| `privacy deny-list` | local | clean, 44 patterns including the local supplement |
| `typecheck` / `lint` / `test` / `build` / rest | CI | see the rollup on the pull request |

The build was read for warnings before and after, not assumed: `next build` captured to a log on
this branch names the `middleware` warning and **not** the `eslint` one, which is the evidence that
the change did what it claims. `pnpm lint` whole-repo is OOM-killed on this machine (W08's finding,
still true); `eslint` and `prettier --check` were run over the changed file.

## Privacy

Fixture and invented data only. No file in this change carries instance data; the untracked cache
file holds two SHA-256 digests and two repository-relative test paths, neither of which names a real
goal, project, task, weight or workspace.

## Specs touched

None. No spec mentioned the `eslint` key or the cache file, so none was wrong — this is the W00
close-out's category of debt, which lives in configuration and is covered by no document.
