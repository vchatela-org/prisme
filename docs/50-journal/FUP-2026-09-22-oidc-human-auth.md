# FUP · 2026-09-22 · Humans log in over OIDC now, in-app

**Agent:** Claude · **Duration:** one session ·
**PR** [#56](https://github.com/vchatela-org/prisme/pull/56) · **Outcome:** complete

Implements [ADR-0026](../20-decisions/0026-human-auth-via-oidc.md), which was Proposed in
[#55](https://github.com/vchatela-org/prisme/pull/55) and is **Accepted** on this branch. The decision
was forced by the deployment: the identity provider's proxy type cannot be given a durable asymmetric
signing keypair, so the forward-auth arrangement ADR-0021 specified cannot be stood up there
(recorded in [FUP-2026-09-22-proxy-cannot-sign.md](FUP-2026-09-22-proxy-cannot-sign.md)). What
changed is **where the login happens**, not what is trusted: the web tier now runs the OIDC
authorization-code flow and verifies the ID token it gets back with the verifier that was already
there.

## What was done

- **`apps/web/src/app/auth/login|callback|logout/route.ts`** — the flow, server-side. Login 303s to
  the provider with PKCE; the callback compares `state` in constant time, exchanges the code with the
  `code_verifier`, **verifies the ID token**, and only then writes the session; logout clears the
  cookie and, when configured, ends the provider's session too.
- **`apps/web/src/lib/oidc.ts`** — PKCE (`S256`), URL building, callback parsing, the token-exchange
  response schema, cookie helpers, and `returnToPath`. Pure apart from the exchange, which takes an
  injected `fetch`, so the tests drive it without a socket.
- **`apps/web/src/lib/auth-gate.ts`** — the middleware's decision, extracted so it is a value:
  *public*, *authenticated*, *redirect* or *refused*. This is where ADR-0026's distinction lives and
  where it is tested from both sides.
- **`apps/web/src/lib/assertion.ts`** — the policy, the key set and the session cookie, in one place
  now that the callback needs the same three the middleware does.
- **`apps/web/src/middleware.ts`** — reads the session cookie; **no longer reads the assertion
  header on the way in**; sets that header upstream from the cookie for the API to verify; strips the
  cookie from the forwarded request.
- **`packages/config`** — `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`, `OIDC_AUTHORIZATION_ENDPOINT`,
  `OIDC_TOKEN_ENDPOINT`, `OIDC_SCOPES`, `OIDC_END_SESSION_ENDPOINT`: all `web`-only, and no secret
  among them.
- **Specs**: `15-runtime.md` §2 (the variables, and the "holds no secret" paragraph corrected) and §6
  (obligations, and a new *Logout* subsection); `14-threat-model.md` §1, §3 and §5; `0021`
  flipped to **Superseded**, `0026` to **Accepted**, and the ADR index.
- **Verified by running**, not by its parts — below.

## Decisions taken

**A public client, so no secret exists to be quiet about.** PKCE with `S256` means the exchange sends
a verifier and no client secret (ADR-0026 rule 4). There is no `OIDC_CLIENT_SECRET` in the schema, no
default for one, and a test asserting the OIDC variable set contains nothing credential-shaped — so
the property `15-runtime.md` §2 states is checked rather than remembered. Had a confidential client
been unavoidable, this entry would say so loudly; it was not needed, and the deployment's registration
step is a **public** client.

**The session is the token, and there is no server-side session.** The web tier holds no database
credential (`14-threat-model.md` §2), so a session store would have to be in-process — which is a
session that vanishes when a pod restarts or a second replica answers, the same
unpredictable-invalidation failure ADR-0026 rejected a scheduled key re-assignment for. The cookie
holds the provider's ID token, the middleware verifies it on every request, and clearing the cookie
**is** ending the session.

**Fixation resistance is structural, not a check.** No session identifier is ever issued or adopted:
the value in the cookie is minted by the provider for this one exchange. There is nothing a caller
could present beforehand that would become their session, which is a stronger guarantee than rotating
an identifier after login.

**No `nonce`, deliberately.** OIDC makes it optional in the code flow, and its job — binding a token
to the request that asked for it — is done by `state` (compared against an `HttpOnly` cookie) and
PKCE (binding the code to a verifier only this process holds). Sending one and not checking it would
be worse than not sending it; checking it would mean reading a claim outside the verifier, which is
the second implementation this design exists to avoid. The reasoning is in the module docstring.

**No refresh token.** So the session cannot outlive the token, `AUTH_ASSERTION_MAX_LIFETIME` is the
real outer bound, and expiry is a redirect into the flow — which a live provider session usually
answers without a prompt. A refresh path is additive later and needs no change here.

**The two flow endpoints are configuration, not discovery.** A discovery document is a response body
from an external service, which §5 of the threat model classifies as untrusted input; pointing a code
exchange at a URL that arrived over the network is the mistake the key-set URL is refused for. The
key set itself is unaffected — still discovered from `AUTH_ISSUER_URL` through the existing
origin-allow-listed fetch.

**The assertion header left the request path.** ADR-0026 rule 3 says it disappears, and it has to
*disappear* rather than stop being required: a header still honoured is a second way to be
authenticated, and the one an attacker inside the perimeter would prefer. There is a check for it
below that is the best evidence in this entry.

**Two boot-time refusals rather than two post-login mysteries.** `OIDC_REDIRECT_URI` must share an
origin with `PRISME_BASE_URL` (or the browser never sends the session cookie back, and the result is a
login loop with no error anywhere), and `AUTH_AUDIENCE` must equal `OIDC_CLIENT_ID` for the web tier
(OIDC Core: an ID token's `aud` *is* the client id, so a mismatch is a login that succeeds at the
provider and is refused here as an unexplained 401). Both are cross-field checks in `loadConfig`,
beside the sync-window one, with a test each.

## What running it exposed

A flow verified by unit tests around its parts is not verified, so it was driven end to end against a
locally running fake provider (`seed/harness/`, gitignored): a real browser (Chromium, populated
screens, a real write) and a scripted client following real redirects and storing real cookies. Six
findings, four of which no unit test would have produced:

1. **The `Set-Cookie` value is percent-encoded by the framework, and the application must decode it.**
   The in-flight state is a JSON cookie; without an explicit `decodeURIComponent` on the way in, every
   login fails as "no pending flow" while the cookie is visibly present. The unit tests around
   `cookieValue` pass either way with a plain value — it took a real `Set-Cookie` to make the decode
   load-bearing.
2. **Two CSP violations appear the moment a Radix `Select` is opened.** Not from this change — the
   diff touches no CSP text and no client component — but the same family W07 patched: an inline
   style applied *at runtime* from a measurement, which a class cannot replace and which the
   server-render guard (`packages/ui/src/no-inline-style.test.tsx`) cannot see because it only
   inspects server-rendered markup. Recorded as a follow-up row rather than fixed here; the CSP is
   deliberately strict and widening it to `'unsafe-inline'` for styles would undo W07's work.
3. **The middleware's redirect was a `307`.** `NextResponse.redirect` defaults to it, and the two
   route handlers that redirect use `303`. Indistinguishable for a GET navigation, so nothing was
   broken — but the driver asserted the status and caught the inconsistency. Now `303` explicitly.
4. **The local harness's seed was not idempotent.** A second run died on a primary key and the process
   exited before the provider ever listened, which presents as "the OIDC routes 404" — three steps
   from the cause. It truncates the fixture tables first now.
5. **The API fails closed and says so when the key set is unreachable.** Brought up before the
   provider, it logged `KeySetUnreachable` naming the issuer and answered 401 on the human path while
   agent-token reads were unaffected. That is the designed behaviour, and it is worth having watched.
6. **`next start` warns under `output: 'standalone'`** and serves correctly anyway. Local-only; the
   images still use the standalone server.

The drive itself asserts 40-odd things, including three that are the point of the decision:

| Check | Why it matters |
|---|---|
| The `code_challenge` in the authorization URL is `S256` of the verifier **held in the cookie**, recomputed outside the application | The PKCE is real, not decorative. Recomputing it from the cookie is something the application cannot assert about itself |
| A **valid, unexpired, correctly-scoped** ID token in the assertion header authenticates nobody | The header path is gone, not merely deprecated |
| A code redeemed with a **tampered verifier**, a **mismatched state**, or **twice** each yield 401 and no session | The three ways a login can be forged are each refused, and none of them writes a cookie |

Also driven and passing: the session cookie's attributes (`HttpOnly`, `Secure`, `SameSite=Lax`,
`Path=/`, no `Domain`, no `Max-Age`); a garbage, expired and wrong-subject token each answering 401
rather than a redirect, while a *missing* one answers the login flow; a cross-site and an origin-less
`POST /auth/logout` each answering 403; the API accepting the token the web tier presents and
refusing a forged or absent one; a status change through the UI landing in the database and minting an
event-log row.

## PKCE held the no-secret property

Yes, and the statement needs one qualification to stay honest. **No secret is held in
configuration** — the exchange sends `grant_type`, `code`, `redirect_uri`, `client_id` and
`code_verifier`, and a test asserts the body contains no `client_secret`. The only secret-shaped value
prisme generates is the **per-flow PKCE verifier**, which lives for ten minutes in an `HttpOnly`
cookie and is not a credential to anything else: it cannot be used to obtain a token without the
code, and the code is bound to this browser's `state`. The browser holds a session cookie that *is*
the provider's token — a credential, yes, and the honest cost ADR-0026 states, not a secret the
process can leak to a log.

## Not done

- **No logout control in the UI.** `POST /auth/logout` exists, is origin-checked and is verified end
  to end; nothing in `apps/web`'s shell calls it yet. Recorded as a follow-up rather than smuggled in
  here — the shell is W07's component and this change is about authentication, not chrome.
- **No refresh token**, deliberately (above).
- **No OIDC client is registered on the deployment's identity provider.** That is the operator's step
  and it is the only thing between this branch and a working login in the cluster. Nothing here points
  at a real provider's endpoints (`17-privacy.md`).
- **The API tier is untouched** — no OIDC in `apps/api`, no change to the verifier, the algorithm
  allow-list or the origin check.
