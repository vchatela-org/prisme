<!--
A reviewer should be able to decide whether to merge this from the description alone.
"Implements the brief" is not a description. Delete nothing; write "none" where the answer is none.
-->

**Workstream:** Wnn · **Brief:** `docs/40-workstreams/Wnn-….md`

## What changed

<!-- What this adds, and what the system now does that it did not do before. Features, not files.
     Two or three sentences, then the detail if it needs any. -->

## Where

<!-- The directories this touches, so a reviewer can confirm it stayed inside "Files you may touch".
     e.g. `packages/domain/**` only. Say explicitly if it touched anything outside. -->

## Features

<!--
The observable additions, as a list. Each line should be something a person could check,
not an activity. "cycle detection rejects a cycle with the path in the error" — not
"worked on dependency handling". -->

## Spec and decisions

<!-- Which specs in `docs/` this implements, and every ADR it touches. If it contradicts an
     Accepted ADR, stop — that needs a superseding ADR, not a pull request. -->

## Checks

<!-- The point of this section. Name every check and give its result. Do not summarise as
     "CI passes". If a check does not exist yet, say so rather than omitting it. -->

| Check | Where it ran | Result |
|---|---|---|
| `privacy deny-list` | CI | |
| `gitleaks` | CI | |
| `internal links` | CI | |
| `dependency review` | CI | |
| <!-- typecheck / lint / test / build, once W00 lands them --> | | |

**Locally, before pushing:** `./scripts/privacy-scan.sh` — <!-- result -->

## Privacy

<!--
This repository is public. Confirm each line rather than asserting the whole.
A reviewer must never have to take this on faith. -->

- [ ] Fixture data only — no real goal, project, task, weight, hostname or workspace ID
- [ ] No real values in tests, screenshots, journal entries or commit messages
- [ ] Deny-list and secret scans green (above)

## Not done

<!--
What is deliberately out of scope, and who owns it instead. This is as useful to a reviewer as
what you did — it is how they know the brief is complete rather than partially read. -->

## Follow-ups

<!-- What the next person should know, with owners. Open questions raised, if any. -->

---

<!--
Before you stop: every check above must be green. Do not merge this yourself — a human merges.
If a check cannot be made green for a reason outside your tree, say so here and in your journal;
do not disable the gate to get past it.
-->
