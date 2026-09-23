# P0 · 2026-09-23 · The first Dependabot wave, integrated to green

**Agent:** Claude (orchestrator) + eight `dependabot-pr` subagents, serially · **Duration:** one
session · **PR** — · **Outcome:** complete

The `/dependabot` skill's first real run. Eight open Dependabot pull requests, all integrated to
green and **read back**, one subagent at a time. Nothing merged — a human merges — and no version
tagged, because the work is not on `main` yet.

## What was done

Every pull request was processed by the contract in
[`.claude/skills/dependabot/pr-agent.md`](../../.claude/skills/dependabot/pr-agent.md): a sibling
worktree outside the checkout, `origin/main` merged in (never rebased), the lockfile regenerated,
the bump classified against the five named hazard cases, the local checks run **serially**, what was
red fixed properly, the pull request body filled in from the template, and every check read back
after the last push.

| PR | Bump | Result |
|---|---|---|
| #50 | `@types/node` 26.5.1→26.6.2, `prettier` 3.9.6→3.9.8 (dev group) | green |
| #51 | `hono` 4.13.7→4.13.8, `lucide-react` 1.46→1.47 (production group) | green |
| #52 | `eslint` 9.39.1→10.11.0 **+ `@eslint/js` 9.39.5→10.0.1** | green |
| #53 | `typescript` 5.9.3→6.0.3 **+ a tsconfig change and one asset declaration** | green |
| #46 / #48 | distroless runtime digest `ea84502`→`bf3d7b0` (api / web) | green, pair |
| #47 / #49 | builder `node:26.9-trixie-slim` (api / web) | green, pair |

All eight were then **verified by the orchestrator rather than taken on the subagents' word**: each
head SHA re-read, the rollup's non-success count recomputed (zero on all eight), the diff set
compared against what the report claimed, and the base checked current. One subagent's work came
back with a note that the safety classifier had been unavailable while reviewing it, which is why
that PR's diff was read line by line.

## Decisions taken

