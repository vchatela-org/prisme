# The Dependabot pull request contract

You are integrating **one** open Dependabot pull request. The bump is Dependabot's; everything that
makes it true is yours. You finish when every check on that pull request reports green, read back
after your last push — or when you park it with a reason a human has to resolve.

Read first, in order: `CLAUDE.md`, this file, `docs/40-workstreams/README.md#read-the-checks-back`,
and the pull request itself — its body, its comments, and the checks it currently carries.

Two rules from the protocol hold unchanged and are the ones this job most tempts you to break: **you
never merge**, and **you never weaken a check**. A deleted assertion, a relaxed lint rule, an
`eslint-disable`, a skipped test or a narrowed `paths:` filter is a failure that looks like a
success. Park instead, and say why.

## The shape of the work

A Dependabot branch is cut from an old `main`, so the first fact to establish is not whether it is
green — it is almost certainly green at a commit nobody should ship. Integrate first, judge second.

1. **Worktree.**
2. **Merge `origin/main` in.**
3. **Regenerate the lockfile.**
4. **Classify the bump** — routine, or one of the cases below that needs more than the bump.
5. **Run the local checks**, serially.
6. **Fix what is red** — properly.
7. **Commit, push to the Dependabot branch.**
8. **Fill in the pull request body.**
9. **Read every check back** and keep going until green.
10. **Report** to the orchestrator in the format at the end.

## 1. Worktree, outside the repository

```sh
repo=$(git rev-parse --show-toplevel)
n=<pr-number>; branch=<headRefName>; wt=/opt/git/prisme-worktrees/dep-$n
git fetch --prune origin
git worktree remove --force "$wt" 2>/dev/null || true
git branch -D "dep-$n" 2>/dev/null || true
git worktree add -B "dep-$n" "$wt" "origin/$branch"
cd "$wt"
```

Sibling worktrees are this repository's convention, and the location is load-bearing rather than
tidiness. **A worktree nested inside the repository is a trap**: Node resolves `node_modules` by
walking up the directory tree, so a worktree under `.claude/worktrees/` finds the main checkout's
`node_modules` first and every check passes against the *old* dependency set. That is a green that
means nothing, and it is the exact failure this contract exists to prevent. Leave the user's own
checkout alone — another session may be holding it mid-branch.

The local branch is `dep-<n>` deliberately, so that the push target has to be written out and cannot
be `main` by accident.

## 2. Merge `main` in, never rebase

```sh
git merge origin/main --no-edit
```

The branch is Dependabot's, and rebasing it rewrites commits it owns; the precedent is a merge
(`docs/50-journal/P0-2026-09-16-node-26-web-and-engines.md`). Resolve conflicts on their merits:

- **Source and manifests**: resolve properly. A conflict in `package.json` is usually both sides
  bumping a neighbour — keep both intents.
- **`pnpm-lock.yaml`**: do not hand-merge it. Take either side (`git checkout --ours pnpm-lock.yaml`)
  and let step 3 regenerate it from the resolved manifests. Both sides are stale by definition.

## 3. Regenerate the lockfile, then prove it

```sh
pnpm install
pnpm install --frozen-lockfile   # this is what CI runs; it must exit 0
pnpm why <package>               # the new version, resolved inside this worktree
test -d node_modules && realpath node_modules   # inside $wt, not the main checkout
```

Never hand-edit `pnpm-lock.yaml`. `--frozen-lockfile` failing is a lockfile that does not agree with
the manifests, which is a red `typecheck`/`lint`/`test`/`build`/`images` waiting to happen five
checks later.

`engine-strict=true` in `.npmrc` means an `engines` mismatch is a hard install failure here rather
than a warning in CI. If install refuses, the bump is a toolchain move, not a version move — see the
Node case below.

## 4. Classify the bump

Most bumps are routine: a grouped minor/patch, or a single patch. The rest are the cases that took an
ADR the last time they happened, and each has a named home. Check them explicitly — every one of them
can be green in CI and still be wrong.

**Docker images — the pair, and the digest.** `apps/web/Dockerfile` and `apps/api/Dockerfile` each pin
a builder (`node:26.<x>-trixie-slim@sha256:…`) and a runtime
(`gcr.io/distroless/nodejs26-debian13:nonroot@sha256:…`), and each carries the comment that the
runtime major must match the builder's, per
[ADR-0023](../../../docs/20-decisions/0023-node-26-toolchain-baseline.md). Dependabot watches the
builder tag, the distroless tag and each digest **independently**, so it will happily bump one and
leave the pair inconsistent — a combination that builds, boots, passes every check in this repository
and is wrong. From a Docker bump:

- both apps move together, and the runtime major still equals the builder's;
- the digest in the file is the digest of the tag beside it —
  `docker buildx imagetools inspect <image>:<tag>` prints it, and Docker is available locally;
- a **base-image major** is ADR-sized by ADR-0023's own words. Park it; do not merge it as a bump.

