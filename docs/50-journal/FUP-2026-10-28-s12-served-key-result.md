# FUP · 2026-10-28 · S12: the refill and the Backlog say which key result work serves

**Agent:** Claude · **Duration:** one run · **PR:** _pending_ · **Outcome:** each Backlog row and each
candidate in the weekly refill names the key result it serves, or says it serves none. S12 is closed.

## What was found first

The link from an initiative to a key result is `key_result.served_by`, set on the objective's page,
and the only surface that read it the other way round was the monthly *find orphans* step. The
objectives list already carries every key result's `servedBy`, so no API change was needed.

## What was done

- `servedKeyResults(objectives)` and `servesLine(served)` in `apps/web/src/lib/objectives-view.ts`
  (+ tests): initiative id → the key results of **open** objectives naming it, as a plain object so
  it can cross into the client table.
- The Backlog fetches the objectives beside the backlog and shows the line under each title.
- The weekly *Refill free now slots* step does the same beside each candidate.

## Decisions taken

- **Open objectives only.** A met, missed or dropped objective is not served by next week's work.
- **"Serves no key result" is said, not implied** — and only when the objectives were read; a failed
  read leaves the line out instead of claiming *none*.
- **Read-only here.** Linking stays on the key result's *Served by*, where the other links of that
  key result are visible; a picker on every row would make the link a side effect of browsing.

## Checks run locally

Node 24.21.0: `apps/web` typecheck, `objectives-view.test.ts` (43), the whole `unit` project, eslint
and prettier on the changed files, the privacy scan with the local supplement.

## Not done

- Focus's own cards do not show it; the refill is where the choice is made.

## Specs touched

- `docs/18-user-guide.md` (Backlog), `docs/19-how-it-works.md` §7 (weekly refill) and S12.
