---
name: release
description: Cut the next prisme version from main — decide patch or minor from what main gained since the last tag, push the annotated tag, read both published images back from the registry, publish a GitHub Release whose notes say what the version contains and what deploying it asks, hand the version to the deployment, and record it. Use when asked to release, cut, tag, publish or ship a version, "get it deployed" after a merge, or to write the missing notes of an existing version.
user-invocable: true
---

# /release — cut a version, say what is in it, hand it to the deployment

A tag is the release: `publish.yml` fires on `v*`, builds both images and pushes them to the
registry, and the deployment pins what it published. The tag alone says nothing about what it
contains, though, and a version nobody can explain is a version nobody can roll back to on purpose.
So every cut here ends with a **GitHub Release** whose notes are written for the person running
prisme: what changed for them, and what deploying it asks of the deployment.

## Arguments

| Argument | Effect |
|---|---|
| *(none)* | The next version from `origin/main`, end to end |
| `--dry-run` | Facts, the version decision and the draft notes. Tags, publishes and opens nothing |
| `--patch` · `--minor` | Override the computed field. The override and whoever asked for it go in the notes |
| `--notes vX.Y.Z …` · `--notes all` | Write or rewrite the Release of an **existing** tag (§8). Never moves a tag |
| `--no-deploy` | Stop after the Release and the record. The pin is left to the operator |

## 1. Facts

```sh
gh auth status
git fetch --tags --prune origin
.claude/skills/release/facts.sh           # origin/main against the newest version tag
```

It prints the range, the pull requests merged in it, the commit types, the ADRs and migrations
added, the configuration variables added or removed, the field the rule below computes, whether
that version is free, and the checks on the commit the tag would point at. Read it before
anything else. It is read-only.

Work from `origin/main`'s commit, by sha. The shared working tree may be on another session's
branch. A tag is created against a commit and never needs a checkout.

**Stop, and say so, when:**

- `field` is `none`. Only documentation, the journal, skills or CI moved, and an image built from
  it would behave as the last one does. Nothing to release is a legitimate answer.
- `checks` shows anything but `completed/success` (a `skipped` is fine). A tag on a red `main`
  publishes red. `queued` and `in_progress` are not green: wait and re-read.
- `free` says the version exists. A version is never reused and never re-pointed.

## 2. The version

| Field | When |
|---|---|
| **minor** | a new ADR under `docs/20-decisions/`, a `feat` commit, a new migration, or a breaking change |
| **patch** | anything else that reaches an image: `fix`, `perf`, `refactor`, dependency moves, the build |
| **major** | never computed. `1.0.0` is the owner's decision, asked for by name. While the major is `0`, a breaking change is a minor, and the notes lead with it |

A migration is a minor even behind a `fix`, because rolling back across a schema change is not
a drop-in. A patch should be one.

This is the same rule `/dependabot` §5 applies. Say which field moved and why in the tag message
and in the notes. `--patch`/`--minor` overrides it; the override is written down, not hidden.

## 3. The notes

Draft them **before** tagging, in a file outside the repository (`mktemp`). They become the tag's
reason and the Release's body. The sources are each pull request's body (`gh pr view <n>`: *What
changed*, *Features*, *Not done*, *Follow-ups*), the ADRs added, the migrations added, and the
configuration diff. **Every pull request in the range appears exactly once.** The previous
version's own record pull request and the dashboard-row pull requests go in the housekeeping line
rather than a section of their own.

```markdown
<Two to four sentences: what this version changes for the person using prisme. Lead with a
breaking change if there is one.>

## What's new
- **<the change, in the user's words>** — <what they can now do or see>. #<n>

## Fixes
- **<what was wrong>** — <what happens now>. #<n>

## Under the hood
- <refactors, dependency moves (one line per wave, with the pull requests), CI and build>

## Deploying it
- **Migrations:** none | `00NN_<name>.sql`, what it adds, and whether it needs a grant
- **Configuration:** none | `VARIABLE`, added or removed, its default, what an unset one does
- **Decisions:** none | [ADR-00NN](https://github.com/<owner>/<repo>/blob/vX.Y.Z/docs/20-decisions/00NN-….md), in one line
- **Watch after the roll:** <a behaviour change to see happen rather than read about>, or none

## Images
| Image | Digest |
|---|---|
| `prisme-api` (also runs `prisme-sync`) | `sha256:…` |
| `prisme-web` | `sha256:…` |

Housekeeping: #<n>, #<n> (release records, dashboard rows).

**Full changelog:** https://github.com/<owner>/<repo>/compare/v<prev>...vX.Y.Z
```

Drop a section that would say nothing, except *Deploying it*: every line of it stays and says
`none` when there is nothing. An operator reads it to learn what the roll asks of them, and a
missing line looks like a question nobody asked.

**The notes are public.** They follow [`docs/17-privacy.md`](../../../docs/17-privacy.md) like any
file in the repository. No instance data: no real area, goal, task, weight or workspace
identifier. No infrastructure detail: not the registry host, a hostname, a secret path, or the
name of the deployment's repository. "The deployment" is enough. Scan the file before it is
published:

```sh
grep -vhE '^\s*(#|$)' .github/privacy-denylist.txt .github/privacy-denylist.local.txt 2>/dev/null \
  > "$patterns"
grep -nEi -f "$patterns" "$notes" && echo "REFUSED — rewrite the notes" || echo clean
```

It must print `clean`. Without the gitignored local supplement it scans the public patterns only,
so say that in the report if it is missing.

## 4. Tag

```sh
git tag -a vX.Y.Z <sha> -F "$tag_message"     # annotated, on origin/main's commit
git push origin vX.Y.Z                         # once
```

The tag message's first line is `prisme vX.Y.Z: <headline>`. Under it: the field and why, then one
line per pull request. Never tag from a branch. Never re-push a tag that already exists anywhere.

## 5. Read the publish back

```sh
run=$(gh run list --workflow publish.yml --branch vX.Y.Z --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run" --exit-status
```

Both matrix jobs, `prisme-api` and `prisme-web`, must end green. **When one half is red and its
sibling green**, the cause is almost always the cluster runner and not the commit (buildx losing
its workers). Re-run the failed job with `gh run rerun "$run" --failed`, and never with an empty
commit or a new tag. A job that sits at `in_progress` long after its steps finished is a wedged
runner: read the job itself back before calling it anything.

Then read the digests **from the registry**, not from the run summary:

```sh
reg=$(gh variable get HARBOR_REGISTRY); proj=$(gh variable get HARBOR_PROJECT)
for img in prisme-api prisme-web; do
  curl -fsS "https://$reg/api/v2.0/projects/$proj/repositories/$img/artifacts/vX.Y.Z?with_tag=true" | jq -r .digest
done
```

The values stay in the session. The registry host goes nowhere that is committed or published.

## 6. Publish the Release

Only after both images exist, so a Release never advertises an image that is not there:

```sh
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z — <headline>" --notes-file "$notes" --latest
gh release view vX.Y.Z --json url,isDraft --jq '"\(.url) draft=\(.isDraft)"'
gh api repos/{owner}/{repo}/releases/latest --jq .tag_name    # must be vX.Y.Z
```

`--verify-tag` refuses to create a tag, so a typo cannot publish a Release on a new, untagged
commit. Read the page back once.

## 7. Hand it to the deployment

The deployment lives in a separate, private repository, so how the pin moves is not written here.
It is written in `.claude/skills/release/deploy.local.md`, which is gitignored under `*.local.*`.
Being gitignored, it exists only in the main checkout and never in a fresh worktree. Look for it
there:

```sh
deploy="$(git rev-parse --path-format=absolute --git-common-dir)/../.claude/skills/release/deploy.local.md"
```

If it exists, follow it. It ends at a **green pull request that a human merges**, like everything
else. If it is absent, or with `--no-deploy`, stop here. Say in the report that the version is
published and not pinned.

## 8. Record it

On a fresh branch off `origin/main` in its own worktree (`fup/<date>-vXYZ-record`):

- **One row at the top of *Releases* in [`STATUS.md`](../../../STATUS.md#releases)**: the version
  linked to its Release, the date and the commit it was cut on, what it contains in one sentence
  with the pull requests linked, and its state (published, a short digest per image, pinned or
  not). Update the previous row's state when its pin has since moved. Remove a *pending* line
  this cut discharges.
- **A journal entry only when the cut decided something the rules above did not**: an override, a
  re-run that needed diagnosing, a pending version, a deviation. The Release is the record of what
  a version contains. A routine cut adds nothing to the journal but a registry collision.

Then `./scripts/privacy-scan.sh` after `git add`, a pull request filled in from the template, and
its checks read back green after the last push. Both registry files take a row from every branch,
so merge `origin/main` in and put the incoming row first if another pull request landed meanwhile.
**Do not merge it.**

## Notes for an existing tag

`--notes vX.Y.Z` writes the Release a tag should have had. Run `facts.sh vX.Y.Z`: for an existing
tag it ranges from the version before it. Across a history rewrite, where the older tag is no
ancestor, it selects the pull requests by merge time and says so. Then write §3's notes. Take the
digests from the registry if the tag is still there. The *Releases* row in `STATUS.md`, if the
version has one, is the curated account of what it contained. Use it, and never contradict it.

```sh
gh release create vX.Y.Z --verify-tag --title … --notes-file … --latest=false   # or: gh release edit vX.Y.Z --notes-file …
```

`--latest=false` on every one but the newest version. A deleted version has no tag and gets no
Release. This path moves no tag, pins nothing and needs no record row.

## Report

One block at the end:

| Version | Field, and why | Cut on | Publish run | Digests | Release | Pin | Record |
|---|---|---|---|---|---|---|---|

Then what is left for a human, which is usually two merges: the pin, then the record. A run that
found nothing to release says so plainly.

## What this deliberately does not do

- **Never merges**, neither here nor in the deployment. A human merges.
- **Never tags a branch, a red commit, or a version that exists.** A tag points at `main`, at work
  already on it, and is pushed once.
- **Never computes a major.**
- **Never publishes notes that fail the deny-list**, and never names the deployment's repository,
  hosts or secrets in them.
- **Never re-runs a publish by pushing.** A red half is re-run in place.