Dependabot opens a pull request **per directory**, so the same tag nearly always arrives twice —
`apps/api` and `apps/web` — and the pair is one change, not two. Integrate the one you were given,
then check whether its sibling is still open (`gh pr list --app dependabot --state open`), and if it
is, say so in your report and note in the pull request body that it should merge with that sibling. A
lone merge leaves the two images on different tags of the same major; nothing in CI compares them.

**`patchedDependencies` — five patched packages.** `pnpm-workspace.yaml` carries five
`@radix-ui/react-*` versions patched in `patches/`. A bump touching any of those five invalidates its
patch: `pnpm install` will refuse, or quietly stop applying it and break the thing the patch exists
for. Re-apply the patch to the new version by hand when the diff still applies and update the key;
otherwise park it. Background: `docs/50-journal/FUP-2026-09-21-radix-inline-styles.md`, and
`packages/ui/CLAUDE.md`.

**`overrides` — the two forward pins.** `postcss` and `esbuild` are pinned forward in
`pnpm-workspace.yaml` for advisories their parents have not yet picked up. A Next.js or drizzle-kit
bump may make one removable, and `dependency audit` is the required check that says whether removing
it is wrong. Deleting an entry the parent still needs is how a sharp gate goes blunt.

**`allowBuilds` — lifecycle scripts.** `esbuild` is on the allow-list because its install script links
the platform binary Vitest's transform pipeline needs. A bump that moves esbuild's parent may need
the entry to move with it; the failure is a test run that cannot start.

**Node and the toolchain.** `.nvmrc`, `engines.node`, both Dockerfiles and `@types/node` describe one
baseline ([ADR-0023](../../../docs/20-decisions/0023-node-26-toolchain-baseline.md)). A Node bump
that moves the major is a toolchain move that has to touch all of them in one step, and there is a
precedent for how large that is: `docs/50-journal/P0-2026-09-15-node-26-baseline.md`. Node has
shipped no `corepack` since v25, so the builder installs pnpm from npm at the version
`packageManager` pins — check that derivation still holds.

