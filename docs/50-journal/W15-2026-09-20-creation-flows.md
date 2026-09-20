# W15 · 2026-09-20 · Creation flows

**Agent:** Claude Opus 5 · **Duration:** one session · **PR** #34 · **Outcome:** complete, with one
proposed ADR blocking a third of ADR-0011

## What was done

The three shapes work arrives in — a small thing, an initiative, a large project — and the machinery
that makes creating them across three systems survivable.

**The creation ledger** (migration `0007`). `capture` and `creation_intent`. There is no transaction
spanning two SaaS APIs, so the *intention* is committed before anything outward is attempted: a
partial creation becomes a row saying what is still missing rather than an orphan nobody can find.
The idempotency key is **stored on the row** rather than derived per pass, which is the opposite of
the reconciler's rule and deliberately so — a creation is one logical write that outlives a pass, so
every retry carries the same key forever and the tool recognises the second send as the first.

**The creating writer** (`packages/connectors/src/write/create/`). Project, section, and a *loose*
task, which is a capture: no priority, no deadline, no anchor label. The absence is the
specification, as in `write/types.ts`. The command sender moved to `write/command.ts` so the key
assertion, the missing-status check and the redaction of the tool's error prose are one
implementation rather than two.

**The API.** `POST /captures`, `/captures/:id/promote`, `/initiatives/:id/page`,
`/projects/:id/structure`, `GET /creations`, `POST /creations/:id/retry`, `GET /search`. Nothing on
the surface writes outward: a request is one database transaction, so the write freeze covers these
flows for free and a creation cannot half-succeed.

**The converge pass** (`prisme-sync create --plan|--apply`, and the head of every `apply`). One step
at a time, each outcome committed before the next begins.

**The screens**, plus capture from the command palette as a dialog over whatever you were reading.

## Decisions taken

**Create versus adopt is a field, not an omission.** ADR-0011's three states are a discriminated
union with no default — `{"mode":"create"}` and `{"mode":"link","externalId":"…"}` are different
sentences, and meaning neither requires saying `{"mode":"none"}` out loud. An optional
`externalPageId` would have made *forgetting to think about a page* and *asking for one* identical
on the wire, which is how a workspace fills with the empty pages the ADR exists to prevent.

**Promotion satisfies ADR-0010 guard 2 rather than re-implementing it.** The initiative is inserted
with `external_anchor_id` already set, so the planner — which emits a create only for
`origin = created_in_prisme AND external_ref IS NULL` — is structurally unable to make a second
task. The external reference *moves* in one transaction: at no instant do two entities claim the
task, and at no instant does neither. Proved by running the **real planner** over the promoted
initiative, with a control that removes the anchor and watches the same planner emit a create.

**The anchor is not in the ledger.** A new initiative's anchor task has no intent, because the
reconciler already derives it level-triggered. Two systems deciding to make one task is how one task
becomes two. The ledger holds precisely what the planner *cannot* derive from an entity's own
fields: a page (optional, so `external_page_id IS NULL` cannot mean "wants one"), a task-tool
project and its sections, and a capture's task, which belongs to no initiative at all.

**A capture gets its own scope.** `write:capture`, not `write:initiative`. A capture is unranked and
unscored and cannot change what prisme says to work on; something that may drop a thought into the
inbox should not thereby be able to re-rank a backlog.

**Nothing is rolled back, ever.** A failed creation is abandoned with a reason. A ledger with a
rollback would be the one code path in this repository able to remove somebody's real work, and an
object prisme made and then lost track of is adopted through the queue like any other.

**[ADR-0025](../20-decisions/0025-page-creation-needs-a-role-vocabulary.md), Proposed** — see below.

## Surprises

**ADR-0011 is partly unimplementable, and the reason is three layers down.** *Create page* needs a
parent and a template; external stores are addressed by role key; there are six role keys and not
one of them is where a narrative page lives or is a template. The least-privilege table grants the
document-tool token no capability that would cover it either, and "from the template" is not a
single API operation in the tool — it is create-then-copy-blocks, so what it *means* is also
undecided. Three unknowns, none of which a workstream should settle by picking one. The intent is
recorded, the converge pass blocks it with the reason on the line, and the ADR proposes the
vocabulary. **Link existing page works today**, which is the half adoption needs anyway.

**Six defects only running found.** Four of them are nobody else's to hit again:

- **`(create)` is a route group.** The screens were served at `/capture` and `/initiative` — the
  second shadowing W08's `/initiative/[id]` — and every `/create/…` link in the tree was a 404. The
  build's route list is where this is visible, and nothing else in the repository would have said
  so. A real `create/` segment inside the group fixes it.
- **`sql.json()` fails on the client the API actually runs with.** `createDatabase` wraps postgres.js
  in Drizzle, which replaces the driver's serializers, so the draft reached the socket writer as an
  object and every capture was a 500 naming neither the column nor the statement. This is the same
  trap W04 recorded for `timestamptz`, and **the integration suite is structurally unable to catch
  it**: `openTestDatabase` builds a bare client. Every other `jsonb` write in the file was already
  explicit `JSON.stringify(…)::jsonb`; this one was the outlier.
