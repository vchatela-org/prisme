# FUP · 2026-09-21 · The outward path can be pointed somewhere else

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes the follow-up W15 recorded and two later entries repeated: *"`DOCTOOL_BASE_URL` /
`TASKTOOL_BASE_URL` in `@prisme/config` — the outward path cannot be driven against a stub without
patching a constant by hand"*. The bindings entry names it as the one thing it deliberately did not
add, and calls it a separate follow-up. This is that follow-up.

It also clears two headers that had gone stale — `backfill/processes.ts` and `backfill/types.ts`
still described the document tool as unread, which the bindings pull request had already made
untrue.

## What was done

- **`DOCTOOL_BASE_URL` and `TASKTOOL_BASE_URL`** in `@prisme/config` — optional, unset by default,
  validated as absolute `http(s)` URLs when present.
- **Wired into all eight constructors that build an outward URL**: the API's in-process reconciler
  (`sync/runner.ts`) and the CronJob's CLI (`apps/sync/src/main.ts`), for both the read clients and
  the writers. The doc-tool creation writer takes a client, so it inherits the one it is handed.
- **`packages/connectors/src/base-url.test.ts`** — four tests over the seam itself. `baseUrl` had
  existed on every client since W03 with no test at all, because nothing read it; now that a
  deployment can set it, the wiring is asserted rather than assumed.
- **Two stale headers corrected** — `backfill/processes.ts`'s *"The document tool is not read
  today"* section, and `backfill/types.ts`'s *"which is every run today"*. Both were true when
  written and were invalidated by the pull request that loaded the bindings.

## Decisions taken

**No default in the configuration schema.** The vendor hostname lives in `packages/connectors`,
which is the only package that talks to either tool — and `@prisme/config` depends on nothing but
zod, so importing the constant is not available to it. Giving these variables a default *here* would
therefore mean a second copy of a hostname in a second place, which is a drift waiting to happen
rather than a convenience. Unset reaches the client as `undefined` and the client applies its own
default, so the hostname is named once. The test that asserts this is the one named *"defaults to
nothing, so the vendor hostname lives in the connectors alone"*.

This is also why the `Config` field is `string | undefined` rather than a resolved `string`: resolving
it here would mean this package holding a value it has no business knowing.

**Required of no service.** A variable marked required is mandatory for a deployment that is
perfectly configured without it, and that is every deployment today. The two rows are optional with
the vendor default, so the change is inert for an instance that sets nothing.

**Both the reader and the writer get it, at every site.** The failure this avoids is quiet rather
than loud: a deployment that redirected the reader but not the writer would read from the instance
it meant to write to and write to the vendor's public API — and both passes would report success.
One of the four tests is a task-tool *write* for that reason, not because the write path was
expected to be the broken one.

**An empty value is read as unset, not as a malformed host.** That is the existing rule for every
optional variable, and it was worth checking rather than assuming: a Vault template that emits
`DOCTOOL_BASE_URL=` for an instance that has not overridden one must not stop the boot. The test
that found this was written expecting a refusal, and it failed — the code was right and the test was
wrong, which is the cheaper order to find out in.

## Surprises

**The follow-up that says `DOCTOOL_BASE_URL` would unblock *Open page* is wrong about that, and the
distinction is worth keeping.** Two entries carry the same suggestion; the page-creation entry's
follow-up table says *"`DOCTOOL_BASE_URL` would close it"* about the initiative detail screen's
disabled **Open page** button. It would not.

`DOCTOOL_BASE_URL` is the **API host** — the host that serves JSON, and the one this workstream
points connectors at. A person cannot open a page at it. And the value the screen would actually
need is not merely a different hostname: the document tool returns a page URL on every page and
`packages/connectors/src/doc-tool` **deliberately does not read it**, because it identifies the
workspace (`doc-tool/types.ts`, *"No workspace URL"*; `wire.ts` marks `url` and `public_url` as not
read). So building that link needs a browser-facing base *and* whatever path shape turns a page id
into a link — vendor knowledge the connectors currently confine to one constant and that a second
tier would be taking on.

