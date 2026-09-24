# FUP · 2026-09-24 · Open page, without holding a workspace URL

**Agent:** Claude · **Duration:** one session · **PR:**
[#70](https://github.com/vchatela-org/prisme/pull/70) — the commit rode in this pull request's
**stack**, not in one of its own · **Outcome:** complete

Closes the register row the follow-up wave carried as `⏳ human decision — pending`: the initiative
detail screen's **Open page** button. The decision was the owner's, taken on 2026-09-24, and what
was left was to build it.

Two earlier entries had said `DOCTOOL_BASE_URL` would close this. Both were wrong, and the reason is
the whole design: that variable is the **API host**, which serves JSON.

## What was done

- **`DOCTOOL_PAGE_URL_TEMPLATE`**, optional, no default, validated as an absolute `http(s)` URL
  containing a literal `{id}`.
- **`pageUrl(template, id)` in `apps/web/src/lib/page-link.ts`** — a pure function, tested without a
  browser, the same shape as every other decision a screen makes in this application.
- **The button renders a link when there is one**, and the disabled control with its explanation
  when there is not. `asChild` rather than a styled `<a>`, so it is the same button as the rest of
  the screen; `target="_blank"` with `rel="noreferrer"`, because it is the one control on that
  screen that leaves the application.
- **`.env.example` and `docs/15-runtime.md` §2**, where the variable's two properties — literal
  braces, and the origin check — are written next to the two API hosts it is so often confused with.

## Decisions taken

**A template, not a base URL.** Given a base, prisme would still have to know the *path shape* that
turns a page id into a link, and that shape is vendor knowledge this repository deliberately does not
hold: `packages/connectors/src/doc-tool` refuses to read the page URL the tool returns on every page,
because it identifies the workspace. A template makes the operator supply the shape and prisme supply
only the identifier, which keeps the workspace out of git **and** keeps a vendor's URL layout out of a
second tier. The alternative — read and store the tool's own URL, or at least its path — was refused
for the same reason the connectors refuse it.

**No ADR.** No capability changes, no new owner, and no field changes hands: the value is
configuration and prisme composes a link it is already given the parts of. That is the same reasoning
that let `DOCTOOL_BASE_URL` land as configuration and docs rather than as a record.

**The origin is checked after substitution, and the identifier is third-party data.** A page id
arrives from the document tool as a string of up to 200 characters with no character class enforced
on it. A `{id}` in the path cannot reach the host on its own, but this is a link a person clicks, and
the check costs one `new URL` — so a template that puts `{id}` in the authority produces no link at
all rather than a plausible one pointing somewhere else.

**Unset is not a broken deployment.** Every instance is in that state until somebody sets the
variable, and the screen says what is missing instead of rendering a dead control with no
explanation. Nothing else reads the variable and no state depends on it.

## Surprises

**`new URL` percent-encodes braces, so a template read back through `.href` substitutes nothing.**
This is the trap the variable has and the two API hosts beside it do not: `new URL('https://x/{id}')`
gives `https://x/%7Bid%7D`, and validation that round-tripped through `.href` would store a template
whose placeholder no longer matches anything — configured, accepted, and silently linking every page
to the same place. So the value is validated through `URL` on a **copy** with the placeholder already
replaced, and the substitution is a plain string replacement on the original. The consequence is
deliberately visible in the function's return: it hands back the substituted string, never
`candidate.href`, so any *other* placeholder an operator used survives too. Both behaviours are
asserted, and the second is why the function does not simply return `.href`.

**The origin guard was watched fail, and exactly one test goes red without it.** Neuter the
comparison and the *"refuses an identifier that would choose the host"* case is the only failure —
which is the point of writing the case at all: a guard that no test can distinguish from no guard is
a guard nobody will notice deleting.

**A test passed for the wrong reason on the first run, and the fixture is what caught it.** The four
new configuration tests used the `COMPLETE` environment and `service: 'web'`; `COMPLETE` is the API's
contract, not the web tier's, so loading it as `web` threw — and the three `it.each` cases *expect* a
throw, so they passed while asserting nothing about the variable they were named for. Switching to
the `WEB` fixture is what makes the assertion about `DOCTOOL_PAGE_URL_TEMPLATE` rather than about a
missing `OIDC_TOKEN_ENDPOINT`. The same class of mistake the MCP entry recorded about a control that
passed because another control refused first.

**The link is not covered by a test, only by the build.** The pure function is covered from both
directions; the wiring is a prop passed by a server component into a client component, and this
repository has no component-test pattern under `apps/web` (the one it has is in `packages/ui`, added
by W07). Writing the first one here would have needed a `next/navigation` mock, a server-action stub
and a toast provider to assert three attributes. It is recorded rather than done, and the click is
what the next browser drive should cover.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| Driving the link in a browser | The wiring is asserted by the build and by nothing else | whoever runs the next browser drive — the committed [`harness/`](../../harness/README.md) (#70) is now there to do it |
| An instance must set the variable | Unset is a disabled control that explains itself, so this is a deployment step rather than a gap | the owner, at deployment |
| If a workspace's page URL carries something other than an id in its path | The template handles any shape, so this needs no code — but the operator is the only one who knows it | the owner |

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `typecheck` | local + CI | clean — `tsc -b` and the per-package pass including tests |
| `lint` | local (per tree, the whole-repo run is OOM-killed on this machine) + CI | clean — `eslint packages/config/src apps/web/src`, `prettier --check` on every changed file |
| `test` | local + CI | **1 939 passed**, 113 files, ten integration files skipped locally for want of a test database — CI runs them. Eight of the new ones are `page-link`, four are `config` |
| `build` | CI | the web tier compiles with a new server-component import; no new dependency |
| `internal links` | CI | `docs/15-runtime.md` gained no new anchor, and the journal entry links to a new file |
| `privacy deny-list` · `gitleaks` | local (pre-commit) + CI | local clean. The two hostnames in the tests and in `.env.example` are `workspace.example.com` and friends — invented and reserved for documentation |
| every other required check | CI | see the rollup on [#70](https://github.com/vchatela-org/prisme/pull/70) |

## Privacy

Fixture and invented data only. `workspace.example.com`, `prisme.example.com` and
`idp.example.com` are reserved example domains, and the page identifier used in the tests is a
made-up hex string shaped like the real ones rather than copied from anywhere. **The variable is the
privacy position**: the value that would identify a real workspace lives in the environment and
never in this repository, which is why the mechanism is a template rather than a stored URL. Deny-list
and secret scans are green.

## Specs touched

- [`docs/15-runtime.md`](../15-runtime.md) §2 — the optional-variable row, and a paragraph on the
  browser-facing host, the literal-brace trap and the origin check.
- [`.env.example`](../../.env.example) — the variable, with the distinction from the two API hosts.
- [`STATUS.md`](../../STATUS.md) — the register row closes, and the warning paragraph that said two
  journal entries were wrong about `DOCTOOL_BASE_URL` becomes the record of what actually closed it.
- [`docs/50-journal/INDEX.md`](INDEX.md) — this entry.
