# Open questions

What is **not** decided, and what each question blocks. Accepted decisions are in the numbered ADRs
alongside this file.

If you are blocked by one of these: say so in your journal entry and stop. Do not pick an answer and
proceed — an undocumented guess is indistinguishable from a decision until it causes a bug.

**Five open**, and the number is written here on purpose: [`STATUS.md`](../../STATUS.md) counts it,
[`README.md`](README.md) lists the records, and a count kept in one place drifts silently — it said
seven while this file held eight, from 2026-09-20 until 2026-09-24. OQ-10 was the eighth, and it
closed on 2026-09-24 ([ADR-0027](0027-audit-gate-fails-closed.md)) — accepted by the owner, which is
what moved the number rather than what made the gate work. **OQ-1 and OQ-4 closed on 2026-09-25**,
the owner deciding both on the evidence the read path produced against the live instance.

One is waiting on a **person** or on something real, and it is the one below the first heading:
OQ-2 blocks P2, and it is a calibration to take at the first real review rather than a rule to
derive. The other four are **deferred by choice**, each with a trigger written as an observable fact
rather than a date.

---

## Blocking a phase or the first review

### OQ-2 · Work-in-progress limits

**Blocks:** `now`-set selection (P2)

A cap is needed, and it is a personal calibration rather than a derivable number. Candidate: one
`now` initiative per area, five overall. Too tight and everything queues; too loose and the cap
does nothing.

Implement it as configuration so it can be tuned without a deploy, and pick the starting value at
the first real review.

---

## Deferred by choice

Each of these is a real question that should **not** be answered yet, and the point of writing the
trigger down is that "not yet" has an end that can be recognised rather than re-argued. None is
waiting on effort or on a workstream: each is waiting on evidence that does not exist yet, and the
evidence is named. Until its trigger fires, a proposal to implement one should be answered with this
section rather than with a design.

### OQ-3 · How much to restructure the external tools

**Blocks:** nothing — deliberately deferred

The area-mapping table means prisme works against the existing structure of both tools. Aligning
them to one area list would be cleaner and removes a class of mapping confusion, but it is manual
work that pays off only after the model is proven.

**Decision: defer.** Filing it under *Blocking future phases* was itself wrong — its own line said
`Blocks: nothing` — and it has moved here, where the rest of the deliberately deferred questions are.

**Trigger:** a month of real use **has elapsed**, *and* at least one wrong attribution is traceable
to an area mapping rather than to the work itself — a `conflict` row, or a manual re-map in
`entity_link` — recorded in a journal entry. The evidence is a count of friction incidents, not an
impression that the two structures differ; they differ today, which is why there is a mapping table.

### OQ-5 · Calendar integration for ritual blocks

Habits need a slot in a day, not a place in a backlog. A calendar integration would let prisme
verify a ritual was actually scheduled, not merely intended.

**Trigger:** P8 has landed **and** adherence exists as a series — at least four consecutive weeks of
`ritual_adherence` for the same ritual — so the question "was it scheduled, and did it happen" has
something to be asked *about*. Before that, a calendar write would be a guess about a ritual nobody
has measured yet. (This is what "deferred until Rituals have adherence data worth acting on" means,
made checkable: data, and enough of it to have a shape.)

### OQ-6 · Which scoring method to add second

