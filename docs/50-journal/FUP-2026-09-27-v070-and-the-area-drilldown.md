# FUP · 2026-09-27 · `v0.7.0` cut — the area drill-down ships

**Agent:** Claude · **Duration:** one session · **Outcome:** complete

Asked to cut the version after #106 merged. The version asked for and the version the release rule
allows agree, which is the check the cut rests on rather than the request.

## What was done

Four checks before the tag, because a version is a claim rather than a label:

- the newest tag reachable from `main` was `v0.6.0` (cut on `444bac6`), and `git tag -l v0.7.0` was
  **empty** — checked on the remote too: a version that exists is never reused and never re-pointed;
- `main` had gained #106, merged, so the tag would be **true**: the work it names is already on
  `main`, at `59b235c`;
- what it gained includes an **Accepted ADR** in `docs/20-decisions/` (0032) **and one `feat:`
  commit** — both of the release rule's minor signals;
- none of it is a dependency move — no `dependabot/` merge is in the range at all.

`v0.7.0` was cut as an **annotated tag on `main`'s head** and pushed once. `publish.yml` fired on the
tag and ran **green**: both matrix jobs — `prisme-api` and `prisme-web` — completed successfully, and
both digests were **read back from Harbor** rather than copied from the run summary
(`prisme-api sha256:d9e1a5f5…c00c0`, `prisme-web sha256:12e1a637…473d1`).

## The version's subject

An area's observed share could not be taken apart: `capacity_week` kept a count and a sum per week
and area, `materialise` discarded its per-completion rows, and no title was ever kept.
[ADR-0032](../20-decisions/0032-completed-task-titles-are-recorded.md) records a completed task's
title, read-only, so `GET /areas/{key}/completions` can list what made up the number, and the daily
refresh now fetches the trailing window before it materialises — the refresh had fetched nothing, so
the balance had stopped moving past the last backfill.

## Decisions taken

**Minor, not patch** — an Accepted ADR and one `feat:` commit since `v0.6.0`, both of the release
rule's signals. Stated in the tag message rather than left for a reader to infer from the commit log.

**The tag points at `main` and at nothing else** — created against `main`'s head commit, never a
branch, and pushed once.

## Follow-ups

1. **The pin is the deployment's, not this repository's.** `v0.7.0` is published and **not pinned**;
   the running instance keeps `v0.6.0` until its pin moves. Release, then pin.
2. **The first daily full pass after the pin moves fills in what the screen is missing today**: the
   completions list will read "counted but not listed yet" until a pass runs against the new image
   and backfills titles for the trailing four weeks.
3. **`v0.6.0`'s own row in this repository's Releases table is still missing** — a pre-existing gap,
   not introduced or closed here. Left as found: reconstructing it belongs with whoever verifies the
   freeze-lift facts, not folded into an unrelated release cut.
4. **Tagging discharges no open row.** The rituals still have no loader, the adoption queue has not
   been worked, and the duration property that would unblock declared durations is unset.

## Specs touched

None. #106 already updated `docs/11-ownership.md` and `docs/16-sync.md`. This entry records a
release, not a change.
