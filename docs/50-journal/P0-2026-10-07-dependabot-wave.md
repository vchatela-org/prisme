# P0 · 2026-10-07 · Nothing to integrate, and `v0.15.4` cut for the merged pair

**Agent:** Claude (orchestrator, scheduled and unattended) · **Duration:** one run · **PR:** this
entry's own · **Outcome:** no open Dependabot pull request; `v0.15.4` cut on `fe6064e`, published
and not pinned

This run follows a merge, which the skill names as the run most likely to owe a release. The
[2026-10-06 run](P0-2026-10-06-dependabot-wave.md) left #141, #142 and #143 green and waiting on a
human. All three merged between 09:42 and 09:52 UTC the same morning, after `v0.15.3` had been cut.
No tag contained them.

## What was done

| PR | Bump | Result | Read at | What it took |
|---|---|---|---|---|
| — | — | — | — | `gh pr list --app dependabot --state open` returned nothing. No subagent was spawned |

Nothing is parked, and no earlier park marker is open.

## Release decision

**`v0.15.4`, patch, cut on `fe6064e`.** Since `v0.15.3`, `main` gained three Dependabot merges
(#141, #142, #143) and two record pull requests (#145, #146). It gained no ADR, no `feat:` commit,
no migration and no configuration variable. Dependency moves that reach an image make a **patch**,
so the patch field moved. `facts.sh` computed the same answer. `v0.15.4` existed nowhere, locally or
on the remote, and every one of the 14 checks on `fe6064e` read `completed/success` before the tag
was made.

It was worth cutting on its own and not held for the next wave. Both images now run on the distroless
digest `2ee7b2c`, which ships Debian's fixed OpenSSL. #142 also removes the two `.trivyignore`
entries that were due to expire on 2026-10-15. The deployed images are still on `afc6657`, and they
stay there until this version is pinned.

The tag was cut by following [`/release`](../../.claude/skills/release/SKILL.md) §3–§6. Notes were
drafted first and scanned clean against the public deny-list and the local supplement. Then came the
annotated tag on `origin/main`'s commit and `publish.yml` with both matrix jobs green on the first
attempt. Both digests were read back from the registry, not from the run summary, and the GitHub
Release was published as *latest*. The pin is the operator's, as it always is for this run.

## Follow-ups

- **Pin `v0.15.4`** (the operator). It is published, and the deployment still runs `v0.15.3`.
- **Merge this entry's pull request** (a human). It also adds the `v0.15.4` row under *Releases* in
  `STATUS.md`.
- **Discharged:** the 2026-10-06 follow-up on the `.trivyignore` waiver. #142 removed both entries,
  as the second of the pair, and `images` passed with no waiver.
- **Still open:** the 2026-10-06 note that the `postcss: '>=8.5.23'` override may be removable. That
  belongs in its own pull request.
- No `ignore:` entry proposed for `.github/dependabot.yml`.
