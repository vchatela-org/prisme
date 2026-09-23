---
name: dependabot
description: Integrate every open Dependabot pull request until it is green - one subagent per PR, serially - merging main into the branch, regenerating the lockfile, fixing what breaks, reading every check back, and stopping at green for a human to merge. Use when asked to clear, integrate, triage or work through Dependabot bumps, dependency updates or dependency pull requests, or on a schedule.
user-invocable: true
---

# /dependabot — integrate the dependency wave, one pull request at a time

Dependabot opens the pull requests; nothing in this repository integrates them. The two that were
integrated by hand took an ADR, a runtime image and two document corrections between them — a
one-line bump is not a one-line change (`docs/50-journal/P0-2026-09-15-node-26-baseline.md`). This
skill runs that work as a loop and follows the same rule as everything else here: **it stops when
every check on the pull request reports green, read back after the last push, and a human merges.**

A run is safe to repeat and safe to schedule because it has no destructive ending. It never merges,
never pushes to `main`, and never touches `STATUS.md` or the journal from inside a dependency branch.

## Arguments

| Argument | Effect |
|---|---|
| `#46 #50 …` | Restrict the run to these pull requests |
| `--dry-run` | Enumerate, order, classify, report — spawn nothing |
| `--force` | Re-attempt pull requests parked by an earlier run |

With no arguments: every open Dependabot pull request that is not parked.

## The loop

### 1. Preflight

```sh
gh auth status
git fetch --prune origin
gh pr list --app dependabot --state open \
  --json number,title,headRefName,mergeable,mergeStateStatus,commits,url
```

Read each pull request's comments. A comment carrying

```
<!-- dependabot-triage: parked sha=<sha> reason=<slug> -->
```

means an earlier run stopped there for a reason already written on the pull request. Skip it unless
`--force`.

`mergeable` reading `UNKNOWN` is GitHub computing it, not a conflict — re-read in a moment rather
than reporting it as one.

**Skip what has not moved.** A pull request is already done when its head is green *and* its base is
current: `git merge-base origin/main origin/<headRefName>` equal to the tip of `origin/main`, with
`statusCheckRollup` green on the head commit. Nothing to integrate means nothing to do — say so in
the report and move on. This is what makes a scheduled re-run cheap rather than a weekly
re-derivation.

### 2. Order, and say so before starting

npm grouped minor/patch → npm single majors → Docker image bumps.

Every npm branch collides with every other on `pnpm-lock.yaml`, so they belong in one contiguous
block for the human's merge sequence. The Docker pull requests touch one Dockerfile each and conflict
with nothing. Report the order first, so that a run which stops halfway is legible.

**Some of them are one change split in two.** Dependabot opens a pull request per directory, so a
base-image tag usually arrives as a pair — `apps/api` and `apps/web` — and the pair is what should
merge, not either half. Group them in the report and say so plainly; one merged alone leaves the two
images on different tags of the same major, which is the inconsistency
[ADR-0023](../../../docs/20-decisions/0023-node-26-toolchain-baseline.md) exists to prevent and which
nothing in CI compares.

### 3. One at a time, never in parallel

Spawn **one** `dependabot-pr` subagent per pull request and wait for it before spawning the next.
Two reasons, both real: the npm branches share one `pnpm-lock.yaml`, and this machine has 5 GB of
RAM, where a full test run concurrent with lint has produced eleven convincing false failures.

**Pass no `model` argument.** The subagent inherits the model this session is running. An explicit
override is how a run dies on a model the account cannot reach.

The prompt carries the pull request number, its branch, and the **absolute path** of
`.claude/skills/dependabot/pr-agent.md` in the main checkout (`git rev-parse --show-toplevel`). The
worktree the subagent works in may predate this skill's own merge, so it cannot be relied on to
contain the file. Tell it to read that contract first, and to act on it.

### 4. Between pull requests, re-read the base

Before each spawn, ask whether an earlier pull request of this run has been merged since
(`gh pr view <n> --json state,mergedAt`). If a human merged one, merge the new `origin/main` into the
remaining branches. A stale base is how a wave rots: yesterday's green says nothing against today's
`main`.

### 5. Report

One table, at the end:

| PR | Bump | Result | Read at | What it took |
|---|---|---|---|---|

`Result` is `green` or `parked`. `Read at` is the commit the checks were read at, for a green one.
A parked row carries its reason, and the reasons are repeated in full below the table — every one of
them is a decision waiting on a human.

### 6. Record the run

On a fresh branch off up-to-date `main`, named `docs/dependabot-wave-<date>`:

- `docs/50-journal/P0-<date>-dependabot-wave.md` — what was decided and why, never what the data
  said — and its row in `docs/50-journal/INDEX.md`.
- Any `ignore:` entry for `.github/dependabot.yml` the run concludes is warranted, **proposed** in
  the journal's *Follow-ups*. The file itself changes only if the user agrees.

Then the pull request, filled in from `.github/pull_request_template.md`, with
`./scripts/privacy-scan.sh --history` run before pushing. Merge the current `main` in and place the
incoming row **first** in its date block: both registry files are appended to by every branch, and
only the first merge of a batch is conflict-free. Do not merge this one either.

## The endings

| Ending | What happens |
|---|---|
| **Every check green**, read back after the final push | Comment the pull request naming what it took and the commit read at. Stop. **A human merges** |
| **Parked** — an Accepted ADR blocks it, the fix needs a product decision, or making it green would mean weakening a check | One comment on the pull request carrying the blocker, the exact error, the two candidate resolutions and what each costs; the park marker; a line in the report |
| **A check red for a reason outside the branch** | The protocol's row: say so in the body and the report, raise it, and do not loop silently against a runner outage |

Green and parked are the only endings, and neither is a merge: an agent never merges its own pull
request, and nothing in this run touches `main`. A parked pull request is never hidden — it is a
comment, a marker a later run reads, and a line in the report.

## What this deliberately does not do

- **Never merges.** Green is the finish line; the human merges. That is the reason a scheduled run is
  safe to leave unattended.
- **Never runs two pull requests at once.** See above.
- **Never edits `.github/dependabot.yml`, `STATUS.md` or the journal `INDEX.md` from a dependency
  branch.** Config and registry changes ride the run's own document pull request, or they do not
  happen.
- **Never weakens a check.** No deleted assertion, no relaxed lint rule, no `eslint-disable`, no
  skipped test, no narrowed `paths:` filter. A gate relaxed to pass is a failure that looks like a
  success, and the next person reads it as one.

## Scheduling

Dependabot runs weekly, so a weekly run is enough. Schedule it off the hour — at `:00` the whole
world's cron fires. A session job is `CronCreate` with `recurring: true` and a cron such as
`17 6 * * 2`; an idle-time loop is `/loop`. The skill is idempotent: a pull request already green
against a current `main` is skipped, so a missed or repeated firing costs nothing but a listing.

The one thing a schedule cannot do is resolve a park. Those need a human's decision, and they
accumulate in the report until they get one.

## Read next

- [The per-PR contract](pr-agent.md) — what the subagent actually does, and the traps it exists to
  catch
- [`docs/40-workstreams/README.md#where-you-stop`](../../../docs/40-workstreams/README.md#where-you-stop)
  — the protocol this follows, unchanged
- [`docs/50-journal/P0-2026-09-15-node-26-baseline.md`](../../../docs/50-journal/P0-2026-09-15-node-26-baseline.md)
  — the run that shows how large a bump can really be