**The order.** npm grouped minor/patch (#50, #51) → npm single majors (#52, #53) → Docker image
bumps. Every npm branch collides with every other on `pnpm-lock.yaml`, so they belong in one
contiguous block for the human's merge sequence. The four Docker pull requests touch one Dockerfile
each and conflict with nothing.

**Some of them are one change split in two.** Dependabot opens a pull request per *directory*, so
the distroless digest arrived as #46/#48 and the builder tag as #47/#49. Each pair is one change:
merging either half alone leaves `apps/api` and `apps/web` on different builds of the same image,
which builds, boots, passes every check here, and which **nothing in CI compares**. Reported as
pairs, in the pull requests and in the final table.

**The eslint major was a half-integration.** `@eslint/js` supplies `js.configs.recommended`, and at
9.39.5 it carries the *v9* recommended set while running on a v10 engine — so the bump as Dependabot
opened it would have linted with the old rules and reported green. Moved to 10.0.1, which is the
version declaring `peer eslint: ^10.0.0`. `typescript-eslint` 8.70.0 already declares `^8.57 || ^9 ||
^10`, so it correctly did **not** move. Verified by reading the effective config
(`eslint --print-config`) rather than the version numbers.

**TypeScript 6.0 changed two defaults silently**, which is what made #53 red on five checks at once
rather than a companion that had not moved — `typescript-eslint` tolerates `<6.1.0`, checked in the
installed package rather than read off the pull request. `types` now defaults to an empty array
instead of enumerating `node_modules/@types`, so every node global and `node:*` builtin stopped
existing at compile time; and `noUncheckedSideEffectImports` now defaults to true, so the web app's
one side-effect CSS import — declared only by Next's generated and gitignored `next-env.d.ts` — had
nothing to resolve against. Fixed by naming `types: ["node"]` explicitly (deliberately **not**
`["*"]`), and by committing an asset-module declaration. **Both checks were left on**: switching
`noUncheckedSideEffectImports` back off would have hidden the next misspelled import along with this
one, which is the weakening the contract forbids.

**A digest is verified, not trusted.** The runtime bump was confirmed with
`docker buildx imagetools inspect` — `bf3d7b0` is a real OCI index whose amd64 manifest is Node
v26.9.0, major 26, so ADR-0023's builder/runtime-major invariant holds — and the built images were
probed as `images` does. The `:nonroot` tag has since moved on to Node **v26.10.0**, and that was
**deliberately not chased**: `apps/api` and `apps/web` must stay on one build, so it belongs in one
change touching both Dockerfiles, not in a Dependabot half-pair.

**The release decision: `v0.0.6`, patch field, not cut.** Patch and not minor because what `main`
gained since `v0.0.5` contains **no new ADR and no `feat:` commit** — the two signals the skill
names for a minor — only dependency moves and build-configuration change. Not cut because the
precondition is that the work is already **on `main`**, and all eight pull requests are green but
unmerged; a tag now would not contain what it names. It is recorded as **pending**, unblocked by
merging the wave.

## Surprises

**Every one of the eight branches was stale**, so the "head green and base current" skip rule
skipped nothing: seven of them sat on a base ~39 commits behind `main`, and their pre-existing green
was at a commit nobody should ship. Integrating first and judging second is not a formality — for
all eight, the first thing that mattered was the merge.

**The release check has a false positive that reads exactly like a finding.** `git log "$last..main"
--merges | grep -i dependabot` returns `main`'s merge of the `/dependabot` *skill* pull requests
(#62, #63) — skill documentation, not dependency work. Read literally it says dependency work is
waiting to be released; the actual answer this run was no. Worth knowing before a future run trusts
that grep's output without looking at what it matched.

**A tracked `ggshield` cache file** was present on one branch's base and gone from `main`, so the
merge reconciled it. Hygiene rather than a leak — already recorded in
[FUP-2026-09-23-repo-hygiene.md](FUP-2026-09-23-repo-hygiene.md) — noted here only because it made
one branch's diff briefly look wider than one line.

**A local-only red that is not a red.** Raw `eslint` in a worktree reports bogus `no-unsafe-*`
errors unless `./packages/*` and `./apps/sync` declarations are built first, the way CI does. It
cost one subagent a diagnosis. Not in the contract's section 5 — see *Follow-ups*.

## Follow-ups

**A human owns the merge.** Suggested sequence: the npm block (#50, #51, #52, #53) — they share one
`pnpm-lock.yaml`, so each merge after the first may need the lockfile regenerated — then the Docker
pairs **#46 with #48** and **#47 with #49**, each pair together. Nothing in CI would flag a lone
half.

**After the wave lands** the tag is `v0.0.6` (patch) and this run's version line becomes true; until
then it is pending.

**Once all four Docker pull requests are merged**, one change can move both images to the
`:nonroot` tag's current digest (Node v26.10.0) together. That is the safe shape for that move.

**`typescript-eslint` 8.70.0 declares TypeScript `<6.1.0`.** The next TypeScript minor (6.1) will
need its companion moved in the same pull request, or it parks.

**`types` in `tsconfig.base.json` is now an explicit list.** A future package needing another global
type package (beyond `@types/node`) must extend it rather than assume the old enumerate-everything
default.

**Proposed, not applied — `.github/dependabot.yml`:** **no `ignore:` entry is warranted by this
run.** The one thing that tempted one is the distroless digest, which produces a pair of pull
requests per tag move and must be merged together; but Dependabot's `ignore` matches dependency
*names*, not digest-vs-tag, so any entry that suppressed the noise would also suppress the runtime's
security updates. The better lever, if the pairs become a nuisance, is a **group** covering both
Docker directories so a pair arrives as one pull request — which is a config change for a human to
decide, not a dependency branch's business (and per the skill, `.github/dependabot.yml` is never
edited from one).

**For a future `/dependabot` run:** add to the contract's section 5 that lint must follow a build of
`./packages/*` and `./apps/sync`, since raw `eslint` in a fresh worktree reports errors CI does not.

**Left on the box, harmless:** a stray stopped container and network (`dep-51-postgres-1`,
`dep-51_default`) from one subagent whose cleanup ran after the permission classifier went
unavailable, and the locally built verification images.

## Specs touched

**none.** No `docs/` spec diverged from reality in this run; the two spec-shaped deltas (the lint
ordering note and the possible Docker group) are follow-ups above rather than corrections, because
neither is currently stated wrongly anywhere.
