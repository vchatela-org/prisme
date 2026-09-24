# FUP · 2026-09-24 · The read path, run against the live instance

**Agent:** Claude · **Duration:** one session · **PR** this branch · **Outcome:** complete

P1's six read-only steps, run locally against the **live** document and task tools, with the live
tokens and the write freeze on. Nothing outward was written and nothing was enabled.

**No real value appears in this entry.** Not an area name, not a weight, not a count of anything the
instance holds — the numbers are in the gitignored `seed/` and in the terminal, which is where
[`apps/sync/CLAUDE.md`](../../apps/sync/CLAUDE.md) says a report belongs.

## The finding that matters most

**The deployed instance had never been configured.** Its database held the schema, the role bindings
and a fully populated adoption queue — and **no areas, no weights, no mappings, no entities, no
completions at all**. The adoption scan had run and produced candidates; nothing had been adopted,
and the thing that turns a completion into an attributed minute had never been given a single row.

That is the deployment-repository row on the register — *"a freshly deployed instance is configured
by hand-written calls and serves an empty balance chart"* — **confirmed by measurement rather than
inferred from the runbook**. It also settles how the functional phase begins: there was no
configuration to read out of the live instance, because there was none. The areas had to be authored.

## The areas were derived, not invented

The task tool's own structure already carried the instance's area vocabulary **and its 2026
weights**, as a project whose sections are named for the areas with their percentages. Those weights
sum to 100 across the areas and agree exactly with what had been recorded privately months earlier —
which is a useful thing to know: the tool was the source of truth all along, and whoever wrote the
runbook assumed a file that was never created.

So `seed/areas.json` was read off the tool. Two things in it are **not** derived and are marked as
open in the file itself: the area **keys** (a proposal — they appear in URLs and in the colour
pinning, so they are worth choosing deliberately), and the Run lane's weekly budget, which is left
unset so the screen says *no budget is declared* rather than showing an invented one.

## The mappings are a proposal, and part of it is a guess

The tool's vocabulary hands over about half the mapping for free: two projects' sections *are* the
area list, one-to-one. The rest is not derivable and is the owner's decision, so it was written as a
**proposal with its guesses named in the file**, not as a decision:

- The four sections the original capacity diagnosis singled out — the catch-all bucket that took the
  overwhelming share of one-off work while the heavily-weighted areas took almost none — have **no
  area among the eight**. Mapping them is the decision prisme exists to force, not a derivation.
- One project is a house and another carries a family name, and neither has an area. **That is
  [OQ-1](../20-decisions/OPEN.md) in the flesh**: a container whose work belongs to more than one
  area, and the model assuming exactly one.
- One location is left **deliberately unmapped** — a triage bucket is not an area — so work sitting
  unsorted stays unattributable and shows on the report as a configuration gap. Mapping it would hide
  the number that says things are piling up.

With the proposal loaded, the backfill attributed the great majority of completions in its window and
reported the remainder as unattributable, which is the shape the report is written for.

## The read path works, and three things only running found

- **The document tool is read.** The register's row said it was not read at all; the scan now returns
  counts for every bound role, and the adoption screen lists its candidates with real titles. Nothing
  about that needed a code change — it needed bindings, which the instance had, and a scan, which
  nobody had run.
- **`create: 0` on a clean instance**, with the write freeze on. [ADR-0010](../20-decisions/0010-adopt-never-creates.md)
  guard 3 is therefore answered by measurement on a real instance, not by argument.
- **The screens render area *names*, never keys** — the defect W11 and W15 each recorded, absent here
  on a real instance. Driven in a real browser with the console read back: one `favicon.ico` 404 and
  **no CSP violation**, which is the assertion the pinning work and the popup-nonce work were for.
- The backfill's document-tool line reads *"not read — the declared-duration tier is unavailable"*
  with **no reason appended**, which is the intended behaviour: nothing failed, the property name is
  simply not configured, and inventing a failure kind there would send a reader looking for a
  permission problem that does not exist. That is the diagnostic row's fix observed on real data.

## Surprises

**A committed harness does not mean a runnable one.** The seed-path commands merged in #74 were not
in the built CLI, so the first run answered with a usage line: the artefacts on disk predated the
merge, and the harness only builds when they are *missing*. A seed-path run needs a build first.

**The local database has to be reset, and forgetting is silent.** The first pass ran a **mixed
world** — the live tools read correctly, while prisme's own tables still held the harness's fixture
entities, so the report was about a life that does not exist. Nothing failed; it simply reported
plausible nonsense. Dropping and recreating the database, then migrating from scratch, is what makes
a pass mean anything.

**Restarting the harness rotates the identity provider's keypair, and an open browser session then
`401`s rather than redirecting.** The web tier treats *cookie present and invalid* differently from
*absent*, which is right, and it makes a stale tab look like a broken login. Clearing the browser's
cookies — not reloading the page — is the fix, and the session cookie is `HttpOnly`, so it has to be
cleared through the driver rather than from the page.

## What was not done

**No adoption candidate was decided.** The queue is populated and readable; working it is the owner's
step, and deciding with the mappings still a proposal would be deciding twice.

**The backfill window is narrow** — a few weeks, chosen to keep the first run short. The trend charts
say so themselves (*"only N of M periods carry any measurement"*), and a longer range is a separate,
slower run rather than a defect.

**Nothing was enabled and nothing was written outward.** `SYNC_WRITE_ENABLED` stayed false throughout,
and the pass's own line says so.
