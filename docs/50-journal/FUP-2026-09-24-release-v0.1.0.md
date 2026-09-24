# FUP · 2026-09-24 · The v0.1.0 release, and where the Open-page commit actually landed

**Agent:** Claude · **Duration:** one session · **PR:** this pull request · **Outcome:** complete

Asked to close the follow-up wave: rebase the Open-page branch once #69 landed, open its pull
request, and cut the version [the release rule](../../.claude/skills/dependabot/SKILL.md) asks for,
since `main` had gained two ADRs.

**One of those three was already done, and how it was done is the finding.**

## What was done

**The Open-page pull request is not needed, because its commit is already on `main`.** The
`fup/2026-09-24-dev-harness` branch was **stacked on top of** `fup/2026-09-24-open-page`, so the
harness pull request (#70) carried the Open-page commit (`32ffc2e`) into `main` with it. This was
verified rather than assumed: the twelve files of the Open-page change are **byte-identical**
between `main` and the branch, and `git diff origin/main HEAD` on the branch shows **only the
removal of #70's own work** — the branch is a rebase of a change that is already merged, and merging
it would revert the harness. No pull request was opened, and nothing was pushed to that branch.

**`v0.1.0` is cut**, annotated, on `main`'s tip (`ddbf481`), and pushed.

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

**Two branches are now redundant, and neither was deleted.** The local and remote
`fup/2026-09-24-open-page` refs both point at a rebase of a merged change. Deleting them is the
owner's call: a branch removed by an agent that does not own it turns a tidy-up into a lost pointer,
and the same reasoning that left the superseded scratch harness alone applies here.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The two `fup/2026-09-24-open-page` refs (local and remote) | Redundant — merging one would revert #70; they only mislead the next reader | the owner |
| Driving the *Open page* link in a browser | Its wiring is asserted by the build and by nothing else; the committed `harness/` (#70) is now there to do it | whoever runs the next browser drive |
| A tag is cut before its record lands | Deliberate here, and the reason the record must name the tag's commit as this one does; a run that forgets leaves a version nothing explains | the next release |

## Follow-ups, not done here

- **No new ADR.** This release decides a *version*, not a capability, and the two ADRs it names were
  already accepted. Nothing in `docs/11-ownership.md`'s field ownership moves.
- **No branch was deleted**, per the note above.

## Checks

_(read back after the pull request's checks report)_

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
