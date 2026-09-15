# 13 · Adoption and migration

An existing setup already contains years of work that does not match this model. Bringing it in
must satisfy one hard requirement:

> **Adopting existing work must never create a duplicate.** No new page, no new task, no second copy
> of anything that already exists.

This is not a "be careful" instruction. It is enforced structurally, because the failure is silent
and the blast radius is someone's real task list.

---

## 1. Ingest, don't migrate

prisme does not move or transform anything. It **reads** both tools and proposes a candidate model,
which you accept, reject or merge. Nothing is destroyed, and the external tools continue to work
untouched throughout.

```
read both tools
   └─► candidate entities, unlinked
        └─► adoption queue  ──► you decide  ──► adopt / ignore / merge
                                                    │
                                            link only, never create
```

**Write freeze is the default.** Until explicitly lifted, prisme writes nothing outward. The first
run in any environment is `plan`-only and cannot be made otherwise.

## 2. The four guards

Defence in depth, because any one of these can be defeated by a sufficiently confident bug.

### Guard 1 — Unique external references

```sql
CREATE UNIQUE INDEX ON entity_external_ref (kind, external_id);
```

An external object bound to one prisme entity cannot be bound to another. The database refuses it;
no application logic is trusted with this.

### Guard 2 — Provenance makes creation structurally impossible

Every entity carries `origin ∈ { created_in_prisme, adopted }`, immutable after insert.

> The planner emits a `create` action **only** for entities where
> `origin = 'created_in_prisme' AND external_ref IS NULL`.

An adopted entity therefore cannot produce a create — not "should not", *cannot*. This is asserted
in the planner's unit tests with an explicit adversarial case.

### Guard 3 — Labelled plans with a create threshold

Every action in a plan is tagged:

| Tag | Meaning |
|---|---|
| `create` | A new external object will be made |
| `adopt` | An existing external object will be linked. **Creates nothing** |
| `update` | An existing, already-linked object will be modified |
| `skip` | No change; shown for transparency |

`apply` **refuses** a plan whose `create` count exceeds a configured threshold without explicit
confirmation. During adoption the threshold is `0`: any create at all is a bug, and the run stops.

### Guard 4 — Seed the link table from mappings that already exist

A mature setup usually already contains a partial mapping — an external-ID column maintained by an
earlier automation, or a link in a page property. That mapping is imported first, as a migration,
before any matching heuristic runs.

This is the cheapest and most reliable source of identity available, and it shrinks the manual
queue to the genuinely ambiguous remainder.

---

## 3. Identity resolution

In order. Each step only considers items the previous one did not resolve.

| # | Rule | Confidence | Action |
|---|---|---|---|
| 1 | Existing external-ID mapping | **certain** | Auto-link |
| 2 | Exact title match, same area, both open | high | Propose, pre-selected |
| 3 | Normalised title match (case, accents, punctuation, leading numbering) | medium | Propose, not pre-selected |
| 4 | Fuzzy title similarity above threshold | low | Show as a suggestion with the score visible |
| 5 | Anything else | none | Manual |

Every decision is recorded:

```sql
entity_link (
  prisme_id, external_kind, external_id,
  match_rule,        -- which rule above
  confidence,        -- certain | high | medium | low | manual
  decided_by,        -- 'auto' | 'human'
  decided_at
)
```

**Nothing above "certain" is auto-applied.** Everything else is a proposal. An automatic fuzzy match
that is wrong produces exactly the corruption this document exists to prevent, and it does so
invisibly.

## 4. The adoption queue

Lists every external object with no prisme link. Three outcomes:

| Outcome | Effect |
|---|---|
| **Adopt** | Creates a prisme entity with `origin = adopted`, bound to the existing object |
| **Ignore** | Recorded permanently. The item never reappears |
| **Merge** | Binds an additional external reference to an existing prisme entity |

