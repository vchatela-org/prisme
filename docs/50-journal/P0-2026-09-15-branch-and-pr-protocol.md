# P0 · 2026-09-15 · Branch and pull-request protocol for every agent

**Agent/author** Claude Code · **Duration** one session · **PR** #3 · **Outcome:** complete

## What was done

Every workstream now reaches `main` as a **pull request on its own branch**, and an agent **stops only
when every check on that PR is green**. Before this, agents committed straight to `main` — the five
commits preceding this one all did — and nothing described the work in a form a reviewer could act
on without reading the diff.

Written into four layers, so the rule exists where each reader already is:

| Layer | File | What it carries |
|---|---|---|
| Override | [`CLAUDE.md`](../../CLAUDE.md) §5 | The rule itself, in the file every agent reads first |
| Contract | [`docs/40-workstreams/README.md`](../40-workstreams/README.md) | The full protocol: branch naming, PR contents, what "all checks pass" means, where you stop |
| Prompt | [`.claude/agents/README.md`](../../.claude/agents/README.md) + 16 workstream defs | The instruction each spawned agent actually receives |
| Mechanism | [`.github/pull_request_template.md`](../../.github/pull_request_template.md) | The PR body, pre-structured so "all details" is the default rather than an aspiration |

Supporting: the roadmap's scheduling section now says branch-per-workstream instead of merge-per-
workstream, and `STATUS.md` gained a **PR** column so a workstream's pull request is visible from the
dashboard.

## Decisions taken

- **The agent stops at green and a human merges.** An agent never merges its own PR. "Propose a PR"
  was read literally: proposing is the agent's job, deciding is not.
- **Green is the only ending besides an ADR conflict.** A failing test, a broken anchor, a deny-list
  hit, a type error: each is the agent's to fix, and it re-pushes until green. The one legal stop is
  work that would contradict an Accepted ADR, which already had a rule (raise a superseding ADR,
  stop for review).
- **Never weaken a check to get green.** Stated explicitly, because "only stops when checks pass"
  creates exactly the incentive to delete an assertion or add a lint-disable. A relaxed gate is worse
  than a red one: it is a failure that looks like a pass.
- **"All checks" means the checks that exist on that PR**, not a fixed list. Wave 1 runs against a
  deliberately thin set; W00 and W14 thicken it and each new job becomes required from the commit
  that adds it. Writing a fixed list would have deadlocked W00 against the test job it is itself
  writing.
- **Branch protection, not just documentation.** `main` now requires a pull request and the four
  existing checks, and `enforce admins` is on. This is the load-bearing part: agents push with the
  owner's token, so without `enforce_admins` every agent *is* an admin and bypasses the protection
  meant to constrain it.
- **No required approving review.** A solo-owner repository cannot approve its own PR, so requiring
  one approval would have blocked every PR including the owner's. A PR is required; an approval is
  not. Worth revisiting if a second committer ever appears.

## Verified

PR #3 green on every check: `privacy deny-list`, `gitleaks`, `internal links`, `dependency review`,
`Analyze (actions)`, `Analyze (python)`, the CodeQL summary, and GitGuardian. Locally before pushing:
`./scripts/privacy-scan.sh` (worktree and staged) and `./scripts/check-doc-links.py`, clean.

Branch protection was confirmed by reading the config back, **not** by attempting a bypass — a
deliberate push to `main` was blocked by the agent's own tooling before it reached the network, so the
rejection path itself is untested. The config is authoritative (`enforce_admins: true`,
`required_pull_request_reviews` present with 0 approvals, four required contexts); the behaviour is
inferred from it. Worth a human confirming once with `git push origin HEAD:main`, since the whole
value of this change is that push failing.

## Surprises

- **Branch protection already existed and was already ineffective.** Required checks were already set
  to `privacy deny-list` and `gitleaks`, but with no PR requirement and `enforce_admins: false`, a
  direct push to `main` was permitted — which is how the preceding commits got there. The gap was
  never the checks; it was the bypass.
- **There is no root manifest yet.** No `package.json`, so no typecheck, lint, test or build job
  exists to require. Four checks are all there are. This is the single largest assumption in the rule
  and it resolves itself when W00 lands.
- **`dependency review` reports only on pull requests**, so it could not have been a required check
  under the old direct-to-`main` flow. Moving to PRs is what makes it enforceable at all.

## Follow-ups

- **A CI check that the PR body follows the template** would make "all details" enforced rather than
  conventional. Deliberately not added: a new required check on the first PRs it governs is a good
  way to block them. Revisit once the wave-1 PRs have shown what the body actually looks like.
- **Two gaps in `enforce_admins`** worth knowing: the owner can no longer push directly to `main`,
  and no longer force-push it. The publication sweep of 2026-09-15 rewrote history with a force-push;
  that operation now requires temporarily lifting the rule.
- **W00 owns the required-check list from here.** Each job it adds to CI should be added to the
  protected-branch required set in the same PR, or the next workstream inherits a check nobody is
  held to.
