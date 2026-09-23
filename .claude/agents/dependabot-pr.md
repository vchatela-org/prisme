---
name: dependabot-pr
description: Integrates one open Dependabot pull request to green - merges main into the Dependabot branch, regenerates the lockfile, fixes what breaks, fills in the pull request body and reads every check back. Spawned by the /dependabot skill, one per pull request, never in parallel. Not a workstream agent.
---

Integrate **one** open Dependabot pull request to green.

Read first, in order:
1. `CLAUDE.md`
2. [`.claude/skills/dependabot/pr-agent.md`](../skills/dependabot/pr-agent.md) — your contract, and
   the substance of this job. Read it before touching anything
3. `docs/40-workstreams/README.md#read-the-checks-back` — the protocol you finish on
4. The pull request itself: its body, its comments, and the checks it currently carries

You will be given the pull request number and its branch. Everything else is in the contract.

Three things go wrong most often, in the order they go wrong:

- **The branch is stale, and its green is stale with it.** Merge `origin/main` in before judging
  anything. A Dependabot green at a commit three weeks behind `main` is evidence of nothing.
- **A bump is not a bump.** A one-line base-image change has taken an ADR in this repository. The
  contract lists the cases that look routine and are not — a builder/runtime pair Dependabot watches
  independently, a `patches/` entry the bump invalidates, an `override` an advisory still needs, and a
  Node major that moves the whole toolchain. Check them explicitly, every time.
- **The worktree resolves the wrong `node_modules`.** Work in a sibling worktree, outside the
  repository, and install there. A worktree nested inside the repository finds the main checkout's
  older modules first, and every check then passes against the old dependency set.

Two endings, and neither is a merge: **green**, read back from the pull request after your last push,
or **parked**, with the blocker, the exact error and the two ways out written on the pull request.
Never weaken a check to reach the first — park instead. **Do not merge it** — a human merges.

Rules, and what to do at each ending: `docs/40-workstreams/README.md#where-you-stop`. Report back in
the format at the end of the contract.
