# FUP · 2026-09-24 · The non-functional open decisions: one decided, one count corrected, four made checkable

**Agent:** Claude · **Duration:** one session · **PR** [#NN](https://github.com/vchatela-org/prisme/pull/NN) · **Outcome:** complete

The follow-up wave's other half: the open questions that are not the owner's to answer at a review.
Three of them are record work — a count, a filing and four triggers — and the fourth needed code,
because "fail closed" is a claim about behaviour and a document cannot test it.

## What was done

- **OQ-10 decided and implemented.** [ADR-0027](../20-decisions/0027-audit-gate-fails-closed.md)
  (**Proposed** — an agent does not accept its own ADR) and
  [`scripts/dependency-audit.py`](../../scripts/dependency-audit.py), with the `dependency audit` job
  running it. The check has three outcomes and a status list has room for two, so the gate now names
  which one it saw and fails on the third.
- **The decision count is true in all three places.** `STATUS.md` said *7 open* while `OPEN.md` held
  **eight**; the count is now written in `STATUS.md`, in `OPEN.md`'s own header and beside
  `README.md`'s index, and each says 25 accepted · 1 superseded · 1 proposed · 8 open. No question was
  actually closed, so none moved to *Recently closed*.
- **OQ-3, OQ-5, OQ-6, OQ-7 stay deferred, with triggers that can be recognised.** Each trigger is now
  an observable fact — an elapsed month *and* a count of mapping friction, four consecutive weeks of
  ritual adherence, a contested review or a quarter of stored decisions, three months of completion
  history beside one declared estimate — rather than a phrase like "after a month of real use", which
  has no end and so gets re-argued every time it is reached.
- **OQ-1, OQ-2 and OQ-4 are untouched**, deliberately. They are the owner's, and they are answered at
  the first real review; editing them here would be an agent deciding a model question by tidying it.

## Decisions taken

**The gate fails closed, and the failure is named rather than merely red.** The first of the two
choices in OQ-10's own text — *"a green that means 'could not check' is worse than a red"* — chosen
out loud, now that it has been measured. What the measurement changed is the *shape* of failing
closed: the recorded harm was never that the gate was red, it was that a reviewer could not tell an
npm outage from a vulnerability. Both are still red. One of them now says so.

**The tempting alternative is refused with a control rather than a comment.** `pnpm audit` has
`--ignore-registry-errors`, whose help text reads reasonably and whose effect is a green on an
unanswered registry (measured below). A control asserts the flag stays out of the command, so
re-adding it in a year's time is a red build rather than a quiet improvement.

**The controls run as steps inside the existing required check.** No new check name, so branch
protection — a human's setting — needs no edit. This is
[FUP-2026-09-23-typecheck-tests](FUP-2026-09-23-typecheck-tests.md)'s reasoning reused: a new context
that is not yet required is a green nobody reads, and adding one is somebody else's job.

**A count is written down in three files, which is unusual and is the point.** The count was wrong for
four days in two files at once and no check reads either. Three copies would normally be three places
to drift; here the alternative is one place that is wrong and silent, and the copies are compared by
whoever reads the next decision.

## Surprises

**`--ignore-registry-errors` does not report a degraded reading — it reports a clean one.** Against a
dead registry it prints a report *the same shape as a real clean audit*: the genuine dependency counts,
all five severity keys, zero advisories, exit 0. The only trace is a stderr line naming the failed
request. This was measured, not reasoned about, and it is the whole reason the classifier reads
evidence of an unanswered query *first* — ahead of the exit code and ahead of the report.

**A dead endpoint does not always fail; it can hang.** A stopped local endpoint that had answered
instantly a moment earlier left `pnpm audit` running past sixty seconds — and through the script, three
attempts in a row did not finish. So `FETCH_TIMEOUT` bounds each attempt at 120s and a timed-out
attempt is `unchecked` like any other silence: a check that never reports blocks a merge exactly as
hard as one that fails, and less legibly.

**With the classifier's stderr-first check removed, exactly one control goes red.** Not the one you
would expect: the "unreachable endpoint" control still passes, because that case has no report to
misread, and the trap control — `--ignore-registry-errors` output, exit 0 — is the only one that
notices. Recorded because it is the argument for having controls at all: the obvious case was already
covered and would have hidden the regression.

**`--prefer-online` is not a flag in pnpm 12** (`unexpected argument`, exit 2), so the audit
subcommand cannot be told to revalidate; there is no way to ask it for a fresher reading than it gives.
Recorded as a limit of the gate in the ADR rather than papered over.

**The count had been wrong since 2026-09-20, not since the file was written.** OQ-10's addition and
W15's ADR-0025 work landed around then; the line was not updated with either. The failure mode is
worth the sentence: nothing reads a count, and the only reason it surfaced is that this task had to
establish it.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| **ADR-0027 needs accepting** | It is Proposed, and OQ-10 stays open until it is Accepted. An agent does not accept its own ADR | the owner, at the next review |
| The audit's freshness limit | pnpm cannot be told to revalidate the audit (`--prefer-online` does not exist), so the reading is as fresh as pnpm makes it. Not a pass-without-check, and stated in the ADR's Consequences | nobody, unless it matters — then the vendored database, as a supersession |
| The vendored/cached advisory database | The ADR's strongest alternative and the one that would keep the gate green *during* an outage. Rejected now, with its trigger written in the ADR's *Revisit when* | this wave's successor, if the endpoint's unavailability stops being rare |
| OQ-1, OQ-2, OQ-4 | Untouched here on purpose. Functional, model-level, answered at the first real review | the owner |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `dependency-audit` selftest | local | 11 controls behaved as required |
| the same selftest, **watched fail** | local | with the stderr-first check removed: **1** control red (the `--ignore-registry-errors` one). With `--ignore-registry-errors` added to the command: the command control red |
| the real audit | local | `checked-clean`, exit 0, attempt 1/3 |
| the unreachable path, end to end | local | `unchecked` on all three attempts, exit 2, the summary saying *not a vulnerability report* |
| `privacy deny-list` | local | clean, 44 patterns |
| `internal links` | local | see the pull request; every new link resolves to a file that exists |
| the rest | CI | see the rollup on the pull request |

## Privacy

Fixture and invented data only. The script's audit fixtures are fabricated (`fixture-lib`, an
invented advisory title, an `example.invalid` URL); the captured pnpm error text is the tool's own
wording about a public registry and names no workspace. Nothing here names a real goal, project, task,
area, weight or host. The one privacy-relevant *behaviour* is in the script rather than its content:
what it prints of a third-party report is type-checked, stripped of control characters and truncated,
and a credential in a failed registry URL is redacted before it can reach a public build log.

## Specs touched

- [`docs/14-threat-model.md`](../14-threat-model.md) §6 — the `npm audit` row gains the semantics it
  never had: it asks a remote endpoint, it fails closed, and it names which failure it is.
- [`docs/20-decisions/0027-audit-gate-fails-closed.md`](../20-decisions/0027-audit-gate-fails-closed.md)
  — new, **Proposed**.
- [`docs/20-decisions/OPEN.md`](../20-decisions/OPEN.md) — OQ-10 answered-not-accepted; the four
  deferred questions given checkable triggers; **OQ-3 moved out of *Blocking future phases***, which
  its own `Blocks: nothing` line had contradicted since it was written; the count written into the
  header.
- [`docs/20-decisions/README.md`](../20-decisions/README.md) — the 0027 row, and the counts beside
  the index.
- [`STATUS.md`](../../STATUS.md) — the Decisions count and the paragraph that explains it, the
  Follow-up wave rows, and the sentence describing what `dependency audit` now runs.
- `.github/workflows/ci.yml` and `scripts/dependency-audit.py` — the gate itself. Not a spec, but the
  thing every spec above now describes.