- **A frozen deployment recorded every intent as failed.** The frozen writer refused each call — the
  structural backstop working — but letting the pass run into it climbed every attempt counter and
  filled the ledger with failures, and the next pass did it again. A correctly-configured instance
  showed "5 failed" and a red CronJob every fifteen minutes. The freeze is a **refusal**, the same
  distinction `apply` already draws, and nothing is attempted now.
- **A capture could commit with no intent behind it** — a capture that never becomes a task, with
  nothing anywhere to say so. The store was written to hold both in one transaction; the service
  split it, because the intents carry a backlink containing the capture's own id and so cannot be
  planned before the row exists. Taking a *function of the new id* rather than a list closes it.
  Two orphans in the local database were the evidence.
- **Search pre-filtered initiatives by SQL substring**, which removes exactly the near-matches the
  fuzzy matcher exists to find. `Passport renewed 2027` returned nothing at all, so the entire
  Sørensen–Dice layer was dead for the only source it was filtered on.
- **The ledger listed a project after its own sections.** They commit in one transaction, so `now()`
  is identical and a random uuid decided — on the one screen whose job is to show how far an
  *ordered* process got.

And one found while writing a test rather than by running: **a `failed` intent is not terminal**, so
re-planning after recording a failure re-offered the same row immediately. One object consumed the
whole per-pass cap in a retry loop with no backoff. A pass now records what it has attempted.

**W11 recorded a live defect as harmless.** `GET /areas?limit=200` answers **400**: `noQuery` is
`z.strictObject({})`, which *refuses* an unrecognised key rather than ignoring it. Focus, Backlog,
Inbox, Adoption and initiative detail have each been taking their area list's failure path on every
single load since W08. It hid behind the same plausible fallback W11 fixed the other half of — a
badge reading `health` instead of `Health` looks like a styling choice. Fixed in all five, and the
note that called it harmless is corrected where it was written.

**The four estimate selectors were invisible to a sighted reader.** `FibonacciSelect` renders its
`label` to assistive technology and nothing on screen, so four of them stacked are four identical
rows of `1 2 3 5 8 13`. Found by looking at a screenshot of the built page; no check in the
repository can see it. They carry visible labels and distinguishing hints now, the same hints
`components/estimate-editor.tsx` uses.

**W07's prediction about the Radix residue did not manifest, and the correction matters.** The entry
said the hidden radio inputs "are hidden *by an inline style*, so under this policy they are
visible". They are not — the new-initiative screen logs **29** CSP violations, the most of any
surface in the product, and renders correctly. So the cost is console noise rather than stray
controls. Still W07's to decide; this screen is now the strongest argument for deciding it.

**The harness was rebuilt for the sixth time** — though for once, the fifth build had survived on
disk from W13 this morning, which saved most of the cost. Two notes to add to the five already
recorded:

- **A header-injecting proxy adds a third origin.** The browser cannot set the assertion header and
  there is no development bypass, so the assertion is injected by a proxy — and then
  `PRISME_BASE_URL` must be the *proxy's* origin on **both** tiers, or W14's check refuses every
  server action with a 403 that reads like a bug. Preserve `host`, per W10's note.
- **Running the integration suite truncates the development database.** It is the same database, and
  a drive session interleaved with a test run loses whatever was on screen. Obvious in hindsight and
  confusing twice.

## Follow-ups

- **[ADR-0025](../20-decisions/0025-page-creation-needs-a-role-vocabulary.md) needs a human.** Until
  it is accepted, *Create page* records an intention nothing can satisfy. The screens say so at the
  moment of choosing rather than leaving it to be discovered. Owner: a human, with W03.
- **`fixtures/` carries no `area_mapping` rows** and `seedFixtures` loads none, so a capture cannot
  be filed from a plain seed — the flow refuses with "this area is mapped nowhere", correctly, and
  the fixture set cannot exercise the happy path. The integration suite seeds one itself rather than
  changing a shared fixture five other suites read. Owner: W03 or W00. This is the same shape as
  W11's finding about the missing task mirror.
- **The integration harness builds a bare postgres client; the API builds a Drizzle-wrapped one.**
  Two bugs have now been found that are invisible to the suite for exactly this reason — W04's
  `timestamptz` and this workstream's `jsonb`. Making `openTestDatabase` use `createDatabase` would
  close a class rather than an instance. Owner: W00.
- **There is no configurable base URL for either external tool.** Driving the write path locally
  needs the built constant patched by hand. A `TASKTOOL_BASE_URL` read by `@prisme/config` would
  make the whole outward path drivable against a stub. Owner: W03.
- **Radix's inline styles, at their worst on the new-initiative screen.** 29 violations. Unchanged
  as a decision; changed as evidence. Owner: W07 with W14.
- **The harness is still nobody's**, for the sixth session. Two notes added, seven now.

## Specs touched

- **[ADR-0025](../20-decisions/0025-page-creation-needs-a-role-vocabulary.md)** raised as
  **Proposed**, and listed in the decisions index. It does not contradict ADR-0011; it says what
  ADR-0011 needs in order to be implementable, and proposes it.
- `apps/web/src/lib/contracts.ts`'s note about `/areas` corrected where it was written, since it
  described a live 400 as harmless.
