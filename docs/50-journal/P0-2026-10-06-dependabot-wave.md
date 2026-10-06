# P0 · 2026-10-06 · Two more advisories turned `main` red, and #144 carries the way back

**Agent:** Claude (orchestrator, scheduled and unattended) · **Duration:** one run · **PR:** this
entry's own · **Outcome:** #144 green and unmerged. #143 and the distroless pair #141 + #142 wait on
it. `v0.15.3` is pending on #144

The shape is the one the [2026-10-01 run](P0-2026-10-01-dependabot-wave.md) met. Four new Dependabot
pull requests were already based on `main`'s tip (`a880f3a`), and every one was red on a single
check, `dependency audit`. The two Docker-only pull requests were red too, which is the tell that the
cause is `main`'s lockfile and not anything a branch introduced. `main` last read that check green
on 2026-10-01, before the two advisories below were in the audit's answer.

## The red check

`dependency audit`, at `moderate`, found two `high` advisories:

- **`sharp`** < 0.35.5, GHSA-wq5f-xc86-pv6w, which is a librsvg CVE in sharp's bundled libvips.
  `next` is its only parent, as an optional dependency asking `^0.35.4`, and 16.3.6 and 16.3.8 ask
  the same. sharp ships in the web image.
- **`source-map-js`** < 1.2.2, GHSA-68fv-2mgg-jv7q, an event-loop denial of service. Its four
  parents (`postcss`, `css-tree`, `magicast`, `@tailwindcss/node`) all ask `^1.2.1`.

Every parent's range already admits the fixed version, so **a lockfile refresh clears both, and no
`overrides` entry was added**. That is the `brace-expansion` decision of 2026-10-01. The
`pnpm-workspace.yaml` comment allows a forward pin only when a parent's range shuts the fix out, and
neither does here.

Either fix alone leaves the audit red on the other, so they travel together. They ride #144, the
production group, because it already moves `next`, the parent of one of them. #135 carried
`brace-expansion` for the same reason.

## What was done

| PR | Bump | Result | Read at | What it took |
|---|---|---|---|---|
| #144 | production-minor-patch group: `@hono/node-server` 2.1.3, `hono` 4.13.12, `lucide-react` 1.51.0, `next` 16.3.8 | green | `893c3de` | The merge of `main` was a no-op. `pnpm update -r sharp source-map-js` moved only those two and sharp's `@img/*` platform packages. Both images were built and Trivy-scanned locally, and sharp 0.35.5 was exercised inside the distroless web image |
| #143 | dev-dependencies group: `@types/node` 26.6.4, `eslint` 10.12.0, `typescript-eslint` 8.71.0 | not integrated | — | Already based on `main`'s tip and green on everything except `main`'s red. Integrating it now would only read that red again |
| #141 + #142 | distroless `nodejs26-debian13:nonroot` digest `afc6657` → `2ee7b2c` (api + web) | not integrated | — | Same as #143. **One change split in two**, so they merge as a pair |

None is parked. Nothing here waits on a human decision except the merges. The three that were not
integrated are not parked either: a later run must pick them up without `--force`, as soon as #144 is
on `main`.

**Local checks ran on Node 24**, while `.nvmrc` pins 26.8.2. That is a known limitation of this
machine, and CI ran on the pinned version. #144 moves no Node major, so it does not matter here.

## Release decision

**`v0.15.3`, patch, pending.** Since `v0.15.2`, `main` has gained no ADR in `docs/20-decisions/`
and no `feat:` commit: its only merges are two `STATUS.md` updates. So the field is patch. No
Dependabot merge is on `main`, and a tag now would contain nothing it names, so nothing was cut.

It is unblocked by **one merge: #144**. It should be cut as soon as #144 lands, without waiting for
the rest of the wave. The 2026-10-01 run cut `v0.15.1` on #135 alone for the same reason: the
version clears advisories, and sharp's is in the deployed web image. #143 and the Docker pair can
follow in a later version. The pending line is under *Releases* in `STATUS.md`, and the run that
cuts it removes the line.

## Surprises

- **Writes to GitHub returned `502 Bad Gateway`.** Two attempts to comment on #144 failed this way
  while reads kept working. The third attempt succeeded, through `gh api` and half a minute later.
  Nothing was posted twice: the comment count was read back between attempts.
- The subagent noticed that `next` pins `postcss` to exactly 8.5.23 in both 16.3.6 and 16.3.8, which
  already meets the `postcss: '>=8.5.23'` override's floor. The override may now be removable for
  `next`'s sake. It was not touched: the override covers every parent of `postcss`, and removing it
  belongs in a pull request of its own, where `dependency audit` decides.

## Follow-ups

- **Merge #144 first** (a human). Once it is on `main`, the next run cuts `v0.15.3`. That run also
  merges `main` into #143 and regenerates #143's lockfile rather than hand-merging it, and merges
  `main` into #141 and #142.
- **The `.trivyignore` waiver lapses on 2026-10-15.** `2ee7b2c`, the digest #141 and #142 move to,
  ships `libssl3t64` deb13u3, which is the fixed version. The 2026-10-01 run found that, and this run
  did not re-verify it. Its two entries can therefore be deleted
  when the pair is integrated. `images` builds and scans **both** images on every pull request, so
  deleting the entries in the first of the pair turns `images` red on the other image, which is
  still on `afc6657`. The deletion goes in whichever of the pair is integrated second, after the
  first has merged. Alternatively, it goes in a separate pull request once both have merged.
  Extending the expiry is not the way out.
- **The `postcss` override**: possibly removable, as described above. That is for its own pull
  request.
- No `ignore:` entry proposed for `.github/dependabot.yml`.
