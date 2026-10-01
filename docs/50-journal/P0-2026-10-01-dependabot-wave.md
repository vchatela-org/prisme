# P0 · 2026-10-01 · Two advisories turned `main` red, and one pull request carries the way back

**Agent:** Claude (orchestrator, inline) · **Duration:** one watched run · **Outcome:** #135
integrated to green and merged, `v0.15.1` cut; the other five wait on `main` merged in again

The six pull requests the [2026-09-29 run](P0-2026-09-29-dependabot-wave.md) left green went red
without a commit of their own. Overnight, `main` (`cf9950e`) began failing two required checks,
`dependency audit` and `images`, on advisories published after that run. Every branch inherits both.
Their 2026-09-29 greens were read before the advisories existed, and they say nothing now.

## Who runs this wave

An earlier attempt the same day came from a user-level skill that merges Dependabot pull requests
and tags the release itself. It stopped before merging anything, because `main` was red and a merge
would have meant going around branch protection. Its one write was merging `main` into #130. Even
with green checks, its merge and release-commit steps contradict this repository's rule that a human
merges. **The owner decided prisme opts out of it.** That skill now refuses to run in a repository
whose `CLAUDE.md` or own Dependabot skill says agents do not merge. Dependency work here stays with
[`/dependabot`](../../.claude/skills/dependabot/SKILL.md) and [`/release`](../../.claude/skills/release/SKILL.md).

## The two red checks

### `dependency audit`

- **`next`**: a critical advisory (`GHSA-vcvr-r3jv-pc5j`, `next/og` `ImageResponse`), fixed in
  16.3.6. That is #135's own bump. prisme imports neither `next/og` nor `ImageResponse`, so the
  advisory was not reachable, but it is cleared by a fixed version rather than argued away.
- **`brace-expansion`** 5.0.9: three advisories (one moderate, two high), fixed in 5.0.12, and no
  open pull request carried it. Its only parent, `minimatch` 10.2.6, asks for `^5.0.8`, so a lockfile
  refresh is enough. **No `overrides` entry was added**, because nothing has to be pinned forward
  against its parent's range. The lockfile diff is that one package and nothing else.

Either fix alone leaves the audit red on the other, so the two had to travel in one pull request. #135
already carried `next`, so it carries both.

### `images`

Trivy reports two HIGH OpenSSL CVEs (`CVE-2026-75804`, `CVE-2026-84782`) in `libssl3t64`
3.5.7-1~deb13u2, which comes from the distroless runtime base. Debian fixed both in deb13u3, but
distroless has not republished: the newest `nodejs26-debian13:nonroot` digest (`afc6657`, the one
#131/#132 move to) still ships deb13u2. A distroless image has no package manager, so no
Dockerfile change can move the package.

The owner had three options:

| Option | Cost |
|---|---|
| Wait for distroless | Nothing merges until upstream republishes, and `next`'s critical advisory stays on `main` and in the deployed version meanwhile |
| Change the base image | Reopens [ADR-0023](../20-decisions/0023-node-26-toolchain-baseline.md) |
| **Accept the two findings, with an expiry** (chosen) | A waiver on a required gate, the first one here |

**Verified before accepting.** No ELF file in the published `v0.15.0` images links libssl or
libcrypto, apart from OpenSSL's own libraries and engines. The `node` binary's dynamic dependencies
are libc, libstdc++ and their kin, and it carries its own OpenSSL. The argon2 and sharp addons and
libvips do not link it either. So the flagged library is present in both images, and nothing in them
loads it.

**What the waiver is.** `.trivyignore`, at the repository root where Trivy reads it by default, names
exactly those two IDs, each with `exp:2026-10-15`, and carries the reason and the verification. Trivy
0.70.0 (the version the pinned action uses) was run against the base image twice: with the file the
scan was clean, and with the dates set in the past both findings came back and it exited 1. Every
other HIGH or CRITICAL finding still fails the check. `images.yml` is unchanged.

**Why this is not the `overrides` precedent.** This repository has preferred pinning a dependency
forward to waiving it (`pnpm-workspace.yaml` says so). That works only when a fixed version can be
pinned. Here the fix exists only as a Debian package that the base image does not ship. The expiry
keeps the waiver from becoming permanent: on 2026-10-15 it lapses, the check fails again, and someone
has to decide again.

## What was done

| PR | Bump | Result |
|---|---|---|
| #135 | production-minor-patch group, plus `brace-expansion` 5.0.12 and `.trivyignore` | green, read at `afb78a3` |
| #134 | dev-dependencies group | not integrated: red on `main`'s two checks until #135 lands |
| #130 / #133 | builder `node` 26.9 → 26.10 (api / web) | not integrated, same reason. #130 had `main` merged in by the earlier attempt and reads red on exactly those two checks |
| #131 / #132 | distroless digest `bf3d7b0` → `afc6657` (api / web) | not integrated, same reason |

Merging `main` into #130–#134 now would only re-read the same two reds. Once #135 is on `main`, each
needs `main` merged in again, and #134 needs its lockfile regenerated, because both npm groups
share it.

## Release decision

**`v0.15.1`, patch, still pending.** Since `v0.15.0`, `main` has gained no ADR and no `feat:`
commit. No Dependabot merge is on `main`, so a tag now would contain nothing it names. It is
unblocked by **one merge: #135**. That alone makes the tag true, and because #135 carries the fix for
a critical advisory, it is worth cutting as soon as #135 lands rather than holding it for the Docker
pairs. The line under *Releases* in `STATUS.md` says so. The 2026-09-29 run had put it in the
*Phases* table by mistake, and it has moved.

**Cut the same afternoon.** The owner approved merging #135, and it landed at 13:53 UTC. `main`
(`72924a1`) then read green on every check, `dependency audit` and `images` included, and `v0.15.1`
was cut on it as a patch. It contains one dependency merge and documentation, and no ADR, migration or
configuration change. The *Releases* row replaces the pending line, and the Release notes say what
the version contains. #130–#134 are not in it.

## Follow-ups

- **2026-10-15**: the two `.trivyignore` entries lapse and `images` fails on every branch again.
  Delete them in the pull request that moves the distroless digest to one shipping deb13u3
  (Dependabot opens it when distroless republishes). If that has not happened by then, the failure
  is the prompt to decide again, not a flake.
- `node`'s own bundled OpenSSL is outside the scanner's view and was not assessed against these
  two CVEs.
- No `ignore:` entry proposed for `.github/dependabot.yml`.
