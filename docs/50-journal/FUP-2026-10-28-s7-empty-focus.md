# FUP · 2026-10-28 · S7: an empty Focus says why, and points at the Inbox

**Agent:** Claude · **Duration:** one run · **PR:** _pending_ · **Outcome:** when nothing is in flight,
suggested or queued, Focus names the Inbox count, says why that leaves it empty, and links there.
S7 is closed.

## What was found first

Focus had an empty state per section — *Nothing is in flight* sending you to the backlog, *The queue
is empty* with a *Triage the inbox* button lower down — but nothing at the top said that the whole
screen was empty for one reason. On a freshly adopted instance everything is `inbox`, only `next`
and `later` are candidates, and the backlog the first state pointed at holds nothing ranked either.

## What was done

- `emptyFocusPointer` in `apps/web/src/lib/focus-view.ts` (+ tests): `null` while anything is in
  flight, suggested or queued, or when the Inbox could not be read; otherwise the Inbox count and a
  link to it, or — with an empty Inbox — a pointer to Adoption.
- Focus reads `GET /inbox` beside its other three requests and shows the pointer as the first card.

## Decisions taken

- **The Inbox's own count**, initiatives plus action takeaways, so the number on Focus is the
  number on the Inbox.
- **Silent when the Inbox cannot be read.** A pointer built on a failed read would claim *0 items*,
  which is the wrong instruction.
- **A card above the sections, not a fourth empty state.** The section states stay true; the card
  is the one sentence that explains all three.

## Checks run locally

Node 24.21.0: `apps/web` typecheck, `focus-view.test.ts` (23), the whole `unit` project, eslint and
prettier on the changed files, the privacy scan with the local supplement.

## Not done

- No count of *unestimated* work on Focus: the Inbox row itself says it (S5).

## Specs touched

- `docs/18-user-guide.md` §3 (Focus), `docs/19-how-it-works.md` S7.
