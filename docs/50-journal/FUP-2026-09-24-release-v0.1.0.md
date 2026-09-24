# FUP · 2026-09-24 · The v0.1.0 release, and where the Open-page commit actually landed

**Agent:** Claude · **Duration:** one session · **PR:**
[#72](https://github.com/vchatela-org/prisme/pull/72) · **Outcome:** complete

Asked to close the follow-up wave: rebase the Open-page branch once #69 landed, open its pull
request, and cut the version [the release rule](../../.claude/skills/dependabot/SKILL.md) asks for,
since `main` had gained two ADRs.

**One of those three was already done, and how it was done is the finding.**

## What was done

**The Open-page pull request is not needed, because its commit is already on `main`.** The
`fup/2026-09-24-dev-harness` branch was **stacked on top of** `fup/2026-09-24-open-page`, so the
harness pull request (#70) carried the Open-page commit (`32ffc2e`) into `main` with it. Verified
rather than assumed: the **remote** `fup/2026-09-24-open-page` ref is an **ancestor of `main`**, so a
pull request opened from it would carry no commits at all, and the twelve files of the change are
byte-identical between `main` and the local branch. No pull request was opened, and nothing was
pushed to that branch.

**`v0.1.0` is cut**, annotated, on `main`'s tip (`ddbf481`), and pushed.

**`main` then moved past it.** [#71](https://github.com/vchatela-org/prisme/pull/71) — the
schedule-guidance correction — merged afterwards, so `main` is now `bf54a97` and `v0.1.0` does not
contain it. That is what a tag is rather than a gap:
the version names the commit it was cut on, and what it does not contain is the next version's
business. This branch merges `main` forward, so the record is reviewed against a current base and
the release does not go out of date the moment it is written.

## Decisions taken

**`v0.1.0` — the minor field.** What `main` gained since `v0.0.6` contains two new **Accepted** ADRs
in `docs/20-decisions/` — 0027 (the dependency audit fails closed) and 0028 (a capture's page gets
its own role pair) — which is the minor signal the release rule names. There is no `feat:` commit.
Patch was the default and would have been the wrong answer: the version has to say what changed, and
what changed is behaviour the ADRs decided.

**Cut now rather than after the record.** The precondition is that the work is already on `main`,
and it is: #65–#70 are merged and visible in `v0.0.6..origin/main`. The tag goes on `main`'s
**current** commit, so the record of it lands behind it — in this entry and in `STATUS.md` — which is
the order the `v0.0.6` release also took. The alternative, recording first and tagging after, would
need a human merge in between and would hand the version back to the handoff that left `v0.0.6`
unborn for a day.

**The tag message names the Open-page commit.** It never had a pull request of its own, but it is in
the version, so the tag says so rather than letting a reader infer that #70 was harness work alone.

## Surprises

**A stacked branch decides how its base gets reviewed, and nobody chooses that.** The register row
for *Open page* already names **#70**, which is correct — but correct by consequence rather than by
decision. A pull request whose title, body and diff were about one thing carried a second commit
that had been written to stand on its own, and the separate review it was written for never happened,
because no pull request was ever opened for it. The work is sound and its checks are green; the
mechanism is what is worth carrying, because the next stack behaves identically.

**The publish run went red on the first attempt, and the red was the cluster, not the build.**
`publish (prisme-api)` failed while `publish (prisme-web)` **succeeded** — from the same commit, so
no Dockerfile or source difference can explain it. The log names it exactly: `buildx` could not list
its workers, `502 Bad Gateway` from the node proxy to the buildkit pod. The failed job was re-run; no
empty commit was pushed. Recorded because of the shape it leaves behind: a **half-published pair**,
which is the inconsistency the release rule's pairing rule exists to prevent, arriving from a
transient cluster fault rather than from anything a reviewer could have seen in the diff.

**A measurement that read as proof was measuring the wrong thing, and the first version of this entry
said so confidently.** The claim was that merging the stale branch would revert the harness, and the
evidence was `git diff origin/main <branch>` printing 1 288 deletions. That command diffs two
**trees**: when the branch's base is behind `main`, its output mixes the branch's own change with the
**inverse of everything `main` has gained since**, so it looks like a mass deletion whatever the
branch contains. It is not a merge preview. The preview is `git merge-tree --write-tree`, and it says
something different — the local ref conflicts on `STATUS.md` and `INDEX.md`, the two registry files,
and touches **none of #70's files**, so a merge would leave the harness intact. The ref is redundant
because it **contributes nothing**, not because it is destructive. Corrected here and in the pull
request body rather than quietly dropped: a check whose output reads as proof and is not is the exact
failure this repository's other gates exist to catch.

**Two refs are redundant, and neither was deleted.** The remote `fup/2026-09-24-open-page` is already
contained in `main`, so a pull request from it would be empty; the local one is a rebase of the same
change, adds nothing, and collides with `main` on the registry files. Deleting them is the owner's
call: a branch removed by an agent that does not own it turns a tidy-up into a lost pointer, and the
same reasoning that left the superseded scratch harness alone applies here.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The two `fup/2026-09-24-open-page` refs (local and remote) | Redundant — the remote one is already in `main`, the local one adds nothing; they only mislead the next reader | the owner |
| Driving the *Open page* link in a browser | Its wiring is asserted by the build and by nothing else; the committed `harness/` (#70) is now there to do it | whoever runs the next browser drive |
| A tag is cut before its record lands | Deliberate here, and the reason the record must name the tag's commit as this one does; a run that forgets leaves a version nothing explains | the next release |

## Follow-ups, not done here

- **No new ADR.** This release decides a *version*, not a capability, and the two ADRs it names were
  already accepted. Nothing in `docs/11-ownership.md`'s field ownership moves.
- **No branch was deleted**, per the note above.

## Checks

Read back from the pull request rather than from the local runs, after the last push. Every check
that reports is green; a later doc-only push resets the read, which is why this table names no
commit.

| Check | Where it ran | Result |
|---|---|---|
| `internal links` | local + CI | pass — `./scripts/check-doc-links.py` clean, **656 internal links across 148 files** |
| `privacy deny-list` · `gitleaks` · `security gate self-test` | local (pre-commit) + CI | pass — `./scripts/privacy-scan.sh` clean, 23 patterns; the commit hook reported no secrets |
| `typecheck` · `lint` · `test` · `build` | CI | pass — no source file is touched, so these are the unchanged gates, read anyway rather than assumed |
| `golden fixtures` · `dependency audit` · `dependency review` | CI | pass |
| `codeql` (actions, javascript-typescript, python) | CI | pass |
| `images` | CI | pass |

**One local reading was wrong and the mistake is worth naming.** Mid-merge, with the conflict
unresolved, the link check printed *776 links across 150 files* — because it enumerates with
`git ls-files` and an unmerged index lists a conflicted path more than once. The number looked like
coverage and was double-counting. The committed tree reads 656 across 148, reproducibly.

## Privacy

Nothing beyond what the repository already publishes. The entry names pull requests, ADR numbers and
a commit, all of which are public; it names no real objective, task, workspace, weight, hostname or
registry, and no value is quoted from a log, a fixture or an environment. The infrastructure failure
above is described by its shape — a proxy answering `502` to the build's own control plane — which is
what a reader needs and which identifies nothing.

## Specs touched

- [`STATUS.md`](../../STATUS.md) — a `v0.1.0` row under *Releases*.
- [`docs/50-journal/INDEX.md`](INDEX.md) — this entry.
- [`docs/50-journal/FUP-2026-09-24-open-page.md`](FUP-2026-09-24-open-page.md) — its header now names
  the pull request the commit actually landed in, and one follow-up stops describing the harness as
  something that might land.