**GitHub Actions bumps.** Every third-party action is pinned by commit SHA with its version in a
comment, because a tag is mutable (`ci.yml`'s header says so). A bump updates the SHA **and** the
comment together; a SHA whose comment names a different version is a lie a reviewer cannot check.
`privacy.yml`'s gitleaks version is hand-pinned and deliberately outside Dependabot's watch — do not
"align" it.

**Golden fixtures.** `scripts/check-golden-fixtures.py` refuses a change to
`fixtures/scoring/*.golden.json` that does not bump the method's `version` (ADR-0006). A dependency
bump should never touch one. If yours does, stop and read `packages/domain/CLAUDE.md` before deciding.

**Majors.** Integrate them fully rather than parking on sight: adapt the source and bump the companion
packages in the same pull request when that is the mechanical fix — a `typescript` major usually needs
`typescript-eslint` and its plugins moved with it, an `eslint` major its config. Park only when the
fix would contradict an Accepted ADR or needs a product decision. As this was written, the
`typescript 5.9.3 → 6.0.3` pull request was red on `typecheck`, `lint`, `test`, `build` and `images`
at once, which is what a major looks like when the companion has not moved.

## 5. The local checks — serially, and named

Run them one at a time. This machine has 5 GB of RAM, and a full run concurrent with lint has
produced eleven convincing false failures (`deadlock detected`, `Hook timed out`, suites failing to
load). Before believing a failure, check `uptime` and re-run it alone.

```sh
docker compose up -d postgres            # if postgres is not already up
export PRISME_TEST_DATABASE_URL=postgres://prisme_app:prisme@127.0.0.1:5432/prisme_test
export PRISME_TEST_MIGRATION_DATABASE_URL=postgres://prisme_migrate:prisme@127.0.0.1:5432/prisme_test

./scripts/privacy-scan.sh
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level=moderate
pnpm exec eslint apps/web apps/api apps/sync    # one tree at a time
pnpm exec eslint packages
pnpm exec prettier --check .
```

Plus, when the change calls for it: `./scripts/check-doc-links.py` for a document,
`./scripts/check-golden-fixtures.py HEAD^` for a golden file, and `docker build` for a Dockerfile —
`images` is a required check and Docker works here, so a Dockerfile change is not verified until an
image is built.

Two facts about the database, both of which cost a session each to learn:

- `prisme_test` is created by hand, with the two roles from `packages/db/sql/dev-roles.sql` —
  `prisme_app` (DML only) and `prisme_migrate` (owns the schema). Running as one role when the other
  exists hides exactly the class of failure the split is there to catch.
- The migration runner **refuses to run when the database is ahead of the branch** — "migration 0008
  (bindings) is applied in the database but not shipped by this image". So when this branch's
  migrations differ from the last branch you ran, **drop and recreate** the database; truncating is
  not enough.

Whole-tree `pnpm lint` is OOM-killed on this box. That is a recorded local limitation, not permission
to skip lint: run `eslint` tree by tree as above, and `prettier` separately.

## 6. Fix what is red, properly

The fix is whatever makes the repository genuinely correct at the new version — an adapted call site,
a companion package moved in step, a re-applied patch, a regenerated lockfile. It is never a weakened
gate. If the only way to green is to weaken one, that is a park, not a fix.

## 7. Commit and push

Commit with a real message: what the bump is, and what it took. Then:

```sh
git push origin HEAD:<headRefName>
```

Never force-push: the branch is Dependabot's, and a force-push rewrites the commits it owns. If the
push is rejected as non-fast-forward, Dependabot has updated the branch — fetch, merge again, and
re-run the checks rather than forcing.

## 8. Fill in the pull request body

From `.github/pull_request_template.md`, in full, every section. Delete nothing; write `none` where
the answer is none.

- **Workstream** and **Brief**: `none` — this is dependency integration, not a workstream.
- **What changed**: keep Dependabot's own bump summary and its release-notes links **verbatim**, so
  the provenance survives, then say what the integration took beyond the version arithmetic.
- **Where**: the directories touched, so a reviewer can see the branch stayed on manifests, lockfile
  and whatever the bump genuinely required.
- **Spec and decisions**: `none`, or the ADR the bump touches (ADR-0023 for anything Node-shaped).
- **Checks**: every check by name and result, plus the commit they were read at. Never "CI passes".
- **Privacy**: fixture data only, no real value anywhere, and the deny-list scan's result.
- **Not done** and **Follow-ups**: what you deliberately left, and anything a human now owns.

**Do not put a version bump in this pull request.** The release is decided once, at the end of the
run, by the orchestrator — eight pull requests each moving a version would collide on the same line
for a number none of them can decide alone.

## 9. Read the checks back

```sh
gh pr checks <n> --watch
gh pr view <n> --json statusCheckRollup
```

Every check must be green on the head commit. A push resets the read: a green you saw before your
last push says nothing about the branch now, including a push that only moved a document. Queued, in
progress, or absent from the rollup is **not** green.

One reading that is green while looking otherwise: the aggregate `CodeQL` context reports `skipping`
when a pull request cannot trigger analysis — a dependency branch often will not — while its three
real contexts, `CodeQL (actions)`, `CodeQL (javascript-typescript)` and `CodeQL (python)`, pass.
Branch protection requires the three, not the aggregate, so `skipping` there is a green. Do not chase
it, and do not report the rollup as red on its account.

**A wedged check is not a running check.** This repository's CI runs on a self-hosted cluster runner
that sometimes leaves a finished job reporting `in_progress` for ever. A check sitting at `pending`
with a suspiciously short duration, while everything else on the run has finished, is worth reading
back before believing:

```sh
gh api repos/<owner>/<repo>/actions/jobs/<job_id> \
  --jq '{status, conclusion, steps: [.steps[] | "\(.name)\t\(.status)\t\(.conclusion)"]}'
gh run rerun <run_id> --job <job_id>
```

Steps all `success` with the job's `conclusion` already `success` means it is done and wedged. Un-wedge
it without touching the tree, so the green read stays attached to the same commit. **Never push an
empty commit to reset the checks** — that re-runs all of them and throws away a green read on a commit
that was fine. And never treat the wedge as licence to merge: the rule is that green is read back.

## Parking, when green is not reachable

Park when one of these is true, and only these:

- the bump contradicts an Accepted ADR, or would require superseding one;
- the fix is a product decision, not an adaptation — a major whose companion packages do not support
  it, a removal an advisory depends on, a base-image major;
- the only route to green is weakening a check;
- a check is red for a reason outside this branch — a runner outage, not your tree.

One comment on the pull request, then stop:

```
<!-- dependabot-triage: parked sha=<head-sha> reason=<short-slug> -->

Parked by a /dependabot run.

**Blocked on:** <the ADR, or the decision — one sentence>
**Exact error:** <the failing check, and the error verbatim>
**Two ways out:** <option A and what it costs> / <option B and what it costs>
**Not done:** <what you deliberately did not change>
```

The marker is what a later run reads to skip this pull request; the comment is what a human reads to
decide. Both are required, and the park goes in the report either way.

## 10. Report back

Structured, to the orchestrator that spawned you:

```
PR #<n> — <bump, from → to> — <branch>
Worktree: <path>
Result: green | parked
Bump type: routine | docker-pair | patched-dep | override | toolchain | action-sha | major
Files touched: <list, and anything outside the routine set>
If green:
  Read at: <head sha>
  Checks: <each check and result>
  What it took: <2–4 sentences — the part a reviewer of the diff cannot see>
If parked:
  Reason: <slug + which of the four conditions>
  Failing check and error: <verbatim>
  The decision a human now owns: <one sentence>
Not done / left for a follow-up: <or none>
```

Keep it short enough to read in one screen. The orchestrator's report, and the run's journal entry,
are built from these — a fact you leave out is a fact the run cannot record.
