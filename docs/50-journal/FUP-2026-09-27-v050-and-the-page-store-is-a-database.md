# FUP · 2026-09-27 · `v0.5.0` cut — the page store is a database, and the register catches up

**Agent:** Claude · **Duration:** one session · **Outcome:** complete

Asked, in one line, to cut `v0.5.0` after the last merges. The version asked for and the version the
release rule allows agree, which is the check the cut rests on rather than the request.

## What was done

Four checks before the tag, because a version is a claim rather than a label:

- the newest tag reachable from `main` was `v0.4.2` (cut on `35f0f48`), and `git tag -l v0.5.0` was
  **empty** — checked on the remote too: a version that exists is never reused and never re-pointed;
- `main` had gained the wave over **#102–#103**, both merged, so the tag would be **true**: the work
  it names is already on `main`, at `ab6970a`;
- what it gained includes an **Accepted ADR** in `docs/20-decisions/` (0030) **and five `feat:`
  commits** — both of the release rule's minor signals;
- none of it is a dependency move — no `dependabot/` merge is in the range at all.

`v0.5.0` was cut as an **annotated tag on `main`'s head** and pushed once. `publish.yml` fired on the
tag and ran **green**: both matrix jobs — `prisme-api` and `prisme-web` — completed successfully, and
both images were pushed with a digest recorded per image (`prisme-api`
`sha256:facf42a3…1042fc7`, `prisme-web` `sha256:6dca00bf…da3ce91`).

## The version's subject

The wave is one decision carried through every layer: **a page store is a database, and its
templates are the document tool's own** ([ADR-0030](../20-decisions/0030-page-stores-are-databases-with-native-templates.md), #103).
The three template roles and prisme's block copy are gone; a new page is an entry of the store's one
data source, made from a template the tool applies itself. Alongside it, #102 removes the second way
in to configuration: **configuration is the screen's** — the file-and-command seed path and the
Vault-rendered colour map are gone, and Settings (and the API behind it) is the only path.

## Decisions taken

**Minor, not patch** — an Accepted ADR and five `feat:` commits since `v0.4.2`, which is the release
rule's second signal. The reason is stated in the tag message rather than left for a reader to infer
from the commit log.

**The tag points at `main` and at nothing else** — created against `main`'s head commit, never a
branch, and pushed once.

**The register was corrected here rather than left stale.** The Releases table named `v0.4.0` as the
newest version and said the deployment still ran `v0.3.0`; neither is true. `v0.4.0` and `v0.4.1` no
longer exist — both were removed by the two history rewrites, because each pointed into history that
was being replaced, and neither could be re-pointed. The surviving name for that wave is `v0.4.2`,
and the pods say the deployment runs it, both tiers. The table now reads that way. This is the same
class as the correction the `v0.4.0` entry made one release earlier: **a register that disagrees with
the cluster is worse than an incomplete one**, because it is cited with confidence.

The immediate cause is worth naming: `v0.4.1` and `v0.4.2` were cut and published correctly, but
their record pull request was **closed rather than merged**, so the table was never told about them.
A release that is cut and not written down is a release the next reader has to re-derive.

## Surprises

**The first release after `v0.4.2` retires the environment's colour pin.** #102 removes
`AREA_COLOR_PINS`, so a value that is still set in the deployment's environment becomes inert the
moment the pin moves to `v0.5.0`: an area's colour is the one chosen in **Settings → Areas**, else
its key hash. The instance has eight ranked areas and the palette has eight slots, so the hash
collides — the pin existed for exactly that. This is the deployment's action, not this repository's,
but it now has an order: **choose the colours on the screen first, then drop the environment key**,
or the areas fall back to colliding hashes on the upgrade.

## Follow-ups

1. **The pin is the deployment's, not this repository's.** `v0.5.0` is published and **not pinned**;
   the running instance keeps the version the deployment names until its pin moves. Release, then
   pin.

2. **Colours before the pin** — see *Surprises*. The screen first, then the environment key, then the
   pin.

3. **`v0.4.0`'s and `v0.4.1`'s images remain in the registry** even though their tags are gone. They
   carry nothing an upgrade needs, but a version whose source tree no longer exists should not be
   pinned by anyone who finds it.

4. **Tagging discharges no open row.** The rituals still have no loader, the adoption queue has not
   been worked, and the duration property that would unblock declared durations is unset. A version
   publishes code; it does not close a register row.

## Specs touched

None. The wave was already merged and its specs corrected by the pull requests that changed them —
#103 updated `docs/14`, `15`, `17` and `18`; #102 updated `docs/13`, `15`, `17` and `18`. This entry
records a release, not a change.
