# Open questions

What is **not** decided, and what each question blocks. Accepted decisions are in the numbered ADRs
alongside this file.

If you are blocked by one of these: say so in your journal entry and stop. Do not pick an answer and
proceed — an undocumented guess is indistinguishable from a decision until it causes a bug.

**Eight open**, and the number is written here on purpose: [`STATUS.md`](../../STATUS.md) counts it,
[`README.md`](README.md) lists the records, and a count kept in one place drifts silently — it said
seven while this file held eight, from 2026-09-20 until 2026-09-24.

Four are waiting on a **person** or on something real, and they are the four below the first
heading: OQ-1 and OQ-2 block P2, OQ-4 turns on deciding what a piece of work *is*, and OQ-10 blocks
every merge intermittently and now carries a **Proposed** answer
([ADR-0027](0027-audit-gate-fails-closed.md)) awaiting the owner's acceptance — it stays open until
that acceptance, because a Proposed record binds nobody. The other four are **deferred by choice**,
each with a trigger written as an observable fact rather than a date.

---

## Blocking a phase, a merge, or the first review

### OQ-1 · Can a project span more than one area?

**Blocks:** project rollups, capacity attribution (P2)

A large project often contains work that genuinely belongs to different areas. Forcing one area
keeps capacity accounting simple and honest; allowing several means a project's work splits across
budgets, and rollups need a rule for which area a project "counts" toward.

Current model assumes **exactly one area per project**. Revisit when a real project doesn't fit.

### OQ-2 · Work-in-progress limits

**Blocks:** `now`-set selection (P2)

A cap is needed, and it is a personal calibration rather than a derivable number. Candidate: one
`now` initiative per area, five overall. Too tight and everything queues; too loose and the cap
does nothing.

Implement it as configuration so it can be tuned without a deploy, and pick the starting value at
the first real review.

### OQ-4 · Should the homelab-style "learning by building" work be Run or an initiative?

**Blocks:** nothing structural — but it changes what the balance factor reports

Keeping infrastructure running is upkeep and belongs in Run. Learning something with a defined
outcome is a real initiative that should compete fairly. The same activity can be either, and only
intent distinguishes them.

Practical rule to try: if it has an outcome you would put in a review, it is an initiative;
otherwise it is Run.

### OQ-10 · Should a required security gate fail closed when its upstream is unreachable?

**Blocks:** no phase — but it blocks *every* merge, intermittently, whenever npm is in maintenance

`dependency audit` runs `pnpm audit --audit-level=moderate`, which asks
`registry.npmjs.org/-/npm/v1/security/advisories/bulk` at check time. When that endpoint is down the
check fails having learned nothing: it is not reporting a vulnerability, it is failing to ask. The
two states are indistinguishable in the pull request's status list, and because the check is
required, an upstream outage blocks merges on branches that change no dependency at all. This
happened to [#31](https://github.com/vchatela-org/prisme/pull/31) on 2026-09-19 and cost a full
re-run cycle once npm recovered.

Failing closed is a defensible default for a security gate — a green that means "could not check"
is worse than a red. But nobody has chosen it out loud, and the alternatives are real: a cached or
vendored advisory database, or distinguishing *unreachable* from *vulnerable* so only the latter is
required. Whichever is chosen must not become a gate that passes when it has not actually checked.

**Answered, awaiting acceptance** — [ADR-0027](0027-audit-gate-fails-closed.md), **Proposed**
2026-09-24: the gate fails closed, the three outcomes are named in the job summary so *unreachable*
is never read as *vulnerable*, `--ignore-registry-errors` is refused and controlled against, and the
negative controls run inside the existing required check so no setting needs a human. It decided the
question in the same pull request rather than leaving the gate in the state above, because the
recorded harm was live. **The question stays open until the owner accepts the ADR** — a Proposed
record binds nobody, and this file is the list of what is not decided.

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
| Who owns database backups, and does prisme need to build one? | The deployment repository, as a dump CronJob beside its other databases. prisme ships **none** — [ADR-0022](0022-backups-belong-to-the-deployment-repository.md). It was never a workstream dependency; it gates only [step 8](../13-migration.md#5-sequence), the first outward write |
| **OQ-8** · Which licence? | **MIT**, chosen at publication. See [`LICENSE`](../../LICENSE) |
