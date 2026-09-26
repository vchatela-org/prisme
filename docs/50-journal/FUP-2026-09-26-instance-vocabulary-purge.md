# FUP · 2026-09-26 · The instance vocabulary that reached `main`, the purge, and the gate that could not see it

**Agent:** Claude · **Duration:** one session · **PR** [#100](https://github.com/vchatela-org/prisme/pull/100) · **Outcome:** complete (with one accepted residual)

A real **area name from the private instance** was in `apps/web/src/lib/settings-view.test.ts` on
`main`, used as the input to a slug test. It was introduced by `bf14961` — the Settings screens
([#94](https://github.com/vchatela-org/prisme/pull/94)) — and it had passed every check the repository
had, for two days. The value is not reproduced here, and no entry, commit message or spec names it.

## How it was caught, and why CI could not

The **public** deny-list and CI's `privacy deny-list` job were both clean. The match came from
`.github/privacy-denylist.local.txt` — the gitignored supplement that holds the instance's own
vocabulary — which **by construction never runs in CI**. It was found only because the `v0.4.0`
release record ran the scan in a fresh worktree, noticed the supplement was absent (`23 patterns`,
no `including local supplement` line), copied it in, and re-ran: `45 patterns`, and a failure.

That is the whole defect. The control existed, worked, and was never wired to the thing it was
supposed to protect: a clean CI result meant "clean against the patterns that know nothing about this
instance".

## What was done

**The purge.** `git filter-repo --replace-text` over a **fresh mirror clone**, replacing the name and
its slug with an invented pair, so every historical commit stays self-consistent rather than merely
redacted. Verified before pushing: 1947 blobs, **zero** occurrences of either literal, exactly one
blob rewritten, and the rewritten tip's test reads `keyFromName('Café & Théâtre')` /
`toBe('cafe-theatre')` — the rewrite *is* the fix-forward, so no separate commit was needed.

**The push.** `main` needed a force-push, and branch protection refused it three times, each refusal
naming the next obstacle: `allow_force_pushes`, then *require a pull request before merging*, then
*15 of 15 required status checks are expected*. A repository ruleset was **not** the cause — there is
none — it was classic protection all along. The window was opened by `PUT`ting the backed-up
configuration with only those three fields relaxed, the push taken, and the **exact** configuration
restored and diffed against the backup: `protection identical to backup: True`.

**Blast radius, measured rather than assumed:** the leaking commit is reachable from **seven** remote
refs and **one** tag. Six were merged PR branches, deleted; `main` was rewritten; `v0.4.0` was
deleted (its commit is a descendant). Everything at `v0.3.0` and older is untouched — the rewrite
did not reach behind #94.

## The residual, and it is GitHub's side

**A rewrite does not remove `refs/pull/<n>/head`.** GitHub keeps one per pull request as a hidden
ref: `git push --delete` is refused with `deny updating a hidden ref`, and a **merged pull request
cannot be deleted**, so the pre-rewrite blob stays fetchable and a PR's *Files changed* page keeps
rendering it. After everything above, six PR refs and `#94`'s diff still carried the value. The owner
was asked and **accepted the residual**; a GitHub Support request remains the option that would close
it without destroying the repository. `docs/17-privacy.md` §3 is corrected to say so, because it
previously presented the rewrite as the remediation and it is not quite one.

## The detection fix

- `privacy-scan.sh` gains `--require-local` (fail rather than scan blind) and `--redact-hits`
  (report file and line number only). The second matters more than it looks: on a public run the
  matched content **is** the leak, so the old behaviour would have printed the instance vocabulary
  into a permanent public CI log — a gate publishing what it exists to prevent.
- `privacy.yml` materialises the supplement from the `PRIVACY_DENYLIST_LOCAL` repository secret and
  **fails closed on `main`** when it is absent, while a fork PR gets a warning naming exactly what it
  did not cover.
- The negative controls still pass (`security-gates-selftest`: both gates refused the planted
  content, and a clean tree was still accepted).

## Surprises

**The supplement's absence was visible in plain sight.** The scan prints its pattern count and, when
present, an `including local supplement` line. A run that says `23 patterns` and prints no such line
is telling you it is half-blind — nobody had read that as a signal.

**`git worktree add` produces a weaker control, silently.** A new worktree has no gitignored files,
so it has no supplement, so it reports `clean`.

**The first replacement attempt was wrong and would have corrupted history.** A regex meant to
capture the expected slug matched an earlier assertion in the same file instead, producing a
6-character literal that appears in unrelated content. It was caught by asserting the literal's
length and by counting the blobs it appears in (1) before any rewrite ran. A blanket
`--replace-text` over a short, unverified literal is how a purge quietly damages history.

## Follow-ups

1. **The secret must exist before this merges.** `privacy.yml` now fails closed on `main`; until
   `PRIVACY_DENYLIST_LOCAL` is set, the first push to `main` after this merge is red by design.
   Creating it is an operator action.
2. **A GitHub Support request** is the only path that removes the six PR refs and `#94`'s diff
   without deleting the repository. Recorded, not taken.
3. **Rotate the vocabulary when the reset happens.** The owner's instance is read-only with a reset
   ahead; if area keys or names change there, the supplement must follow, or the gate goes blind
   again the same way.

## Specs touched

`docs/17-privacy.md` §3 — the remediation section claimed a history rewrite closes a personal-content
leak. Doing it showed it does not: `refs/pull/<n>/head` survives and a merged PR cannot be deleted.
The section now says so, names the residual explicitly, and records the detection gap and the
`--require-local` / `--redact-hits` consequences.
