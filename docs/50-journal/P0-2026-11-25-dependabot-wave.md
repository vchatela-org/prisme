# P0 · 2026-11-25 · `main` red on a base-image CVE, so `v0.25.1` stays pending

**Agent:** Claude (orchestrator, scheduled and unattended) · **Duration:** one run · **PR:** this
entry's own · **Outcome:** nothing integrated, nothing parked, nothing cut. One Dependabot pull
request is open (#242). It is current but red on `images`, and the cause is outside the branch.
`main` is red on the same check, so `v0.25.1` cannot be cut. The pending row under *Releases* in
[`STATUS.md`](../../STATUS.md#releases) now names what really unblocks it.

## What was done

**Order:** only #242 was open (the npm production minor/patch group). There was no Docker pull
request, so there was no pair to group. #241 (dev-dependencies) was merged by a human after the
2026-11-24 run, as `7017463`.

**#242: no subagent.** Its merge-base with `main` is `main`'s tip `7017463`, so the base is current.
Every check is green at the head `632c7ea` except `images`. That check fails on Trivy:

```
libzstd1  CVE-2026-124851  HIGH  installed 1.5.7+dfsg-1  fixed 1.5.7+dfsg-1+deb13u1
```

The package is in the distroless `nodejs26-debian13` runtime layer that both images use. None of the
five bumps touches a Dockerfile. An earlier pass on 2026-11-25 already wrote this on the pull request
with both ways to unblock it, so this run added no second comment. The run checked that the blocker
had not moved: `gcr.io/distroless/nodejs26-debian13:nonroot` still resolves to
`sha256:ffa8a754…87b7`, the digest both Dockerfiles already pin. Starting a subagent would have used
the machine to reach the same red.

## Decisions taken

- **The red check is not a park.** The fix does not need an ADR or a product decision. It will come
  from upstream: a distroless rebuild against Debian's `deb13u1` update. A park marker would make
  later runs skip #242 even after that rebuild lands. So the pull request stays unparked, and the
  next run picks it up when the digest moves.
- **The check is not weakened.** A `.trivyignore` entry would turn the check green. But it accepts a
  finding, and that is the maintainer's decision, with a reason, a verification and an expiry, as the
  file's header requires. This run does not take it.
- **Release: `v0.25.1` is still pending, for a new reason.** `git log v0.25.0..origin/main --merges`
  now lists the merge of #241 (`dependabot/` branch), so `main` does hold dependency work that no tag
  contains. But `main`'s own `images` run at `7017463` is red on the same CVE
  ([run](https://github.com/vchatela-org/prisme/actions/runs/45584451265)). `/release` refuses a
  tag on a red `main`. Also, `publish.yml` pushes the images first and scans them afterwards, so a
  tag today would publish two images with a known HIGH finding and then fail its own scan. The
  version is still **`v0.25.1`, a patch**: dependency moves only, no new ADR and no `feat:` commit.
  The tag `v0.25.1` does not exist.
- **What unblocks it is one merge: the one that turns `main`'s `images` check green.** That is
  either the distroless digest bump once upstream rebuilds (Dependabot opens it for `apps/api` and
  `apps/web` as a pair, and both halves must merge), or a maintainer's `.trivyignore` entry. The
  2026-11-24 row said "#242". That stopped being true when `main` turned red. #242 still belongs in
  `v0.25.1`, but merging it does not make the tag possible.
- **This record is stacked on #243.** #243 is still open and adds the same `STATUS.md` row. Two
  branches that each add the row would conflict, and the row #243 adds is now wrong. This branch
  contains #243's commit and corrects the row in place. Merging this pull request merges #243 too.

## Surprises

- #242 was green at `c88c203` on 2026-11-24. It turned red after `main` was merged in, but `main`
  was not the cause. The advisory was published at 00:17Z on 2026-11-24, and the earlier green read
  a cached Trivy database. So a green `images` check is only as current as its Trivy database. Rules
  and tooling do not cover that today.

## Follow-ups

- **Human:** choose how `main`'s `images` check turns green. Either wait for the distroless rebuild
  and merge its digest pair, or accept CVE-2026-124851 in `.trivyignore`, with a reason and an
  expiry. Merge #242 when its `images` check reads green. Merge this pull request (it contains #243).
- **Next scheduled run:** when the distroless digest moves or `main`'s `images` check turns green,
  refresh #242 and read its checks back. Once `main` is green with #242 on it, cut `v0.25.1` by
  following `/release` §3–§6, then remove the pending row from `STATUS.md`.
- No `ignore:` entry proposed for `.github/dependabot.yml`.

## Specs touched

none.
