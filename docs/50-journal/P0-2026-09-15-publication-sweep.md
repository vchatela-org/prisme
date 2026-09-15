# P0 · 2026-09-15 · Pre-publication sweep; the repository is public

**Author:** Claude (Opus 5), with the project owner · **Duration:** one session · **Outcome:** complete

## What was done

Ran the pre-publication sweep in [`../17-privacy.md`](../17-privacy.md#5-pre-publication-sweep), then
published the repository and switched on the §4 settings.

All six sweep items passed: gitleaks over the working tree and over the whole history, the deny-list
scan over the whole history, a manual read of `docs/` and `fixtures/`, every commit message read in
full, and `seed/` confirmed absent from `git ls-files`.

## Decisions taken

**The deny-list supplement is not optional.** §2.4 describes
`.github/privacy-denylist.local.txt` — gitignored, holding the concrete values the public list can
only describe as shapes — and it did not exist. Every scan up to this point had therefore been
checking ID *shapes* and nothing else. Written, and it is what produced the single finding below.
A clone that does not recreate it is running a materially weaker gate than it appears to be.

**Deployment detail that the contract does not need was removed.** The runtime doc had acquired a
distribution version, a chart vendor, an ingress object type and a note about reachability from the
authoring host. All four described a specific person's cluster while contributing nothing to the
config contract — §1's private column. Removed from `15-runtime.md`, ADR-0022 and the
foundation-docs entry.

**Three near-misses deliberately stay**, with the reasoning written into the supplement so it is not
re-argued every time someone greps:

- the secret-agent injection model — `PRISME_ENV_FILE` exists *because* of it, so genericising it
  would leave the primary config path unexplained;
- the assertion header's default value — a default has to be concrete to be usable, and it names a
  public product rather than an instance;
- the reusable-workflow reference — the organisation is already public via the repository URL.

**History was rewritten, not just `HEAD`.** Scrubbing the working tree would have been theatre: the
removed text was still in the blobs, and publishing would have made it permanent. `git filter-repo`
redacted the strings across every commit, preserving messages, structure and authorship. Two
Dependabot branches predated the rewrite and still carried the old blobs in their ancestry, so they
were retired and their bumps applied directly to `main` instead.

**Licence: MIT**, closing OQ-8. `LICENSE` is the one deliberate entry in `.privacyignore` — a
copyright notice has to name its holder, and that is the only place the owner's name belongs.

## Surprises

- **The privacy gate had never actually run.** `scripts/install-hooks.sh` was committed and
  documented in two places, but nothing had executed it, so no commit had ever been checked locally
  — CI was the only gate. Installed. It failed on the first attempt, on the licence's copyright
  line, which is the control behaving exactly as designed rather than a fault.
- **The dangerous window is the one between scrubbing and pushing.** For several minutes the working
  tree was clean while the remote still served the original text. Had the repository been made
  public in that window the sweep would have accomplished nothing. Publication must be the *last*
  step, after the redacted history is confirmed on the remote — not after the edit is made locally.
- **CodeQL cannot cover the main language yet.** Default setup rejects `javascript-typescript`
  because no such code exists at P0; only `actions` could be configured. This is easy to forget
  precisely because the checklist box looks ticked.
- **Nothing was wrong with the content itself.** Fixtures, `seed.example/`, the sample sync output
  (already using `<redacted>`) and all 22 ADRs were clean, as was every commit message. The
  discipline held everywhere except the one place where a doc was corrected *against reality* and
  brought the reality back with it.

## Follow-ups

- **W00 must extend CodeQL to `javascript-typescript`** as soon as application code lands. Flagged
  in the §4 checklist as a partial tick, not a completed one.
- **Anyone cloning this repository** should run `./scripts/install-hooks.sh` and recreate
  `.github/privacy-denylist.local.txt`. The public list alone does not catch instance values.
- **Two secret-scanning extras** — validity checks and non-provider patterns — are not settable
  through the repository API and appear to need an organisation-level toggle. Neither is required.
- **A force-push leaves unreferenced objects addressable by SHA on GitHub.** Nobody holds those
  SHAs, since the repository was private for its whole life and never forked, so this was accepted
  rather than escalated to delete-and-recreate. Worth knowing if it ever matters again.
- **The next correction against live infrastructure is the risk to watch.** This finding did not
  come from carelessness; it came from a doc being made *more accurate*. Verifying against reality
  and writing down what was seen are the same motion, and only the second one leaks.

## Specs touched

| File | Why |
|---|---|
| `docs/17-privacy.md` | §4 checklist ticked, with the CodeQL gap and the admin-bypass trade recorded |
| `docs/15-runtime.md`, `docs/20-decisions/0022-…` | Deployment specifics removed |
| `docs/50-journal/P0-2026-09-15-foundation-docs.md` | Same, in the verification section |
| `docs/20-decisions/OPEN.md`, `STATUS.md` | OQ-8 closed as MIT; both checklists updated |
| `LICENSE`, `README.md`, `.privacyignore` | Licence added and its one exception recorded |
| `.github/workflows/dependency-review.yml`, `privacy.yml` | Dependency review wired; actions bumped |
