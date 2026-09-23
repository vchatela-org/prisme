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

A run is safe to repeat and safe to schedule because it never merges and never pushes to `main`, and
because its one outward action — cutting the version tag that publishes both images — is announced in
the report, recorded in the journal, and taken only when the work that version names is already on
`main`.

## Arguments

| Argument | Effect |
|---|---|
| `#46 #50 …` | Restrict the run to these pull requests |
| `--dry-run` | Enumerate, order, classify, report — spawn nothing |
| `--force` | Re-attempt pull requests parked by an earlier run |
| `--no-release` | Skip the release decision at the end (it is still recorded) |

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

### 5. Decide the release

**This is what the run is for.** Integrating the bumps changes nothing in the cluster until a version
is cut: `publish.yml` fires on a `v*` tag, pushes both images to Harbor, and the deployment side
picks that version up from there. So every run ends by asking whether `main` holds dependency work
that no tag contains yet — including a run that found nothing to integrate, because that is exactly
the run that follows a merge.

```sh
git fetch --tags --prune
last=$(git tag --list 'v*' --sort=-version:refname | head -1)
# Dependabot's branch prefix, not the word: this skill's own pull requests are named
# `chore/dependabot-skill`, and `grep -i dependabot` matches those too — so the check reports the
# skill's own documentation as dependency work waiting to be released.
git log "$last..origin/main" --merges --pretty=%s | grep 'dependabot/'   # what a tag would contain
```

No output from that last one is a legitimate answer — it means nothing is waiting to be released, not
a failure to investigate. The prefix is what makes the answer mean something: on the first real run
the word-matched version returned two hits and both were the skill's own pull requests.

**Confirm the tag you are about to cut is not already there** — `git tag -l "v<version>"` must be
empty. A version that exists is never reused and never re-pointed.

- **The version.** Patch by default — `$last` with its patch field incremented. **Minor** when what
  `main` gained since `$last` includes new behaviour rather than a dependency move: a new ADR in
  `docs/20-decisions/`, or a `feat:` commit. Say which field and why in the journal entry; a version
  nobody can explain is a version nobody can trust.
- **Tag only when the tag would be true.** The precondition is that the work is already **on
  `main`** — every green pull request of this run merged, and those merges visible in
  `$last..origin/main`. A run whose pull requests are green but unmerged records the version as
  **pending**, with what unblocks it (one merge), and stops there. It never cuts a version that does
  not contain what it names.
- **Pending is an obligation, not a paragraph.** That rule has one cost, and it is the run's to pay:
  at the moment a run ends, the merges are a human's and the tag is this skill's, and **nothing
  re-runs to notice the precondition has been met**. A pending version therefore sits unborn until
  somebody asks where it is — which is exactly what happened to the first real run, whose `v0.0.6`
  waited on a merge nobody had made yet and then on a run nobody had scheduled
  ([the entry](../../../docs/50-journal/P0-2026-09-23-dependabot-wave.md)). So a
  pending version is recorded where a human will look — a line under *Releases* in
  [`STATUS.md`](../../../STATUS.md#releases), naming the one merge that unblocks it — and handed to
  something that will act: a scheduled re-run, or, in a watched run, the report's release line.
  Never left as a journal sentence alone.
- **Say what you are about to publish, then publish it.** An annotated tag on `main`'s current
  commit, its message naming the pull requests it contains, pushed with `git push origin v<version>`.
  Never from a branch. Never a version that already exists.
- `--no-release` and `--dry-run` skip the cut. The decision is still recorded.

The repository's own precedent is that cutting a tag is a *release decision* rather than a mechanical
step, and that it belongs to a human (`docs/50-journal/FUP-2026-09-21-publish-verified.md`). The
owner has delegated that decision to this skill. What the delegation does not license is a silent
release: the version, the field it moved and the reason are written down, and the tag message says
what it contains.

### 6. Report

One table, at the end:

| PR | Bump | Result | Read at | What it took |
|---|---|---|---|---|

`Result` is `green` or `parked`. `Read at` is the commit the checks were read at, for a green one.
A parked row carries its reason, and the reasons are repeated in full below the table — every one of
them is a decision waiting on a human.

Then the release line: the version, which field moved and why, whether it was cut or is pending, and
the commit it was cut on. A run that integrated nothing new and released nothing is a good run — say
so plainly rather than dressing it up.

### 7. Record the run

On a fresh branch off up-to-date `main`, named `docs/dependabot-wave-<date>`:

- `docs/50-journal/P0-<date>-dependabot-wave.md` — what was decided and why, never what the data
  said — and its row in `docs/50-journal/INDEX.md`.
- **The release decision**: the version, which field moved, why that field, the commit it was cut on,
  or — when it is pending — the single merge that unblocks it. When it is pending, also record it
  under *Releases* in [`STATUS.md`](../../../STATUS.md#releases) and remove the line in a later run
  that cuts it, so the open obligation lives where a human looks rather than in an append-only
  journal alone.
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
request, and nothing in this run moves `main`. A parked pull request is never hidden — it is a
comment, a marker a later run reads, and a line in the report.

## What this deliberately does not do

- **Never merges.** Green is the finish line; the human merges.
- **Never runs two pull requests at once.** See above.
- **Never edits `.github/dependabot.yml`, `STATUS.md` or the journal `INDEX.md` from a dependency
  branch.** Config and registry changes ride the run's own document pull request, or they do not
  happen.
- **Never weakens a check.** No deleted assertion, no relaxed lint rule, no `eslint-disable`, no
  skipped test, no narrowed `paths:` filter. A gate relaxed to pass is a failure that looks like a
  success, and the next person reads it as one.
- **Never tags from a branch, and never reuses a version.** The tag points at `main`, at work that is
  already on it. A version that does not contain what it names is worse than no release: it is a
  release nobody can trust and a rollback nobody can reason about.
- **Never puts a version bump inside a dependency pull request.** Eight of them would collide on the
  same line for a number that only the run can decide once.

## Scheduling

Dependabot runs weekly, so a weekly run is enough. Schedule it off the hour — at `:00` the whole
world's cron fires. A session job is `CronCreate` with `recurring: true` and a cron such as
`17 6 * * 2`; an idle-time loop is `/loop`. The skill is idempotent: a pull request already green
against a current `main` is skipped, so a missed or repeated firing costs nothing but a listing.

A scheduled run that finds the wave merged cuts the release itself, so what a human still owns is the
merge and the parks: review the green pull requests, merge them, and the next firing publishes. Two
things a schedule cannot do — resolve a park, and vouch for a version — and both are reported until a
human acts on them.

## Read next

- [The per-PR contract](pr-agent.md) — what the subagent actually does, and the traps it exists to
  catch
- [`docs/40-workstreams/README.md#where-you-stop`](../../../docs/40-workstreams/README.md#where-you-stop)
  — the protocol this follows, unchanged
- [`docs/50-journal/P0-2026-09-15-node-26-baseline.md`](../../../docs/50-journal/P0-2026-09-15-node-26-baseline.md)
  — the run that shows how large a bump can really be
