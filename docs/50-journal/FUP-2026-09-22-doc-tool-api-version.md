# FUP · 2026-09-22 · The document tool's API version predated the endpoints prisme calls

**Agent:** Claude · **Duration:** one session · **PR** [#54](https://github.com/vchatela-org/prisme/pull/54) · **Outcome:** complete

The document-tool client pinned `2022-06-28` and called `POST /v1/data_sources/<id>/query`. The
version and the call came from two different eras of the vendor's API, and the version header wins:
**every document-tool query returned `400 invalid_request_url`.** Measured against the live API, not
inferred — the same request answers `200` under `2025-09-03` and `2026-03-11`, and `400` under any
string the tool does not recognise as a release.

That is the whole document-tool read path: the adoption scan, the backfill's declared durations and
everything W15's *Create page* would copy. It is also the second time this class of defect has been
found by deploying rather than by testing (after [#45](https://github.com/vchatela-org/prisme/pull/45)),
and for the same structural reason: no test may call a real API, so a recorded fixture cannot know
that the vendor moved.

## What was done

- **The pin moved to `2026-03-11`** and stayed a pin. The reasoning in `client.ts` — the tool dates
  its breaking changes, and an unpinned version is a silent upgrade — was never the wrong part; only
  the value was. The constant's comment now records *why this value*, because the next person's
  instinct will be to read it as arbitrary.
- **Every endpoint this client calls was checked against the new version, live**: the data-source
  query (its body, its filter, its sorts, its cursor), `GET /v1/pages/<id>`, the block-children read
  (page body, nested block bodies, the template read, which is the same endpoint), and the
  `POST /v1/pages` request shape.
- **The one response shape that moved is now covered by a fixture.** `archived` — the deprecated
  alias of `in_trash` — is gone from every response at the pinned version. See *Surprises*.
- **`isArchived(page)` replaces two copies of the same expression** in `map.ts`, so the "either
  spelling" rule has one home and one comment.
- **Two contract tests and a test-visible floor**: the pin is sent on every request, and the pin
  must be at or after the version in which the surface it calls exists (`2025-09-03`). A version
  string is date-shaped, so it compares as a date; this is the cheap guard that would have caught
  the defect.
- **Four fixtures refreshed to the shape the pinned version sends**, and **one added** for the older
  spelling, so the compatibility claim is a test rather than a comment.
- **`packages/connectors/CLAUDE.md`** gained the pin's rationale — see *Specs touched*.
- **The whole package was searched for the older surface, not just the one method.** Every outbound
  path in `doc-tool/client.ts` is on the current one (`/v1/data_sources/<id>/query`,
  `/v1/pages/<id>`, `/v1/pages`, `/v1/blocks/<id>/children`), and no call or comment in the package
  still describes `/v1/databases/`. The mismatch was the header value and nothing else — which is
  worth stating, because the obvious hypothesis on finding a version and a call from different eras
  is that something else was left behind with them.

## Decisions taken

**Keep the pin; change its value.** Removing the header would make prisme follow the vendor's
default version, which is the silent upgrade the pin exists to prevent, and it would make the next
breaking change arrive at a moment nobody chose. A pin whose *value* is verified is the only version
of this that is both safe and honest about what it is.

**Read both spellings of "not live", as an `or`.** `in_trash` is what the pinned version sends;
`archived` is what older versions sent. One of the two is always absent, so a reader that consulted
either alone would call every trashed page live on the version that spells it the other way. This
was already an `or` in the mapping — the decision here is that it *stays* one, now with a name.

**Do not invent a mapping for `is_archived`.** The tool returns it on every page and documents it
nowhere, and a boolean whose meaning is not written down is a guess — which
`packages/connectors/CLAUDE.md` §3 refuses. It is recorded as unread, in the schema, next to the
reason. The alternative (mapping it to `archived` because the name looks right) is exactly the kind
of quiet wrong value the rest of this package is built to avoid.

**No live write probe beyond what a shape check requires.** `createPage` was verified by measuring
what the tool *refuses*, not by creating prisme's page: the accepted shapes appear in the tool's own
validation errors (`properties.title.title` must be an array; `children` must be an array or absent),
and a real parent with the client's parent shape resolves the parent and fails on nothing else. See
*Privacy* for the one page a probe did create by accident.

## Surprises

**The version bump carried a rename that the schemas absorbed silently.** `archived` is dropped at
`2026-03-11` in favour of `in_trash` — the vendor's upgrade guide lists it as breaking. Both fields
are optional in `wirePageSchema`, so nothing failed to parse: a page that is not live would simply
have been read as live, and only on the version that sends the other name. This is the case the
brief warned about from the other direction: a shape change that *fails loudly* is the easy one,
and this one could not have failed at all. The mapping already handled it; the fixtures did not
prove it, because they carried both fields at once. They now carry one each.

**The other two breaking changes in that version do not touch prisme.** Append-block children takes
a `position` object where it took `after` (prisme appends no blocks — a creation's body travels in
the create request), and the `transcription` block type is renamed `meeting_notes` (prisme extracts
text from an allow-list that has never contained it). Both were checked rather than assumed, because
"our call sites look fine" is what the version pin was, once.

**The query endpoint takes `POST`, and the vendor's own upgrade guide writes `PATCH`.** Measured:
`POST` answers `200`, `PATCH /v1/data_sources/<id>/query` answers `400 invalid_request_url`. Worth
recording because the documentation is the thing a future migration will be planned from.

**There is no second failure in the read path — the second failure is that nothing would have said
so.** Once the version was right, the filter body, the sorts, the cursor paging (five pages, no
repeat, no short-page truncation), the permissions on all five bound roles and the block recursion
(three levels, `column`/`column_list` children included) all worked unchanged. What made this
invisible for so long is `readRole`: it swallows every error and reports **"not read"**, because the
message would carry the role binding. That is a deliberate privacy decision and it is not reversed
here — but it means a refused read and an unbound role print the same six characters, and the only
thing that distinguishes them is a live check. Recorded in the package spec so the next reader knows
that "not read" is not evidence that nothing is bound.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| `is_archived` / `is_locked` are returned and unread | Undocumented booleans; mapping one would be a guess. If the tool ever documents them, this is a one-line change and a fixture | nobody — recorded, not deferred |
| "Not read" cannot distinguish an unbound role from a refused read | The privacy reason for the swallow stands; the diagnostic gap is real. A count of *why*, without the identifier, is the shape a fix would take | a later follow-up |
| The pinned version will age | This defect is the second of its kind in a week. Nothing in this repository can watch an outward API, so the watch is a live check, and it belongs in whatever verifies a deployment | the human, with the deployment |
| The committed fixture harness | Still on disk, gitignored, still stale | a later follow-up |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `privacy deny-list` | local + CI | **pass** — locally clean at 44 patterns, worktree **and** staged, local supplement active |
| `gitleaks` | local pre-commit + CI | **pass** — "no leaks found" |
| `security gate self-test` | CI | **pass** |
| `internal links` | CI | **pass** |
| `dependency review` | CI | **pass** |
| `typecheck` | local + CI | **pass** — `tsc -b` clean |
| `lint` | local (per package) + CI | **pass** — `eslint packages/connectors` and `prettier --check` on every changed file. CI runs it whole |
| `test` | local + CI | **pass** — locally 119 files / 2 036 tests with `PRISME_TEST_DATABASE_URL`, 109 files / 1 843 without it (the ten integration files skip) |
| `build` | local + CI | **pass** — `pnpm -r --filter "./packages/*" --filter "./apps/sync" run build` |
| `golden fixtures` | CI | **pass** |
| `dependency audit` | CI | **pass** |
| `images` | CI | **pass** |
| `CodeQL (actions)` / `(javascript-typescript)` / `(python)` | CI | **pass** |

Read back from the pull request at the head of this branch after the last push — every check above
`pass`, none queued, none missing from the rollup.

**Before and after, against the live API, with the real client over a live transport.** The old pin
turned `queryByRole('objectives_db')` into a `ConnectorError` at `status 400`, which the adoption
scan rendered as `document tool   not read`. The new pin reads every bound role: 64 objectives, 95
takeaways, 8 areas, 15 processes and — through five cursor pages — 480 rows in the store the scan
excludes. A watermark floor twenty-one days back narrows the same query from 64 to 6; a page's block
walk reads 56 blocks across three levels with `column`, `column_list` and `table_of_contents`
skipped by type; the whole adoption scan, run with `persist: false` against a stub store, prints
the four scanned roles with counts where it used to print "not read". No live call was made by any
test.

## Privacy

Counts and shapes only; no title, name, identifier, hostname or weight appears here or in any file
this change touches. The live checks ran from scratch scripts outside the repository, and the
fixtures added or refreshed are the synthetic `doc-page-000N` set this repository already
documents — nothing was recorded from the workspace. One accident, recorded rather than hidden: a
shape probe that sent a valid parent with **no properties** was accepted, and created an empty page
under a real one. It was located in a separate read-only step and trashed by literal id; the probe
was rewritten to be refusable in every branch it still had left. The lesson is the same one this
entry is about — the create endpoint does not validate what you expect it to, so a probe must be
invalid by construction, not invalid by intent.

## Specs touched

- [`packages/connectors/CLAUDE.md`](../../packages/connectors/CLAUDE.md) — a new section stating
  that the document-tool version is pinned, that the value must be a real release date, that a bump
  is verified against every endpoint rather than made as a one-line edit, and that a refused read
  reports as "not read". None of this was written down anywhere before, which is why the pin could
  be wrong for as long as it was.
- [`docs/16-sync.md`](../16-sync.md) and [`docs/15-runtime.md`](../15-runtime.md) needed **no
  change**, and that was checked rather than assumed: neither states a version, and neither
  describes an endpoint surface. 16-sync deliberately confines itself to cadence, the watermark and
  the plan/apply contract, and 15-runtime's document-tool variables are the token, the base URL and
  the duration property — the version has never been a variable, and this change does not make it
  one. The sibling entry for the task tool
  ([#45](FUP-2026-09-22-todoist-api-v1.md)) reached the same conclusion about the same spec, which
  is the second data point that it is deliberate.
