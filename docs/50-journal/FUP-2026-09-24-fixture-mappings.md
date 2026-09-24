# FUP · 2026-09-24 · The fixture set could not attribute anything

**Agent:** Claude · **Duration:** one session · **PR** this branch · **Outcome:** complete

The register's row, two gaps in one line: *"`fixtures/` carries no `area_mapping` rows and its task
mirror covers only the initiatives that serve a key result, so attribution and computed progress are
exercised only partly by a plain seed."*

Both were real, and each had a visible symptom.

## What was done

**`fixtures/area-mappings.json`** — the locations `fixtures/connectors/task-tool.completions.json`
actually reports, mapped to fixture areas. The identifiers are taken from that file on purpose: a
mapping is only exercised if it covers somewhere a completion came from, and a fixture mapping
invented beside the fixture completions would look like coverage without being it.

One entry refines a single section of a project the file also maps, to a **different** area — which
is the precedence `attribute.ts` implements (section first, project as fallback) and the shape OQ-1
is about: a project whose work genuinely belongs to more than one area.

**`fixtures/task-mirror.json`** — subtrees for `init-005`, `init-009` and `init-013`. None of the
three serves a key result, so none had a subtree, so the initiative detail showed an empty task list
from a plain seed — and an empty task list is indistinguishable from a screen that is broken.

**Their completed work is dated outside the rolling four-week window, deliberately.** The mirror
feeds `progressComputed` *and* the capacity window, and a completion inside the window would fill a
detail screen by moving every suite's balance numbers. A suite that wants a completion in the window
seeds one — that is what `seedCompletions` is for, and its own doc comment (stale since
`task-mirror.json` landed) now says so.

## Decisions taken

**The fixture maps a location no test treats as unmapped.** This is not the same decision as "pick a
convenient area", and it is recorded because it was made *after* being caught. The first version
mapped `craft`, and `creations.integration.test.ts` has a test — *"refuses an area mapped nowhere,
naming what would fix it"* — that captures into `craft` expecting the refusal. With `craft` mapped,
the capture **succeeded**: `expected 422, received 201`. The suite's own comment predicted this
exactly:

> `fixtures/` carries no `area_mapping` rows and `seedFixtures` loads none … Recorded as a follow-up
> rather than added to the shared fixture: mappings feed the backfill's attribution too, and quietly
> changing what every suite sees is how one workstream breaks another's numbers.

W15 was right, and the cost was one assertion. The mapping moved to `money` — an area nothing treats
as unmapped — so no test's *input* changed to keep it passing: the refusal test still refuses, still
for the same reason, still on an area with no mapping. The suite's comment is updated to say the
fixture now carries mappings and that this file still seeds its own location on purpose, so a future
widening cannot silently change what it asserts.

**Changing a test to keep it green would have been the wrong repair here.** The assertion is about a
real behaviour — an area mapped nowhere must be refused by name — and it stays asserted. What moved
is the fixture, which is the thing that was newly wrong.

**The task-mirror additions are chosen for what they make reachable, not for volume.** One `now`
initiative (the Focus screen's task list), one `next`, one `dropped` — the last because an initiative
that was dropped still has the work it accumulated, and a fixture set that only ever mirrors live
initiatives leaves that unexercised.

## Verification

Full suite against a real PostgreSQL, on a database of its own rather than the shared development
one — `2139 passed`, no failures. Four files fail to load for a reason unrelated to this change:
`zod` is declared in `apps/sync/package.json` and is not installed in this worktree, so
`areas.test.ts`, `bindings.test.ts` and their two integration siblings die at import. That is a
local environment gap, not a signal.

The new assertions are in `apps/api/src/routes/integration.test.ts`: that the mapping reaches the
database with the section precedence intact, and that `init-005` — which serves no key result — now
carries the tasks it has.

## Follow-ups

None.