Candidates and trade-offs are in [`12-scoring.md`](../12-scoring.md#7-candidate-methods). The
interesting one is a "revealed preference" method run in **shadow** — the gap between stated values
and demonstrated choices is itself a review finding.

**Trigger:** a review has produced a ranking the owner **contests**, and WSJF's inputs cannot explain
the disagreement — the signal that a second method would say something rather than restate the
first — *or* a full quarter of stored decisions exists, which is what a shadow run needs to compare
against anything. Not a calendar date, and not "when it seems interesting": the plugin architecture
exists precisely so this can wait, and a method added early changes stored scores for a year whose
weights have not been reviewed yet.

### OQ-7 · Should prisme write observed duration back to process pages?

The document tool owns process pages outright (ADR-0016) and prisme writes nothing there. The one
genuinely useful contribution prisme could make is *observed* duration from completion history
alongside the declared estimate — information neither tool has today.

It is a single opt-in property write, not a reason to take ownership.

**Trigger:** at least three months of `completion_history` cover one process page's own work, so the
observed duration distribution exists beside a declared estimate that page already carries. The
value being added is the *divergence* between the two, and one measurement is not a divergence.
Until then there is nothing to write that the document tool is not already able to read.

---

## Recently closed

| Question | Resolution |
|---|---|
| **OQ-1** · Can a project span more than one area? | **No — one area per project, and multi-area work is mapped by section.** `area_mapping` already refines a project with a section, so a project whose work genuinely spans areas maps its **sections**; the project row keeps the one area it is *about*. A container with no single natural area is folded into the best-fitting existing area, so the vocabulary stays at eight and the year's weights are untouched. Decided by the owner 2026-09-25, on the read path's own evidence — the two blocks with no home among the eight areas were OQ-1 in the flesh — [ADR-0029](0029-one-area-per-project.md). Closes the attribution half of P2; project *rollups* remain P2's design work |
| **OQ-4** · Is the homelab-style "learning by building" work Run or an initiative? | **Decided by the rule already written: if it has an outcome you would put in a review, it is an initiative; otherwise it is Run.** Decided by the owner 2026-09-25, so the balance factor reports the same way from the first pass instead of being reinterpreted after the fact. No model change — intent is what separates an initiative from upkeep, which the model already says ([ADR-0014](0014-lanes-outside-the-backlog.md)) |
| Where does the prioritization model live? | prisme — [ADR-0001](0001-prisme-owns-the-model.md) |
| Which stack? | TypeScript monorepo — [ADR-0002](0002-typescript-monorepo.md) |
| How do `due` and `deadline` both feed prioritization? | They don't. Deadlines prioritize, dates plan — [ADR-0003](0003-deadline-prioritizes-due-plans.md) |
| Is WSJF the scoring model? | It is the first one. Methods are plugins — [ADR-0006](0006-pluggable-scoring.md) |
| Do area weights change over time? | Yearly, fixed within a year — [ADR-0007](0007-year-scoped-weights.md) |
| Does an initiative need a page in the document tool? | Optional, on demand — [ADR-0011](0011-optional-narrative-page.md) |
| Are key results tasks? | First-class, with anchors — [ADR-0012](0012-key-results-first-class.md) |
| Is objective progress computed? | Self-assessed; computed shown beside it — [ADR-0013](0013-self-assessed-progress.md) |
| Who owns process pages? | The document tool, outright — [ADR-0016](0016-document-tool-owns-processes.md) |
| Public or private repository? | Public, with an impersonal content rule — [ADR-0017](0017-public-repository.md) |
| **OQ-9** · Forward-auth or OIDC in the application? | **OIDC in the application**, with the ID token **verified** rather than any identity header trusted — [ADR-0026](0026-human-auth-via-oidc.md), which supersedes [ADR-0021](0021-verified-forward-auth-assertion.md) on the point that decided it: the forward-auth arrangement needs an asymmetric signing keypair the target provider cannot durably hold. W14 is unblocked |
| **OQ-10** · Should a required security gate fail closed when its upstream is unreachable? | **Yes, fail closed, and say which failure it is** — [ADR-0027](0027-audit-gate-fails-closed.md), **accepted by the owner 2026-09-24**. The gate reports three outcomes where it reported two (`checked-clean` / `vulnerable` / `unchecked`), so an npm outage is never read as a CVE, and `--ignore-registry-errors` — which reports an unreachable registry as a clean audit at exit 0 — is refused and controlled against. It landed Proposed and implemented, because the recorded harm was live |
| Who owns database backups, and does prisme need to build one? | The deployment repository, as a dump CronJob beside its other databases. prisme ships **none** — [ADR-0022](0022-backups-belong-to-the-deployment-repository.md). It was never a workstream dependency; it gates only [step 8](../13-migration.md#5-sequence), the first outward write |
| **OQ-8** · Which licence? | **MIT**, chosen at publication. See [`LICENSE`](../../LICENSE) |
