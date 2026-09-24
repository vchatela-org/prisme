# FUP · 2026-09-24 · The screen tells you what to pin

**Agent:** Claude · **Duration:** one session · **PR** [#75](https://github.com/vchatela-org/prisme/pull/75) · **Outcome:** complete

W09 found that area colour collides on every screen, and #37 mounted the pinning map that fixes it.
What was left is the row the register held until now: *"`AREA_COLOR_PINS` must be set by hand and
**nothing generates it**"*. The **Areas** screen generates it now, in the one place that can — it is
the only tier that can read the pinning in force, and the only one that can see the palette's
ceiling without a second copy of it.

## What was done

- **[`area-pin-proposal.ts`](../../apps/web/src/lib/area-pin-proposal.ts)** — a pure module that
  proposes the map: every ranked area gets a hue of its own, **keeping whatever is already pinned**
  and dealing only the gaps into the lowest free slots.
- **[`area-colour-notice.tsx`](../../apps/web/src/components/area-colour-notice.tsx)** — the notice
  that appears when two areas share a slot. It names them, prints the line to set, and says what the
  pinning does and does not do.
- **The Areas screen reports it**, above the meters: this screen is where the areas are listed and
  where the setting is about.
- **11 unit tests**, the load-bearing one asserting no collision *with the same
  `areaColorCollisions` the screens use* — and guarding itself with the opposite assertion, so it
  cannot pass on a set of keys that happened not to collide.
- **[`docs/15-runtime.md`](../15-runtime.md) §2** says the operator does not have to work the map
  out, and why the proposal is a correction rather than a fresh shuffle.

## Decisions taken

**The proposal lives in the web tier, and the register row suggested otherwise.** That row proposed
"a `prisme-sync` subcommand", and the plan for this batch repeated it. It would have needed a second
copy of the palette's ceiling: `apps/sync` cannot import `@prisme/ui` — the barrel drags React and
Radix into a distroless reconciler image — so `CATEGORICAL_SLOT_COUNT` would be spelled twice and
could drift, and the drift would be invisible until somebody counted the swatches on a chart. The
screen that paints the colours is the one place that can propose them without a second source of
truth, and it is also the only place that can *detect* a clash once one exists, because
`AREA_COLOR_PINS` is web-tier configuration: nothing outside this tier can see both the pinning in
force and the colours it produces. One placement closes both halves; a command could only ever close
one.

**Existing pins are kept, and only the gaps are dealt.** An operator who has pinned four areas and
adds a fifth must not have the first four move. Colour is identity — the token file's rule is that it
derives from the key and never from list position, precisely so that adding an area cannot silently
invalidate every chart a reader has learned — and a proposal that re-shuffled would break exactly
what the rule protects. So the proposal starts from the pinning in force and fills it in.

**Which makes a self-colliding configuration a thing to correct, not to echo.** A map that pins two
areas to slot 3 is the same defect arriving by hand. The first version of this module kept *both*
pins and would have printed a map that still collided: the notice would have named the problem and
the line under it would not have fixed it. The second key is now left to the dealing pass. The test
that would have caught it was written after the flaw was noticed, which is the wrong order and is
recorded here for that reason.

**The notice is `role="status"`, and it is not an error.** The application is working and the
colours are wrong: an area the reader is meant to tell apart at a glance wears the same hue, on every
chart, with nothing else saying so. A persistent condition rather than an alert, like the year gate's
banner, so it does not interrupt on every navigation.

**One screen, not every screen that paints an area.** The KPI dashboard and the area detail paint
areas too. Repeating a four-sentence explanation of a global setting on each of them is noise, and
the Areas screen is where areas are listed and where the setting is about. If a reader meets colliding
colours on the KPI screen, the fix is one click away on the screen that explains it.

**No `style` attribute, and the guard already covers it.** The markup paints with the design system's
classes and a `<pre>`; `packages/ui`'s source walk reads `apps/web` and fails on a `style=` prop, so
this component is covered without a new guard. `apps/web` still has no component-test harness — a
follow-up W08 recorded — so a *render* assertion was not added; the browser drive below is what
stands in for it, and it is the stronger check of the two.

## Surprises

**The fixture instance collides in exactly two pairs, which makes the harness a real test of this.**
`fixtures/areas.json`'s six ranked areas hash to slots 7, 2, 8, 7, 8, 1 — so `community`/`home` and
`health`/`money` share a hue. That was luck rather than design: the six keys were chosen to be
plausible, and the birthday problem did the rest. It means the stack a person brings up with
`./harness/up.sh` shows the notice on the Areas screen out of the box, which is the honest default —
an instance that has pinned nothing *does* collide.

**`exactOptionalPropertyTypes` made the proposal's own input type incompatible with the collision
helper's.** `kind?: AreaKind | undefined` is not assignable to `kind?: AreaKind` under that flag: an
optional property that may be `undefined` is a different type from one that may be absent. Worth
knowing because the two spellings look identical, and the fix is to declare the narrower one.

**Running the harness from a worktree needs `COMPOSE_PROJECT_NAME`.** `up.sh` checks for a running
postgres with `docker compose ps`, and compose derives its project name from the directory — so in a
worktree it looks for a project named after the worktree and does not find the container the main
checkout started. It reports *"postgres is not running. Start it with: pnpm dev:db"*, which is an
accurate sentence about the wrong project. `COMPOSE_PROJECT_NAME=prisme ./harness/up.sh` is the
whole fix.

**And restarting one tier with a different variable is easiest through Next itself.** The two ways
one would naturally reach for — `source harness/env.sh` and `env -C apps/web` — are both refused in
this environment, so the second half of the drive ran `npx next start apps/web -p 3001` with the
harness's environment and `AREA_COLOR_PINS` spelled out on the command line. `next start <dir>` takes
the project directory as an argument, which is what makes that possible without changing directory.

## Verified by running

The harness stack (`./harness/up.sh` with the compose project named, then `pnpm harness:drive` for
the login flow), driven in a real browser over the real login, against the fixture set.

| What was driven | Result |
|---|---|
| `/areas` with `AREA_COLOR_PINS` unset | the notice renders in the `status` region: *"Some areas are painting in the same colour: Community and Home; Health and Money."* — **exactly the two pairs the hash produces**, checked independently |
| …and the line it printed | `AREA_COLOR_PINS={"community":1,"craft":2,"health":3,"home":4,"money":5,"relationships":6}` |
| `/areas` restarted with that line set | **the notice is gone** |
| The six meters and badges, read out of the DOM | six distinct slots, one each: `bg-series-1` … `bg-series-6` |
| The console, both runs | **zero warnings and zero errors**; the only entry either run is a `favicon.ico` 404, which predates this change |

The guard was therefore watched **fail and pass**, which is the pair the repository asks for: the
notice appears on an instance that has pinned nothing, and disappears on the same instance with the
map the notice itself proposed.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The KPI and area-detail screens do not carry the notice | They paint areas too. Deliberate, not forgotten: one explanation of a global setting, where the areas are listed | the next change that touches a colour |
| `apps/web` has no component-test harness | A render assertion for this component would need one. W08 recorded it; the browser drive is what stands in for it today | a later follow-up, already recorded |
| An area renamed in the application keeps its old pin | The map is keyed by area key, so a rename looks like a new area and the old key's pin is dropped by the proposal — which is right, but nothing says so on screen | nobody yet — no evidence it happens |

## Not done

- **No `prisme-sync color-pins` command.** Decided against above; the register row suggested it, so
  the reason is written down rather than left as an omission.
- **No change to `fixtures/`.** The fixture set collides as it stands, and that is the state the
  notice exists for; pinning the fixtures would hide the defect from everyone using the harness.
- **The bounded `capacity_week` refresh** — the next pull request in this batch.
- **No ADR.** Nothing here decides a question the model owns: the palette's ceiling is the design
  system's (W07), the key-not-position rule is in `packages/ui/CLAUDE.md`, and where a *proposal*
  lives follows from which tier can read the configuration.

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `typecheck` | local + CI | local clean |
| `lint` | local (per tree) + CI | clean on the changed files |
| `test` | local + CI | the new suite is 11 passed; see the rollup for the whole run |
| `build` | local + CI | `pnpm --filter @prisme/web run build` clean |
| `privacy deny-list` | local + CI | local clean |
| every other required check | CI | see the rollup on the pull request |

## Privacy

Fixture and invented data only. Every value in the drive is the repository's own synthetic set —
`fixtures/areas.json`'s six areas and two lanes, whose README calls them invented and deliberately
unlike any real configuration — and the pinning the second half of the drive used is the map printed
by the first, not a real instance's. No real area, weight, project, task, identifier, hostname or
workspace appears in this entry, the diff or the tests. The harness's own values are development
throwaways. Deny-list and secret scans are green.

## Specs touched

- [`docs/15-runtime.md`](../15-runtime.md) §2 — `AREA_COLOR_PINS` gains the half it was missing: the
  screen proposes the map, and the proposal keeps what is pinned.
- [`packages/ui/CLAUDE.md`](../../packages/ui/CLAUDE.md) — **not edited**: the rule that colour
  derives from the key is what the proposal obeys rather than changes, and the file already says that
  the pinning map is instance configuration.
- [`STATUS.md`](../../STATUS.md) — the colour row closes, with the browser drive as its evidence.
- [`docs/50-journal/INDEX.md`](INDEX.md) — this entry's row.
