# ADR-0027 · Fail the dependency audit closed, and name the failure it is

**Status:** Accepted · 2026-09-24 · answers OQ-10

> **Accepted by the owner on 2026-09-24, the day after it was written.** It landed **Proposed** and
> implemented: the workflow change it decides was made in the same pull request, because the
> alternative — leaving the gate in the state
> [#31](https://github.com/vchatela-org/prisme/pull/31) hit — is a required check whose red means two
> different things. An agent does not accept its own ADR, so the record sat Proposed for a day while
> the gate it describes was already strict; the acceptance is what makes the decision binding rather
> than what makes the gate work. OQ-10 is closed in [`OPEN.md`](OPEN.md).

## Context

`dependency audit` has been a required check since W00 ([#5](https://github.com/vchatela-org/prisme/pull/5))
and is W14's to own — its brief covers the CI gates. It runs
`pnpm audit --audit-level=moderate`, which asks `registry.npmjs.org/-/npm/v1/security/advisories/bulk`
at check time for the advisories covering this lockfile. [`14-threat-model.md`](../14-threat-model.md)
§6 lists it as a supply-chain control that gates the build, at `moderate` rather than `high` because
the assets in §1 are API tokens to an entire planning workspace.

**The gate has three outcomes and reports two.** The database answers and nothing matches; the
database answers and something does; the database does not answer at all. `pnpm audit` exits 1 for the
last two, and a required check carries a single status — so "could not check" and "found a
vulnerability" are the same red in the pull request's status list, and a reviewer cannot tell an npm
outage from a CVE. Because the check is required, an upstream outage also blocks merges on branches
that change no dependency at all. That happened to #31 on 2026-09-19 and cost a re-run cycle.

OQ-10 recorded the question rather than deciding it, and recorded the non-negotiable with it:

> Whichever is chosen must not become a gate that passes when it has not actually checked.

Four things were measured on 2026-09-24 before deciding anything, because three of the four shapes
are counter-intuitive enough that reasoning about them would have been guesswork:

1. **An unreachable endpoint is a readable failure.** `pnpm audit --json --registry=<dead>` exits 1,
   writes nothing to stdout, and prints `ERR_PNPM_AUDIT_BAD_RESPONSE` / *"Failed to request the audit
   endpoint"* to stderr. Nothing is lost; nothing was consulted either.
2. **The tempting one-flag fix is a gate that passes without checking.** `pnpm audit` has
   `--ignore-registry-errors`, documented as *"Use exit code 0 if the registry responds with an
   error"*. Against a dead registry it prints a report that is **the same shape as a clean one** —
   real dependency counts, all five severity keys, zero advisories — and exits 0. The only trace is a
   stderr line naming the failed request. A reviewer reading the summary sees a clean audit.
3. **Nothing is answering from a cache.** Pointed at a local endpoint that had answered instantly a
   moment earlier and was then stopped, the same command served no stored answer and ran past sixty
   seconds. So the reading is a question asked now, not one remembered — and a black-holed endpoint
   does not fail, it *hangs*, which for a required check is a merge nobody can unblock.
4. **There is no flag to ask for a fresher reading.** `--prefer-online` is not an argument in pnpm 12
   (`unexpected argument`, exit 2), so the audit subcommand cannot be told to revalidate.

Two constraints are not about npm at all. Branch protection is a setting a human makes, and W14 and
[`FUP-2026-09-23-typecheck-tests`](../50-journal/FUP-2026-09-23-typecheck-tests.md) both recorded what
follows from that: a check whose *name* is new is a check nobody reads until a human adds it, so a
control that must run belongs inside an existing required check. And the audit report is third-party
data like any other — §2 boundary ⑤ — so what it says cannot be trusted into a log unexamined.

## Decision

**1. The gate fails closed, and stays required.** Green means the advisory database answered **and**
nothing at or above `moderate` matched. Unreachable, unreadable, unanswered-in-time and partial all
mean red. There is no state in which this check is green without a reading.

**2. Reachability is never a pass, and the flag that would make it one is refused.**
`--ignore-registry-errors` is never passed, and the negative controls assert it stays absent from the
command — so re-adding it is a red control rather than a green pull request.

**3. The failure says which failure it is.** `scripts/dependency-audit.py` classifies each attempt
into exactly three states and publishes the state to the job summary and an annotation:

| State | Means | Exit |
|---|---|---|
| `checked-clean` | the database answered; nothing at or above the level | 0 |
| `vulnerable` | the database answered; advisories to read, listed by module and severity | 1 |
| `unchecked` | no reading: unreachable, unreadable, timed out | 2 |

Both non-clean states are red. The distinction is for the person reading the job, because the merge
gate cannot carry it and must not be able to.

**4. A bounded retry, and a bounded attempt.** Three attempts, 5s and 15s apart, for any outcome that
is not a reading — a blip self-heals with no human in the loop. Each attempt is killed at 120s, so the
worst case is a known few minutes rather than the hang measured above.

**5. The controls are steps inside the same required check.** Eleven controls assert the classifier's
behaviour — including the `--ignore-registry-errors` shape, which must read `unchecked` even at exit
0 — and they are watched fail rather than asserted. The required-check list does not change and needs
no human: the check that already exists gets stricter.

**6. The remedy during a real outage is to re-run the job** once the registry answers. Never an empty
commit, and never the flag. The merge is blocked until then, deliberately.

**7. What reaches the log is parsed, sanitised and truncated.** Severity counts are type-checked
(anything else fails closed), control characters and credentials in a failed registry URL are
stripped, and a hostile report cannot forge the verdict it is printed in.

## Consequences

**The cost is stated rather than softened: during an advisory-endpoint outage nothing merges here,
including a branch that touches no dependency.** That is the price of the second non-negotiable — a
green must mean a reading. It is loud, rare, and clears with one re-run; the alternative's cost is a
silent hole in a public history, which is the wrong trade for a single-owner repository whose merge
rate is a handful a day.

**The red is now self-describing.** A reviewer reads `unchecked` and knows to re-run; they read
`vulnerable` and know to read the advisory. Before this, both said `dependency audit failed`.

**A classifier now sits between the gate and its verdict, so the classifier is a thing to get wrong**
— which is why the controls exist, and why they were watched fail. It is worth recording what that
exercise showed: with the stderr-first check removed, **exactly one** control goes red — the
`--ignore-registry-errors` one. The "unreachable endpoint" control still passes, because that case has
no report to misread. Had the controls stopped at the obvious case, the regression would have been
invisible.

**A freshness limit, stated because it is one.** pnpm offers no way to force revalidation on the audit
subcommand (measured), so this gate is a reading of the advisory database *as pnpm queries it*, not a
guarantee that an advisory published a minute ago is already in the answer. It is not a
pass-without-check — measurement 3 forecloses that — and it is the one property the vendored-database
alternative would improve on.

**Worst case is bounded** at roughly six and a half minutes, where a black-holed endpoint previously
held the job open indefinitely.

**The check gets slower by the controls' run time**, which is milliseconds and touches no network.

[`14-threat-model.md`](../14-threat-model.md) §6 carries the semantics next to `npm audit`, so the
control and its limit are read together rather than in a journal entry.

## Alternatives

**A cached or vendored advisory database.** Available, honest, and the strongest candidate — it is the
only alternative that keeps the gate green *with* a reading during an npm outage. It loses on what it
adds: a second supply-chain artifact inside the thing that checks supply chains. Its freshness gate is
itself network-dependent, so *unreachable* reappears one level down with an extra step; the matcher
from lockfile to OSV records has to be correct, and a matcher that is subtly wrong — a version range
compared lexically, a transitive dependency not walked — passes when it has not checked, which is the
forbidden gate wearing a different hat; and its refresh becomes a workflow that fails quietly, which
is the shape this repository has already met twice — a required-check list that claimed a check it did
not have ([W14](../50-journal/W14-2026-09-18-settings-followup.md)), and a deny-list that stopped
covering the identifiers it exists for once the task tool changed its id format
([FUP-2026-09-22](../50-journal/FUP-2026-09-22-todoist-api-v1.md)). Rejected **now, not for ever**: it becomes the
right answer if audits must run air-gapped, or if this endpoint's unavailability stops being rare
enough to call rare. That is a supersession, not a patch.

**Distinguish unreachable from vulnerable so that only the latter is required.** The most attractive
one on the page, and it cannot be built in branch protection as stated. A required check is a *name*
that has to report a conclusion, and the vocabulary for "not applicable" is a skipped job or an absent
context — neither of which a reviewer reads as *unchecked*, so the alternative resolves to one of two
things: the required check passes on an outage (which is the forbidden gate) or it stops being the
required check (which is the same thing by another route, with the added cost that a real finding then
no longer blocks). GitHub's own guidance is at least explicit about the nearest documented case: a
workflow skipped by a path filter leaves its checks `Pending` and "a pull request that requires those
checks to be successful will be blocked from merging" — the outage blocks anyway, now with no state
recorded at all.

**`--ignore-registry-errors`, one flag, no code.** Rejected, and measured rather than argued
(measurement 2): it produces a green whose content is indistinguishable from a real clean audit. It is
the forbidden gate, and its help text invites exactly this reading.

**Retry alone, without classification.** Reduces how often the outage happens and leaves the reading
broken, so a reviewer is still deciding between a CVE and an npm outage from the same red. It also
compounds the hang it does not know about: three attempts at an unbounded endpoint is three hangs.

**Run the audit only when the lockfile changed** — a `paths:` filter, or a condition on the diff.
Rejected for the reason in the previous alternative plus one of its own: advisories are published
against dependencies that were already there, so the branch that changes nothing is precisely the one
an audit of the *lockfile* should still cover. A check that runs only when a dependency moves audits
the diff, not the tree. It also makes a required context absent from the rollup, which is not a green.

**Lower the level to `high`, or stop requiring the check.** Rejected: a weakening dressed as a policy
choice. §1 is why the level is `moderate` and §6 is why it is required.

**Do nothing — the state before this ADR.** Rejected. It is not neutral: it is a required gate that
fails without checking, with two failures sharing one indistinguishable red, and it blocks work on
branches that could not have caused it.

## Revisit when

- audits must run without network access, or the registry's advisory endpoint becomes unavailable
  often enough that a blocked merge stops being rare — then the cached/vendored database is the
  answer, and this ADR should be **superseded**, not quietly patched;
- pnpm grows a way to force revalidation on `pnpm audit` (the freshness limit above);
- the check is ever proposed to pass on an outage. That proposal is this decision being reversed, and
  it needs its own ADR.
