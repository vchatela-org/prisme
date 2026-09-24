# FUP · 2026-09-24 · A nonce, a rename, a way to sign out

**Agent:** Claude · **Duration:** one session · **PR** (this branch) · **Outcome:** complete

Closes the three open items the follow-up wave had left, in the order it left them: the last two CSP
violations, the `middleware` → `proxy` rename the hygiene entry deliberately deferred, and the logout
control the OIDC entry recorded as *not done*. It also moves four follow-ups that lived only inside
journal tables into the **STATUS** register, which is where an obligation is held rather than
explained.

## What was done

- **Both popup stylesheets now carry the page's CSP nonce.** `packages/ui`'s
  [`lib/csp-nonce.tsx`](../../packages/ui/src/lib/csp-nonce.tsx) carries the per-request nonce from
  the app's root layout into the two places a dependency injects a `<style>` element — Radix's select
  viewport (which takes it as a **prop**) and the scroll lock underneath a popup (which reads it from
  `get-nonce`, the module whose entire purpose is to be told once what the page's nonce is). The
  policy did not move: no `unsafe-inline`, no `unsafe-hashes`.
- **`apps/web/src/middleware.ts` is `apps/web/src/proxy.ts`**, exporting `proxy` — Next 16's
  convention, and the deprecation warning is gone from the build.
- **`scripts/check-web-security-headers.sh`** asserts that a real response still carries the CSP and
  every other security header, and is **watched failing** before the rename (below).
- **A sign-out control in the shell**, which is the first thing in the application that calls
  `POST /auth/logout`.
- **The route answers a script in JSON** — one field, the provider's end-session URL — because that
  is the one thing a page cannot otherwise obtain and the one way the browser is sent there.
- **Four follow-up rows promoted into `STATUS.md`**, two of them marked *human decision — pending*
  rather than implemented.

## Decisions taken

**The nonce, not a patch — and the recorded description of the defect was wrong.** `STATUS.md` said
the two violations were the popper's *runtime inline style*, "which no class can carry". Driving it
disproved that: both violations were `style-src-elem`, both were **`<style>` elements**, and neither
was an attribute. They are Radix's viewport rule and `react-remove-scroll-bar`'s scroll-lock sheet.
That distinction is the whole reason the fix is a nonce: a nonce can authorise a `<style>` element
(it cannot authorise an *attribute*, which is why W07's patches were the right answer for the twelve
before these). The correction is in `STATUS.md` and the row is closed 🟢.

**Nothing was patched this time.** Both libraries already have a nonce affordance and prisme simply
never fed it — Radix's `SelectViewport` takes `nonce`, and `react-style-singleton` reads
`get-nonce`. A sixth `pnpm patch` would have meant maintaining a fork of two more internals to
achieve what one prop and one function call already do, and it would have fixed two instances
instead of the class: every modal in the application shares the scroll lock.

**Where the nonce comes from, and why it took a provider.** A nonce is minted per request by the
proxy, the browser is never told it, and a client component cannot read a response header. The
middleware already puts it on the **forwarded request** as `x-nonce` — that is how Next applies it to
its own scripts — so the root layout reads it there and `CspNonceProvider` hands it down. `setNonce`
is called **during render rather than in an effect**, because it is read at the moment a dependency
builds its tag and Radix mounts its sheet while a popup is opening: an effect would usually win that
race and would be a bug when it did not.

**The guard is a headless DOM, because the server render cannot see any of this.** The existing
guard renders with `react-dom/server`; the sheets in question do not exist until a popup opens in a
browser. So `packages/ui/src/no-inline-style-dom.test.tsx` is the sibling: it mounts a `Select` and
a `Dialog` in jsdom, opens them, and refuses a stylesheet without the nonce. `jsdom` is a new root
devDependency — the first DOM in this repository's test stack, and the reason is in the file.

**It was watched fail twice, once per half of the mechanism.** Dropping the viewport's nonce prop
reds the `Select` case; neutering `setNonce` reds both the `Select` and the `Dialog` cases — which is
what tells them apart, because the scroll lock is shared and the viewport is not. A third case
asserts the opposite direction (no nonce supplied ⇒ a bare element), so the assertions are not
passing on a value that was never threaded through.

**The rename was done in the order the hygiene entry fixed, and the check came first.** The check is
a script rather than inline YAML so it can be run against a local `next start` while working on the
file *and* against the built container in CI; it is folded into the existing `images` step, because a
new status-check name is a human's branch-protection change and this is the same claim the workflow
already makes — that the thing which boots is the thing that was tested. `/healthz` is deliberately
*not* what it reads: the matcher excludes the probes, so a probe-only check passes on an image whose
middleware never loaded, which is the failure W14 recorded.

**`<form method="post" action="/auth/logout">` cannot work here, and that was measured.** The web
tier sends `Referrer-Policy: no-referrer`, and a browser sends **`Origin: null`** — not this origin —
on a form submission from such a document, so the origin check refuses it. That is correct behaviour:
`null` is also what a sandboxed cross-site frame sends. A `fetch` from the same page carries the real
origin and passes; both were driven before the control was written. The consequence is worth stating
plainly: **with this policy, no native form POST from prisme can pass the origin check**, so every
state-changing control here is a script — which the rest of the application already was.

**The route is asked where to go, rather than the page deciding.** Clearing prisme's cookie is not
the whole of signing out: the provider usually holds a session of its own, and ending it means
*navigating* the browser to its end-session endpoint — which is configuration a page cannot build.
Following the route's redirect from a `fetch` does not work either, and that is also measured: the
browser refuses to follow it cross-origin, so the provider is never reached and nothing is ended. So
`:accept: application/json` gets the destination, and everything else about the route is unchanged —
a browser reaching it the ordinary way still gets the redirect or the sentence. The route remains the
single place that decides what "signed out" means.

**The two human decisions were registered, not implemented.** *Open page* and *a capture's page has
no role key* both need a decision rather than code, and the task said so; they are now rows in the
register with state `⏳ human decision — pending`, which is where the person who owns them will find
them.

## Surprises

**React's `style` attributes are not CSP violations at all, and that had been misread.** Every style
attribute in the driven DOM — the popper wrapper's measured `transform`, the viewport's `flex`, the
scroll lock's `pointer-events: none` on `<body>` — is applied **through the CSSOM**, which CSP does
not govern. The ~100 violations W08 found were *server-rendered* markup: an attribute present when
the parser meets it is checked, an attribute React sets afterwards is not. This is why the popper's
runtime style was never among the survivors, and why the two that remained were elements. It also
means `no-inline-style.test.tsx`'s rule is a rule about *what the server sends*, not about what the
DOM ends up containing — worth knowing before someone "simplifies" the guard.

**A rename is not just a rename: one key had to go with it.** `export const config` carried
`runtime: 'nodejs'`, which W14 pinned because the configuration loader reads a rendered env file at
boot. Next 16 made Node the only runtime for this file and **refused the key outright** — *"Route
segment config is not allowed in Proxy file"*. The build caught it, which is the good direction: the
constraint did not become a silently ignored option.

**A half-rename is a build error, and a wrong name is silence — both were checked.** A `proxy.ts`
exporting `middleware` fails the build naming the file (`ProxyMissingExportError`), which is the
loud half. The quiet half is the one the check exists for: a file *named* something the framework
does not load is not an error, not a warning, and not a header. That is the state the check was
watched failing in — `next build` green, `/` answering `200` with no policy on it at all.

**`setNonce` is a module-level variable, so it is sticky within a document.** That is why the
provider sets it once at the root rather than per component, and it is why the negative-control case
asserts on the viewport sheet (which comes from React context) rather than on both: the scroll lock
keeps whatever a provider set earlier in the same process. A property of the mechanism, not of the
test.

**The `middleware` warning disappearing is the only build-level evidence the rename took.** `next
build` reports `ƒ Proxy (Middleware)` either way, and `middleware-manifest.json` is `{}` **even when
it works** — the artefact that names the matcher is `functions-config-manifest.json`, keyed
`/_middleware`. A build-artefact check would therefore have been a check on Next's internals with the
wrong file; the runtime assertion is the one that says what matters.

## Verified by running

Built, served and driven in a real browser through the local OIDC harness (gitignored, `seed/`) —
against a stack on its own ports and its own database, because the machine already had one running.

| What was driven | Before | After |
|---|---|---|
| `/gallery` — opening the status `Select` | 2 CSP violations (`style-src-elem`, both `<style>` elements) | **0** |
| `/backlog` — opening the severity filter `Select`, on a real screen | (same two) | **0** |
| Both injected stylesheets | bare | nonce equal to the page's own, read from the stylesheet link |
| Sign out, clicked on `/` | no control existed | browser lands on the provider's `/end-session?client_id=…`, which logs the end-session; the next visit to `/` runs the login flow again — the session was really gone |

The header check was watched failing on the same machine before the rename, against a copy of the
file at a path the framework ignores: `next build` green, `GET /` answering `200`, **every** header
absent. The guard was watched failing twice, as described above.

## Follow-ups

| What | Why it matters | Owner |
|---|---|---|
| The committed fixture harness | See *Not done* — it is a maintained artefact, not a fix | a later follow-up, and it is now a row in the register |
| `get-nonce` is now a direct dependency of `@prisme/ui` | It is the library's public API for exactly this, but it resolves through `react-style-singleton`, so the two must share one module instance. The jsdom guard fails if they ever stop | whoever bumps `react-remove-scroll` or `react-style-singleton` |
| The initiative screen's *Open page* and a capture's page role key | Decisions, not code | **the human** — both are rows in the register |
| `is_archived` / `is_locked` returned and unread | Undocumented booleans; mapping one would be a guess | nobody — recorded, now in the register |
| Every popup is covered by the nonce, and only `Select`/`Dialog` are driven | A new component that injects a stylesheet must be added to the DOM guard, or it logs violations the first time somebody opens it | whoever adds one (written into `packages/ui/CLAUDE.md`) |

## Not done

- **The committed fixture harness.** It is now the tenth session to run without one, and it stayed
  on the same side of the line on purpose: a committed harness is a **maintained artefact** with its
  own review surface — a fake identity provider that mints tokens, a seed path, a start script, the
  ports, and the documentation of all of it — and this pull request already carries three fixes and
  the rename of the file holding every security header. Half of it (a script that starts the app)
  would be worse than none, because it would look like the harness exists. What it cost this session
  is recorded instead, so the next one starts from it: the stack needs **three ports and its own
  database** to run beside another instance, the ports are the trap the harness's own header warns
  about (a leftover process makes a restart look like a build that did nothing), and the nonce a
  browser drive needs is the one on the forwarded request as `x-nonce`.
- **Both human decisions.** Registered, not implemented.
- **The other `style`-element family**: anything a dependency other than Radix injects. The mechanism
  covers the scroll lock globally; the Radix viewport is the one that needed a prop.

## Checks

| Check | Where it ran | Result |
|---|---|---|
| `typecheck` | local + CI | local clean — `tsc -b`, and the per-package pass including tests |
| `lint` | local (per tree, the whole-repo run is OOM-killed on this machine) + CI | local clean — `eslint apps/web/src packages/ui/src`, `prettier --check` on every changed file. CI runs it whole |
| `test` | local + CI | local **1 923 passed**, 112 files, the ten integration files skipped for want of a test database — CI runs them |
| `build` | local + CI | `pnpm build` clean; the middleware deprecation warning is gone and no new one appeared |
| `images` | CI | **extended in this change**: it now runs `scripts/check-web-security-headers.sh` against the booted container |
| `privacy deny-list` | local + CI | local clean |
| every other required check | CI | see the rollup on the pull request |

## Privacy

Fixture and invented data only. The harness ran from `seed/` and every value in it is a development
throwaway; the fixtures seeded are the repository's own synthetic set. No real goal, project, task,
area, weight, hostname, token or workspace identifier appears in this entry, in the diff, or in the
checks — the hostnames the check script and the configuration tests use are `example.com` and
`127.0.0.1`. The nonce is generated per request and is not a secret kept anywhere; the guard's value
is the literal `test-nonce-not-a-secret`. Deny-list and secret scans are green.

## Specs touched

- [`STATUS.md`](../../STATUS.md) — the CSP row is corrected (the defect was two `<style>` elements,
  not a runtime inline style) and closed; the two hygiene follow-ups are closed; four rows are added
  for gaps that lived only in journal tables, two of them `⏳ human decision — pending`.
- [`docs/50-journal/INDEX.md`](INDEX.md) — this entry's row.
- [`packages/ui/CLAUDE.md`](../../packages/ui/CLAUDE.md) — the "never `style`" rule gained its other
  half: popup `<style>` elements carry the page nonce, the provider that supplies it, and the rule
  that a component mounting a popup belongs in the DOM guard.
- [`docs/40-workstreams/W14-security.md`](../40-workstreams/W14-security.md) — the brief named
  `apps/web/middleware.ts` under *Files you may touch*; the file is `apps/web/src/proxy.ts` now, and
  the brief says so rather than leaving a reader to grep for a file that does not exist.
- No spec in `docs/` stated the file's name or its runtime, so nothing else was contradicted.
  `docs/15-runtime.md` §2 was re-read for this change and needed no correction: the nonce is not a
  variable and the rename is not a contract.
