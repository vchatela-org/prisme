# FUP · 2026-09-21 · Area colour stops colliding

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes the defect W09 recorded as *"the most visible thing left"* and W10 and W11 both confirmed:
*"`AreaColorProvider` exists in `packages/ui` and nothing outside the gallery mounts it, because the
map is meant to come from instance configuration and nothing loads one. Needs a configuration key
and one mount in the shell."*

## What was done

- **`AREA_COLOR_PINS`** in `@prisme/config` — area key → palette slot, as JSON. Optional, defaults
  to `{}`, read by the web tier only. A slot outside `1`–`8` is a boot failure naming the key.
- **The root layout mounts `AreaColorProvider`** with it. One mount, outside every route group, so
  the gallery's own fixture map still wins inside `(gallery)` and every other screen gets the
  instance's.
- **`apps/web/src/lib/runtime.ts`** — the web tier's lazy configuration read, extracted from
  `api.ts` because two things now need it and a second `loadConfig` call would be a second cache.
  `apps/web/src/lib/area-pins.ts` is the one place the narrowing from plain numbers to the design
  system's slot union happens, next to the schema that makes it true.
- **Tests**: the config schema's parsing and its five refusals; and a component test in
  `packages/ui` that renders the provider and asserts the wiring — including the collision itself,
  asserted rather than assumed.

## Decisions taken

**The pinning is configuration, not a fixture.** Area keys are instance data and this repository is
public, so an instance's map can only arrive from its own environment. `fixtures.ts` keeps its
invented map for the gallery.

**A bad slot stops the boot.** The palette's ceiling is eight and it is fixed — a ninth hue is
indistinguishable from an existing one under colour-vision deficiency. A value the palette cannot
paint would otherwise be discovered on a chart, by a reader, as a missing swatch, so the schema
refuses it and names the key.

**The schema, not the design system, owns the validation.** `@prisme/config` types the map as plain
numbers rather than importing `SeriesSlot`: a configuration package that depends on the UI package
is the wrong direction. The narrowing happens once in `apps/web`, beside a comment naming the schema
it rests on, and the schema's own test asserts the range.

**The mount is in the root layout, not in `AppFrame`.** `AppFrame` is a client component and cannot
read server configuration; the root layout already reads a cookie server-side for the theme, so the
pinning joins it there.

## Verified by running

Built, migrated, seeded from `fixtures/`, and driven through the local harness — the same shape W08,
W09, W10, W11 and W15 each built and threw away (it is on disk, gitignored, and nobody owns it).

**The control run reproduces the defect exactly.** With no pinning configured, `/areas` renders:

```
Relationships  slot 1     Craft      slot 2     Run      lane
Health         slot 8     Home       slot 7     Signals  lane
Money          slot 8     Community  slot 7
```

Two collisions, on one screen — the birthday problem, not a bad hash.

**With `AREA_COLOR_PINS` set**, all six areas take distinct slots and the lanes keep the lane grey.
Then two more runs, because "it works when configured" is not the same claim:

- A **degenerate map** putting every area on slot 7 paints all six areas slot 7 — so the instance's
  map is what is applied, not some coincidence of the hash.
- **`/gallery` with that same degenerate map still shows slots 1–6** — the fixture map, from its own
  inner provider. The gallery is unaffected by an instance's configuration, which is what a
  reviewer would want to check and could not have inferred.
- A bad slot (`{"health":9}`) **stops the web process**, and the message names the variable and the
  key and nothing else.

## Surprises

**The boot message repeated the variable name.** `ConfigError` renders `- <VARIABLE>: <message>`, and
the new messages opened with the variable again, so the line read
`AREA_COLOR_PINS: AREA_COLOR_PINS: the slot pinned to …`. Caught by reading the output of the
boot-failure run rather than by any check. All four messages now read as the continuation of the
prefix, which is the convention `parseOne`'s other messages already followed.

**A stale harness from a previous session answered the first requests.** The run appeared to fail —
every route `404` — and the cause was an older `harness.local.mjs` still holding port 9099, so the
new harness died of `EADDRINUSE` and the requests went somewhere else entirely. Worth recording
because it presents as "the fix is broken": the journal's own follow-up about the harness being
rebuilt and discarded six times now has a seventh note, and this one is that a discarded harness
that is still **running** is a worse failure mode than no harness.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The committed fixture harness | Seventh session to need it. It is on disk, gitignored, and stale copies keep running | a later follow-up |
| `AREA_COLOR_PINS` must be set by hand for a real instance | Nothing generates it, and an instance that does not set it keeps the collision. `areaColorCollisions` in `packages/ui` reports the clash; a `prisme-sync` subcommand could propose a map from the area list | a later follow-up |

## Checks

Locally before pushing:

| Check | Result |
|---|---|
| `npx vitest run` (both test database URLs set) | 1 944 passed, 111 files |
| `tsc -b` and `tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `eslint packages/config/src packages/ui/src apps/web/src` | clean |
| `prettier --check .` | clean |
| `pnpm build` | all packages and three apps |
| `./scripts/privacy-scan.sh` | clean, 43 patterns |
| Driven in the browser harness | control, pinned, degenerate-map and gallery-precedence runs, above |

## Privacy

Fixture and invented data only. The pinning map used in the verification runs is the invented one
from `apps/web/src/fixtures.ts` — six invented area keys. No real area key, weight or workspace
identifier appears in this entry, in the diff, or in `.env.example`, whose example uses the invented
keys. The deny-list and secret scans are green.

## Specs touched

[`docs/15-runtime.md`](../15-runtime.md) §2 gained the variable, because that table is the
configuration contract and a variable absent from it is a variable the next person will re-invent.
[`.env.example`](../../.env.example) documents it beside the others.
