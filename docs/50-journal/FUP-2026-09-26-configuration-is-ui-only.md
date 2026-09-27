# FUP · 2026-09-26 · Instance configuration has one way in: the UI and the API

**Agent:** Claude · **Duration:** one session · **PR** [#102](https://github.com/vchatela-org/prisme/pull/102) · **Outcome:** complete

Settings → Areas, the Year Review and Settings → Notion now cover every table the seed path wrote:
areas, year weights, area mappings, role bindings and area colours. The owner decided the
file-and-command path and the environment's colour map should go, so the UI and the API behind it are the only way configuration enters an instance.

---

## What was removed

- `prisme-sync areas --from <path> [--force]` and `prisme-sync bindings --from <path>`, with their
  argument parser (`seed-cli.ts`) and the loaders in `apps/sync/src/areas.ts` and the parsing and
  writing half of `apps/sync/src/bindings.ts`.
- `pnpm seed:load`, at the root and in `apps/sync`.
- `seed.example/`, the documented import format, and `fixtures/bindings.json`, which existed only
  as the loader's test fixture.

- `AREA_COLOR_PINS`, the web tier's area → palette slot map rendered from Vault. A colour chosen in
  Settings → Areas already won over it; now it is the only source, and an area with none takes its
  key hash. The Areas screen's notice keeps naming clashing areas and linking each to its settings
  page, and drops the generated line to paste into the deployment, with the proposal module that
  built it. The config loader ignores variables it does not know, so a value still present in the
  deployment's secret store is inert rather than a boot failure.

`apps/sync/src/bindings.ts` keeps `readBindings`: the passes still read the table, they just no
longer write it. Its integration suite now inserts rows directly and asserts the same chain —
table, `RoleBindings`, an addressable document-tool client — without a loader in between.

## What changed wording, and why it matters

The creation plan's block reason for an unbound page role named the removed command. It now names
**Settings → Notion**, because a reason that points at something that does not exist is not one.
The same for the "not read" commentary in `unread.ts` and the doc tool's role-key module.

`docs/15-runtime.md` §2, `docs/13-migration.md` step 1, `docs/17-privacy.md` §1 and §2.1 and the
user guide's FAQ now describe the one path. `seed/` stays gitignored — it still holds local,
never-committed working files — but nothing loads from it.

## What was deliberately not done

- **Accepted ADRs and applied migrations are untouched.** ADR-0025 and ADR-0028 name
  `prisme-sync bindings --from` as the fix for an unbound role, and migration `0008_bindings.sql`
  comments that the table is loaded from the seed path. Both are dated records; the decisions they
  hold (the role vocabulary) are unchanged, only the means of binding moved.
- **Vault stays for secrets.** `PRISME_ENV_FILE` still carries credentials and deployment settings;
  the colour map was the only instance configuration in it.
- **Migration `0011`'s column comment** still mentions the pin map as the fallback. It is an applied
  migration; a comment-only migration was not worth one.
- **Deployment side:** an instance that pinned colours in the environment must choose them in
  Settings → Areas after upgrading, or those areas fall back to their hash. The deployment
  repository's runbook carries the step.
- **Journal entries are append-only**, so four older entries keep their text; their links to the
  deleted files were turned into plain text, because the doc-link gate refuses a dead target.
- **Rituals** were never on the seed path and still are not; `/rituals` is their screen.
