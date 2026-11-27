# P0 · 2026-11-24 · Two npm groups green, and `v0.25.1` pending on the merge of #242

**Agent:** Claude (orchestrator, scheduled and unattended) · **Duration:** one run · **PR:** this
entry's own · **Outcome:** two Dependabot pull requests green and waiting for a human merge (#242,
#241). None parked. Nothing cut: `main` holds no dependency work that `v0.25.0` lacks. `v0.25.1` is
recorded as pending under *Releases* in [`STATUS.md`](../../STATUS.md#releases).

## What was done

**Order:** first #242, the npm production minor/patch group (`jose`, `@hono/node-server`, `hono`,
`lucide-react`, `tailwind-merge`), then #241, the npm dev-dependencies group (`vitest`,
`@vitest/coverage-v8`, `typescript-eslint`). No Docker pull request was open, so there was no pair to
group.

**#242: skip rule, no subagent.** Its head `c88c203` reported all 17 checks green, and its merge-base
with `main` was `main`'s tip `19b96a8`, so nothing was left to integrate. The run filled in its body
from the template, keeping Dependabot's text verbatim, ran the deny-list scan at the head (clean),
read the checks back after the body edit, and commented it green.

**#241: one `dependabot-pr` subagent.** The branch was also current, but `test` and `images` were red
at `b4dbb9e`. Both failures came from outside the branch:

- `images`: the hosted runner lost communication with the server during the build.
- `test`: one MCP integration test failed with a Postgres deadlock (`40P01`). The other 2904 tests
  passed.

One re-run of each failed job turned it green, and the tree was not changed. A full local run passed
too, one check at a time. That run used a Node older than `.nvmrc`, and the PR body says so. The
subagent made no commit and no push. It filled in the body, and the run commented the PR green at
`b4dbb9e`.

## Decisions taken

- **Integrating did not mean changing #242.** Re-running a full integration on a branch already
  current and green would have spent the machine to reach the same commit. The skill's skip rule
  covers exactly that case. The parts the rule does not cover, the body and the green comment, were
  done directly.
- **A re-run is not a weakened check.** The two red jobs failed on a runner outage and on a lock-wait
  deadlock. Neither failure is about the versions bumped. Re-running the job keeps the read attached
  to the same commit, and nothing in the gate changed.
- **Release: nothing to cut, one version pending.** `git log v0.25.0..origin/main --merges` lists
  only the docs merge #240. No `dependabot/` branch appears, so a tag cut today would name nothing.
  The next version is **`v0.25.1`, a patch**: two dependency groups, no new ADR and no `feat:`
  commit. **The merge that unblocks it is #242.** It is the only one of the two that changes what
  runs in the published images. #241 is dev-only, so it rides the same tag if it merges first, but
  the release does not wait for it.

## Surprises

- The journal had no entry after 2026-10-29. The November runs updated the *Releases* table only.
  This entry follows the skill rather than that recent habit.

## Follow-ups

- **Human:** merge #242 and #241. Whichever merges second needs `main` merged in and its lockfile
  regenerated, because both rewrite `pnpm-lock.yaml`. The next `/dependabot` run does that if the
  branch has not moved.
- **Next scheduled run:** once #242 is on `main`, cut `v0.25.1` by following `/release` §3–§6, then
  remove the pending row from `STATUS.md`.
- **Watch:** the MCP integration test that deadlocked once (`apps/api/src/mcp/mcp.integration.test.ts`,
  in the reconciler pair). It happened once in this run. If it happens again it is a real flake and
  needs an owner. No ignore entry is warranted for it.
- No `ignore:` entry proposed for `.github/dependabot.yml`.

## Specs touched

none.