*Ignore* is what makes the queue converge. A queue that re-proposes the same 200 items every week
gets abandoned in a fortnight, and then the model quietly diverges from reality.

### What becomes what

| Found in the wild | Becomes |
|---|---|
| Parent task with subtasks, in an area's section | Initiative, anchored to that task |
| Dedicated project with sections | Project, with its sections mapped |
| Actionable takeaway | Initiative candidate — promoted, not copied |
| Principle-type takeaway | Stays a takeaway. Never enters the backlog |
| Objective or key result stored as a task | Key result, with that task as its anchor |
| Recurring task | Run lane, or a Ritual if it serves a habit goal |
| Machine-generated notification | Signals lane |
| Loose task, no structure | Stays a task. Not everything is an initiative |

That last row matters. The temptation during adoption is to promote everything; the result is a
backlog of hundreds of "initiatives" and a ranking that means nothing. Most tasks are just tasks.

## 5. Sequence

| Step | Writes anything? |
|---|---|
| 1. Configure area mappings; seed weights for the current year | prisme only |
| 2. Import the pre-existing external-ID mapping (Guard 4) | prisme only |
| 3. Full read of both tools; build the candidate set | no |
| 4. Work the adoption queue | prisme only |
| 5. Score adopted initiatives relative to each other | prisme only |
| 6. Choose the `now` set | prisme only |
| 7. `plan` — read the output by hand, confirm `create: 0` | **no** |
| 8. Lift the write freeze; `apply` | yes — first outward writes |
| 9. One week of reviews; watch the conflict ledger | yes |
| 10. Retire the superseded automations | — |

Steps 1–7 are reversible by deleting a database. Step 8 is the first irreversible one, and it is
gated on two human checks: a person has read the plan, and **a database restore has been rehearsed
at least once**.

That second one is infrastructure work, done in the GitOps deployment repository as a dump CronJob
alongside its other databases — never in this repository, which ships no backup capability at all
([ADR-0022](20-decisions/0022-backups-belong-to-the-deployment-repository.md)). It is a checklist
item with a human owner, not a code path: prisme cannot detect whether a backup exists and will not
refuse to apply for want of one. It also blocks nothing before this step — steps 1–7 write nothing
outward — so it can land at any time up to here.

Why it belongs precisely at step 8: until then the only loss is a database that can be rebuilt by
re-ingesting both tools. From step 8 the database holds the link table, the scores and the adoption
decisions that no re-ingest can reconstruct — dropping it stops being free.

## 6. Retiring the old system

Only after a week with an empty conflict ledger:

- Turn off prior sync automations — **one at a time**, watching for drift after each.
- Archive the superseded central boards. Their relations and formulas encode the model being left
  behind; leaving them live invites editing the wrong thing.
- Remove scoring properties that prisme now owns (ADR-0013).
- Prune redundant saved filters.

Keep the per-tool structures that already work. The goal is one authoritative decision layer, not a
rebuilt workspace.

## 7. Rollback

| Situation | Response |
|---|---|
| Plan looks wrong | Don't apply. `plan` is free and has no side effects |
| Applied something wrong | The event log holds before/after for every write; replay it backwards |
| Adoption mis-linked an item | Unlink in the queue. The external object is untouched — only the link is removed |
| Fundamental model error | Drop the database and re-ingest. **The external tools are unharmed**, which is the whole reason for not migrating them |

The last row is the real safety property: because prisme never moved anything, throwing prisme away
is always an option, and it costs nothing but the scoring judgements.

## 8. Testing

- **The adversarial test is mandatory**: construct an adopted entity, run the planner, assert zero
  `create` actions. Repeat for every entity kind. This test is the executable form of Guard 2, and
  it fails loudly if someone removes the provenance check as "redundant".
- Idempotence: `plan` twice over unchanged state produces an empty second plan.
- Identity resolution against fixtures covering each rule, including near-misses that must *not*
  match.
- Threshold enforcement: a plan containing a create is rejected when the threshold is `0`.
