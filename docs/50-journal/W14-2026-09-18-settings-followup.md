# W14 · 2026-09-18 · The two settings closed, by hand, after merge

**Agent:** Claude Sonnet 5 · **Duration:** one session · **PR** — (repository settings, no code) ·
**Outcome:** complete

## What was done

W14 (#23) merged with two items listed for a human rather than closed silently: `main`'s
required-check list missing `golden fixtures` and `security gate self-test`, and secret scanning's
validity checks / non-provider patterns still off. Both are closed now.

- **Required checks.** PATCHed `main`'s branch protection with the full 15-context list. Read back
  from the API to confirm.
- **Secret scanning.** The repository-level toggle from `docs/17-privacy.md` §4 was never going to
  work — it returns success but silently no-ops. The real mechanism is an org-level **code security
  configuration**, which needs the `admin:org` OAuth scope. Attaching the org's existing default
  configuration failed for this repository specifically: it also carries
  `code_scanning_default_setup: enabled`, which collides with prisme's custom advanced-setup CodeQL
  workflow, and the attach is atomic — one colliding setting took the two we wanted down with it,
  with no error, just a `status: "failed"` on the per-repository attachment record. Fixed by
  creating a second, repo-scoped configuration that touches only the secret-scanning settings and
  leaves code scanning, dependency graph and Dependabot as `not_set`.

## Decisions taken

**A narrow, repo-scoped configuration rather than editing the org default.** The org's "GitHub
recommended" configuration presumably serves other repositories; changing what it enables to work
around one repository's custom CodeQL setup would be a silent, blast-radius-widening fix. A second
configuration, attached only here, fixes prisme without touching anyone else's defaults.

## Surprises

`repos/<owner>/<repo>` (`security_and_analysis`) does not reflect settings applied through an org
configuration — it kept reporting both as `disabled` after they were verifiably `enabled` and
`enforced`. `repos/<owner>/<repo>/code-security-configuration` is the field that is actually true.
This cost real time; anyone checking this again should read that endpoint, not the repository
settings payload docs/17-privacy.md §4 used to suggest.

## Follow-ups

None open on this. Unrelated and not fixed here: a `ggshield` cache file (`.cache_ggshield`,
hashes only, no live secret) is tracked in git despite being listed in `.gitignore` — it was already
tracked before the ignore rule was added. Worth an `git rm --cached` in a future pass, but it is a
hygiene item, not a leak.

## Specs touched

`docs/17-privacy.md` §4 — both checklist items marked closed, with the mechanism and the collision
that caused the first attempt to fail. `STATUS.md` — the required-check warning replaced with
confirmation that both are enforced.