None of that is decided here, and it is not a patch. It is recorded under *Follow-ups* so the next
person does not read two journal entries and expect the button to work because the variable exists.

**A stub is a worse test than it looks.** The reason this was requested is driving the outward path
locally, and pointing a client at a stub is exactly the kind of thing that makes a suite look
broader than it is: a recorded transport already exists for that
(`@prisme/connectors/testing`), and it cannot reach a network however badly a test is written
(`packages/connectors/CLAUDE.md`). What these variables genuinely add is a *self-hosted* instance
and a proxy — a real deployment asking for something the vendor default cannot give it.

**The privacy hook refused this commit, and it was right.** The first draft of the write test passed
a literal UUID as the idempotency key — needed, because `createCommandSender` refuses anything that
is not UUID-shaped — and the staged scan matched it. W06's entry records the same thing happening to
a generated manifest, so this is the third time this project has been saved by a pattern rather than
by attention; the fix both times is the same and is what the test does now: derive the key with
`idempotencyKey`, which is the only way this repository makes one. The lesson is not "no UUIDs in
tests" — it is that writing one by hand is the tell that the test is not using the application's own
path.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The initiative detail screen's **Open page** still cannot open anything | Needs a browser-facing base and a page-id → URL shape, and the tool's own page URL is deliberately not read. `DOCTOOL_BASE_URL` is the API host and does not close it — see *Surprises* | the human, to decide; then a follow-up |
| A capture's page has no role key | Unchanged from the page-creation entry: ADR-0025's vocabulary names an initiative's page and a project's page, and a capture is neither | the human, to decide |
| The committed fixture harness | Ninth session to need one. Still on disk, gitignored, still stale | a later follow-up |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `privacy deny-list` | local + CI | clean, 43 patterns, including the local supplement |
| `gitleaks` | CI | see the rollup on the pull request |
| `security gate self-test` | CI | see the rollup on the pull request |
| `internal links` | CI | see the rollup on the pull request |
| `dependency review` | CI | see the rollup on the pull request |
| `typecheck` | local + CI | clean — `tsc -b`, and `tsc --noEmit -p apps/web/tsconfig.json` |
| `lint` | local (per package, CI runs it whole) | clean — `eslint` on `packages/config`, `packages/connectors`, `apps/sync`, `apps/api`; `prettier --check` clean on every changed file |
| `test` | local + CI | **2 012 passed**, 116 files (both database URLs set) — unit 1 826, integration 186 |
| `build` | local + CI | `pnpm build` clean, all packages and three apps |
| `golden fixtures` | CI | see the rollup on the pull request |
| `dependency audit` | CI | see the rollup on the pull request |
| `images` | CI | see the rollup on the pull request |
| `CodeQL (actions)` / `(javascript-typescript)` / `(python)` | CI | see the rollup on the pull request |

**The new test was watched fail before it was trusted.** `createTaskToolClient` was edited on a
throwaway copy to ignore `baseUrl`, and two of the four tests went red naming the vendor host; the
file was restored and `git diff` read back empty. Without that, a passing assertion about a URL is
indistinguishable from one that never checked anything. The integration suite was run against
`prisme_test`, whose schema already carries `0007` and `0008` — this change adds no migration.

## Privacy

Fixture and invented data only. The hostname the tests use (`self-hosted.example.com`) is invented
and reserved for documentation. No real hostname, workspace identifier, token or registry detail
appears in this entry or in the diff — and the point of the configuration is that a real one never
has to, because the value belongs in the environment rather than here.

## Specs touched

[`docs/15-runtime.md`](../15-runtime.md) §2 — the optional table gained both variables, and a
paragraph says why they have no default *there*, that they are the API hosts rather than the
browser-facing ones, and that reading a page URL from either tool remains something prisme does not
do. `.env.example` gained the two names with that same distinction, since the file is what an
operator actually copies.
