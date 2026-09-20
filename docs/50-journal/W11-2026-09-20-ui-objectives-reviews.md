# W11 · 2026-09-20 · Objectives, key results and the review wizard

**Agent** Claude Opus 5 · **Duration** one session · **PR** [#32](https://github.com/vchatela-org/prisme/pull/32) · **Outcome:** complete

## What was done

`/objectives`, `/objectives/[id]`, `/review`, `/review/[cadence]` and `/review/history`, with every
decision the screens make extracted into two pure modules — `objectives-view.ts` and
`review-wizard.ts` — tested without a browser.

The wizard encodes the cadence map's step *shapes* row for row, never a concrete checklist: that is
instance data, it lives in the document tool, and it would be a privacy leak here. Weekly has eight
steps, monthly and quarterly seven, yearly eight; quarterly is the monthly set over a longer window
rather than invented extra steps, which is what the map says and what the brief rules out
improvising on.

No screen computes progress, a score or a date. The objectives pages display `progressSelf` beside
`progressComputed` and never reconcile them.

## Decisions taken

**The two progress numbers are laid out as an argument.** Equal size, equal weight, no combined
figure, no bar spanning both, and no "actual" label on either. Only the left one is an input; the
computed one is text. A reader who wants to move the right-hand number has to go and close tasks,
which is the correct answer. Every applicable divergence reading is shown rather than the strongest
one — a key result can be both diverging and at risk, and picking one hides the other at exactly the
review where both matter.

**`progressComputed` absent renders as no number, never as 0%.** Absent and zero are different
facts, and painting the first as the second manufactures a divergence on every key result that has
nothing serving it yet.

**Display thresholds live in `apps/web/src/lib`, not in `packages/domain`.** "Material", "low" and
"late" decide whether a sentence appears. They change no stored value and nothing reads them back.
Putting a rendering decision in the domain package is the mistake in the other direction. They are
named constants so a reader can see they were chosen, and argue with them.

**Resume is the first unticked step, not the furthest reached.** Somebody who ticked 1, 2 and 4 and
closed the tab is returned to 3. Landing them on 5 would silently skip it and the artefact would
then claim the review covered ground it did not.

**Every tick is a read-merge-write.** `PATCH /reviews/:id` *replaces* the checklist — the column is
assigned, not patched. An action sending only the step just ticked would delete every other tick;
one sending the steps this build knows would delete an instance's own added steps and any step from
an older build. So each tick re-reads the session, merges one key into what is actually stored, and
writes the whole map back. Unrecognised keys survive and the wizard says on screen that it kept
them.

**Closing is a separate decision from ticking the last step.** Closing takes the per-area capacity
snapshot and the API never retakes it. A snapshot taken because somebody tidied up a checklist is a
snapshot of the wrong moment.

**The artefact records what was *not* covered.** A review that looked at the deadlines and found
nothing, and one that never got there, read identically a month later otherwise. That, the decisions
in the words they were made in, and the capacity snapshot are the three things nobody can
reconstruct afterwards.

**A step's surface is a link, never a redirect.** A review that sends you away loses its place,
which is the failure resumability exists to prevent. The panels read and link out; they do not
reimplement a decision another surface owns. The yearly review's allocate step links to W09's
`/review/year` rather than offering a second place to write a weight.

No new ADR. Nothing here contradicts an Accepted one.

## Surprises

**`areaListSchema` has never parsed a real response, and five other screens were already wrong.**
`GET /areas` returns `{ items }` and is not paged; the schema has demanded `total`, `limit` and
`offset` since W08. Focus, Backlog, Inbox, Adoption and initiative detail all read it, and all of
them silently fell back to the area *key* where they meant the name. It survived a year of review
because `health` instead of `Health` reads as a styling choice rather than a parse failure — and
because the failure is a fallback rather than a crash. W08's logger had been naming the three
missing fields in a log line the whole time; nobody was reading the log.

This is the same shape as the defect W09 found: a shared contract wrong since W08, invisible because
every screen degrades quietly rather than loudly.

**`fixtures/objectives.json` was loaded by nothing.** It is listed in `fixtures/README.md` and
written with coverage notes naming this workstream — a habit key result, a large divergence, an
orphan objective — and no code path had ever put it in a database. So it had drifted from the model
without anything noticing: all three statuses it carried (`in_progress`, `at_risk`, `not_started`)
were outside the CHECK constraint frozen at P0. A fixture nothing reads is a fixture that rots
silently, and this one had.

`seedFixtures` now loads objectives, key results, `servedBy` and measurements, and throws on a
fixture naming an initiative that does not exist rather than skipping the link. The statuses are
corrected, with a note in the file saying why there is deliberately no `at_risk`: risk is derived
from the two progress numbers and how much of the period is gone, not declared.

**Getting `progressComputed`'s source backwards is not academic.** It comes from the initiatives
that **serve** a key result, not from a subtree beneath the key result's own anchor — a key result's
anchor lives in `entity_external_ref` while `task_mirror.anchor_for` references an initiative. The
detail panel announced "no anchor task is linked, so nothing computes progress for this key result"
directly above a computed 70%, telling the reader the number in front of them could not exist. Only
visible with a real breakdown in the database.

**The fixture's divergence case cannot be exercised without task mirrors.** `fixtures/` carries no
task mirror — the task tool's side is recorded as connector responses — so every key result reads
`progressComputed: null` from a plain seed, and the central behaviour of this workstream is
untestable against real data. Ten task rows under the serving initiative produced the 70% the
fixture's `progressComputedHint` asks for, and the −55 point reading appeared. The hint field is
still read by nothing.

**Four smaller things only running showed:** the author form offered Run and Signals, which are
lanes and carry no objective; step prompts rendered literal Markdown backticks, because a prompt is
text and not Markdown; every badge in the wizard's panels showed the key rather than the name, so
the same area read `craft` on one screen and `Craft` two clicks away; and the key result statement
appeared twice on the detail page, one line apart.

**The harness cost most of the session, for the fifth time**, exactly as
[W10](W10-2026-09-19-ui-timeline.md) predicted. Its three notes all held. Two more to add:

- **W14's SSRF guard refuses a loopback JWKS URL.** `assertUrlAllowed` rejects a literal private or
  loopback address, so `http://127.0.0.1:9099` fails at boot with "a private or loopback address is
  refused" and the human path answers 401 forever. `http://localhost:9099` passes — the guard parses
  literal addresses, not names. The guard is right; the harness has to use a hostname.
- **Both tiers must share `PRISME_BASE_URL`.** The API builds its origin policy from its own value
  and the web tier sends its own as `Origin`. Configure them differently and *every* write is
  refused with `cross-origin state-changing request refused / reason: mismatch` — which reads like
  the CSRF bug W09 fixed rather than like a misconfiguration.

**The local database is easy to leave in a state that looks like somebody's bug**, as W10 said.
Truncating every table takes `prisme_migration` with it; excluding that one table is the fix. A
stale Docker volume from an earlier session also produced `permission denied for table
prisme_migration` on a tree where nothing had changed.

**One integration test depends on a pristine database**, which is worth knowing before it is
diagnosed as a regression. After the harness had run, W14's
`auth.integration.test.ts > keeps the kill switch across a restart` failed — and it fails on `main`
at `760b9ef` in the same state, so it is not this workstream's. Against a freshly migrated database
all 106 pass. CI creates its service fresh each run, so it is green there and has been; the
fragility only shows on a developer machine that has been driven. Recorded rather than fixed:
the test is W14's.

## Follow-ups

- **The harness is still nobody's, and this is the fifth build.** W08, W09, W10 and W12 each built
  and discarded one; this one is discarded too. The two notes above bring the total to five things
  the next person has to rediscover. It remains a local identity provider, a fixture seeder and an
  assertion header — a few hours of work, and now the largest recurring cost in this repository.
  W15 will pay it again. Owner: W00 or W07.
- **`fixtures/` has no task mirror, so `progressComputed` is null on every key result from a plain
  seed.** The divergence in ADR-0013 — the behaviour this workstream exists to surface — cannot be
  exercised without hand-seeding `task_mirror` rows. Either the fixture set should carry a task
  mirror, or `seedFixtures` should derive one from `progressComputedHint`, which today is read by
  nothing. Owner: W03 or W13.
- **`areaListSchema` is fixed, but the five screens that were wrong were not re-driven.** Focus,
  Backlog, Inbox, Adoption and initiative detail now get real area names for the first time; nobody
  has looked at them since. Worth a pass by whoever is next in `apps/web`.
- **Area colour still collides on every screen**, exactly as W09 and W10 left it: `AreaColorProvider`
  exists in `packages/ui` and nothing outside the gallery mounts it. Owner: W07 with W00.
- **The Radix toast viewport's `style` attribute reaches these screens too**, one violation per page,
  as W09 and W10 recorded. Nothing here adds a second.
- **There is no endpoint returning the task breakdown beneath a key result's anchor.** The brief asks
  for "the anchor task, its subtasks"; what the API models is the serving initiatives' breakdown, and
  that is what is drawn. Not a gap in this workstream, but the brief and the model disagree by a
  sentence.
- **Nothing pushes the narrative outward yet.** The artefact is generated and displayed; the write
  back to the document tool is W04's mechanism and is not wired to a review session.

## Specs touched

None. `docs/10-model.md`'s cadence map was implemented as written and needed no correction;
`fixtures/objectives.json` was corrected to match the model rather than the other way round.

## Privacy

Every screenshot, snapshot and value in this session came from `fixtures/` and from ten synthetic
task rows created by the harness. The harness is gitignored (`*.local.*`) and is not in this
repository; no screenshot is committed. The one decision recorded while driving the review wizard
was invented for the run and is not quoted here. No real goal, project, task, weight or workspace
identifier appears in this entry or in the diff.
