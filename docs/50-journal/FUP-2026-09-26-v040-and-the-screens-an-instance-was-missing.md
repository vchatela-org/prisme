# FUP · 2026-09-26 · `v0.4.0` cut — the screens an instance was missing, and the guide that could describe them

**Agent:** Claude · **Duration:** one session · **PR** [#99](https://github.com/vchatela-org/prisme/pull/99) · **Outcome:** complete

Asked, in one line, to cut a new `v0.4.0` following the last merge. The version asked for and the
version the release rule allows agree, which is not something to assume: the check that confirms it
is what the cut rests on.

## What was done

Four checks before the tag, because a version is a claim rather than a label:

- the newest tag was `v0.3.0` (cut on `66b910e`), and `git tag -l v0.4.0` was **empty** — a version
  that exists is never reused and never re-pointed;
- `main` had gained the wave over **#89–#98**, all merged, so the tag would be **true**: the work it
  names is already on `main`, at `47b3110`;
- what it gained includes **five `feat:` commits** and **no new ADR** in `docs/20-decisions/`;
- none of it is a dependency move — no `dependabot/` merge is in the range at all.

`v0.4.0` was cut as an **annotated tag on `main`'s head** and pushed once. `publish.yml` fired on the
tag and ran **green**: both matrix jobs — `prisme-api` and `prisme-web` — completed successfully, and
both images were pushed with a digest recorded per image (`prisme-web` `sha256:5767d64e…775776c`,
`prisme-api` `sha256:c5a5eedc…2eec6c8`).

## The version's subject

The wave closes one gap seen from several sides: **the API could do things no screen called**, so a
running instance was configured by hand-written calls and a guide could only describe workarounds.

- **Settings** (#94) — areas, their colours, the task tool's locations and the document tool's
  bindings get a surface, and the overview names what each points at rather than an identifier.
- **Adoption** (#95, #96) — adoption created nothing and could still erase (a first-time `update`
  would have cleared a deadline, reset a priority and moved an anchor out of its own area); the queue
  now refreshes itself on the daily pass and takeaways reach the Inbox.
- **Rituals, dependencies, conflicts** (#97) — three routes that had no caller get screens.
- **A user guide for using prisme** (#98), written last, describing the product rather than
  apologising for it.

## Decisions taken

**Minor, not patch** — five `feat:` commits and no new ADR since `v0.3.0`, which is the release
rule's second signal. The reason is stated in the tag message rather than left for a reader to infer
from the commit log.

**The tag points at `main` and at nothing else** — created against `main`'s head commit, never a
branch, and pushed once.

**The stale `v0.3.0` row was corrected here rather than left.** The register still read *"Not yet
pinned — the deployment still runs `v0.2.0`"*, and the pods say otherwise: both tiers run `v0.3.0`.
A register that disagrees with the cluster is the class #93 was about, and updating the table for
`v0.4.0` without correcting the row above it would have shipped a dashboard that contradicts itself.

## Surprises

**The release record ran the local deny-list, and it caught something already on `main`.** A fresh
worktree has no `.github/privacy-denylist.local.txt` — it is gitignored — so the scan there reports
"clean" against the 23 public patterns alone and says nothing about the class the supplement exists
for. Copying the supplement in and re-running surfaced a **French area name inside a web test**,
committed by `bf14961` (#94): the string appears nowhere else in the repository, and every fixture
uses the deliberate English vocabulary instead. The name is not reproduced here. It is a
history-remediation question rather than a file-editing one, so it is reported and left for the
owner; what this run records is that **a clean scan in a worktree is not the same control as a clean
scan with the supplement**, and the difference is invisible unless the file is copied in.

## Follow-ups

1. **The pin is the deployment's, not this repository's.** `v0.4.0` is published and **not pinned**;
   the running instance keeps the version the deployment names until its pin moves. Release, then
   pin — the order the last releases had to learn, and the reason a cut version is not a delivered
   one.

2. **Tagging discharges no open row.** The rituals still have no loader, the adoption queue has not
   been worked, and the property that would unblock declared durations is not set. A version
   publishes code; it does not close a register row.

3. **The privacy finding is reported and unfixed, and the owner owns it.** Fixing it forward is a
   small pull request and does not remove the string from `main`'s history, which is permanent and
   shared with every clone; the only remediation that does is a force-push, which is the owner's
   call and was not taken.

## Specs touched

None. No spec diverged — the wave was already merged and its specs corrected by the pull requests
that changed them; this entry records a release, not a change.
