# P0 · 2026-09-15 · Reading checks back is now part of "green"

**Agent/author** Claude Code · **Duration** one session · **PR** #<!-- fill in on open --> ·
**Outcome:** complete

## What was done

[The branch-and-PR protocol](P0-2026-09-15-branch-and-pr-protocol.md) states the *condition* for
finishing — every check green — in four layers. None of the four stated the *act*: that finishing
means reading the checks back from the pull request, that a push invalidates the last read, and that
a check still queued or in progress is not green. An agent could open a PR, see an empty rollup in
the first seconds after opening it, and stop — nothing told it that was the wrong moment to read.

The same four layers, extended rather than replaced:

| Layer | File | What changed |
|---|---|---|
| Override | [`CLAUDE.md`](../../CLAUDE.md) §5 item 8 | States the read explicitly: a push resets it, queued/in-progress/absent is not green |
| Contract | [`docs/40-workstreams/README.md`](../40-workstreams/README.md) | New `### Read the checks back` subsection — the mechanism: `gh pr checks <n> --watch`, `gh pr view --json statusCheckRollup`, name the check and the commit it was read at |
| Prompt | [`.claude/agents/README.md`](../../.claude/agents/README.md) + all 16 workstream definitions | Same instruction, in the file each spawned agent actually reads; each points back at the protocol section rather than repeating the mechanism |
| Mechanism | [`.github/pull_request_template.md`](../../.github/pull_request_template.md) | A "read at commit" line under the checks table, and the footer states the read is required, not assumed |

`STATUS.md`'s summary sentence gained the same clause, so the dashboard says the same thing as the
protocol it links to.

## Decisions taken

- **The escape hatch for a check that is red for a reason outside the agent's tree stays as it is.**
  Confirmed rather than assumed: the alternative — no exception, continue until literally every check
  is green — would give an agent facing a genuine runner outage no legal ending. The existing row in
  *Where you stop* ("say so explicitly, raise it, never disable the gate") already covers this
  correctly; nothing here changes it.
- **The rule lives in all five surfaces, not just the protocol.** The repository's own stated
  principle — "the substance lives in `docs/40-workstreams/`, an agent's first job is to read its
  brief" — argued for a pointer-only approach in the 16 agent definitions. Rejected: an agent that
  never reaches the pointer is exactly the failure this closes. Each definition carries the full
  instruction inline, plus the pointer for the mechanism.
- **The pointer from each agent definition to the protocol is a code span, not a markdown link.**
  `scripts/check-doc-links.py` scans every tracked markdown file including `.claude/agents/`, and a
  real link from that directory needs a `../../` prefix the existing brief citations don't carry
  (they cite briefs as code spans too, e.g. `w00-foundations.md:10`). Matching that convention avoids
  introducing the one link form the directory doesn't already use.
- **"CI passes" is named explicitly as not a result.** The PR template's `## Checks` comment already
  said "do not summarise as 'CI passes'"; the new text extends the same instinct to the read itself —
  a check missing from the rollup gets written as missing, not omitted.

## Surprises

**A peer agent session was live in the same working tree while this was written**, on a different
branch, fixing a Dependabot PR. It ran `git stash` on my uncommitted edits under the (correct, but
unlabelled to it) assumption they were unrelated — the stash message called them "pre-existing
`docs/ci-verification` WIP, unrelated to PR8". Nothing was lost: the stash held all thirteen files it
took, and a fourteenth (`w14-security.md`) had landed just before the stash and wasn't included in it.
Both were recovered — the stash applied into a fresh `git worktree`, the fourteenth file re-edited by
hand — and a message to the peer session confirmed the stash was mine and asked it to leave the shared
tree to me. It agreed and held back a queued subagent until I'd moved out.

Worth recording as a fact about running two agents against one working directory rather than one
against two worktrees, as the roadmap's scheduling section already prescribes for parallel
workstreams: an agent-initiated `git stash` on someone else's WIP is not itself a bug — the peer read
the situation correctly — but it is a sharp edge this repository's own protocol exists to route
around. **This session moved to `git worktree add` after the fact rather than before**, which is the
one thing to do differently: cut the worktree before the first edit, not after the first collision.

## Verified

`python3 scripts/check-doc-links.py` — clean, 345 internal links across 88 files; this is the gate
that would have caught a wrong slug on the new `#read-the-checks-back` anchor, since the heading and
every citation of it landed in the same change.

`./scripts/privacy-scan.sh` — clean. Nothing here touches data; no check name, host or workspace ID
is introduced by this change.

Every one of the 16 `.claude/agents/w*.md` files carries the new closing paragraph exactly once — the
four with a leading "Fixture data …" sentence were edited to keep their existing wrap and sentence
rather than overwritten wholesale.

CI on this PR, read back per the rule this PR itself adds: <!-- fill in check names and results
after opening, from the actual rollup, not before it has run -->.

## Follow-ups

- **A CI check that a PR's checks were actually read back is not proposed here**, for the same reason
  the sibling entry declined a template-conformance check: a new required check on the first PRs it
  would govern risks blocking them before the convention has settled. Worth revisiting once a few
  workstream PRs have gone through this version of the protocol.
- **Running two agent sessions against one shared working directory remains possible** even though
  the scheduling guidance says worktree-per-workstream. Nothing in this repository enforces that at
  the tooling level; it is convention, observed this time only because the peer session noticed and
  asked rather than silently discarding what it found.
