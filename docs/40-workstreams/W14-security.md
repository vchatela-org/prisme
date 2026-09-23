# W14 · Security and authentication

**Depends on:** W00 · **Wave:** 2
**Files you may touch:** `apps/api/auth/**`, `apps/web/middleware.ts`, `.github/workflows/**`, security configuration

> **Correction (2026-09-22) — the transport below is historical; the workstream's content is not.**
> [ADR-0026](../20-decisions/0026-human-auth-via-oidc.md) supersedes
> [ADR-0021](../20-decisions/0021-verified-forward-auth-assertion.md) on one point: the login happens
> **in-app over OIDC** rather than at a forward-auth proxy, because that provider cannot durably hold
> an asymmetric signing keypair. Everything this brief asks for — the verifier, deny-by-default, the
> token store, CSP, the CI gates, origin checks — landed and is unchanged, and ADR-0021's rules 1–4
> and 6–9 are still the specification the code implements. Read ADR-0021 through that lens: rule 5
> ("no prisme session cookie") no longer holds, and `apps/web/src/app/auth/**` is where the flow
> ADR-0026 added lives.

## Why

prisme holds tokens to an entire personal workspace across two external services, and the repository
is public. Security lands **with** the foundations rather than after — retro-fitting deny-by-default
onto forty existing routes does not happen.

## Read first

- [`../14-threat-model.md`](../14-threat-model.md) — the whole document
- [ADR-0015](../20-decisions/0015-auth-split-by-caller.md) — why authorization stays in prisme
- [ADR-0021](../20-decisions/0021-verified-forward-auth-assertion.md) — **item 1 is this ADR turned
  into code.** Its nine rules are the specification; read them before writing the verifier
- [`../15-runtime.md`](../15-runtime.md#identity-integration) — the `AUTH_*` configuration contract
  and what the deployment owes you
- [`../17-privacy.md`](../17-privacy.md) — you own the CI enforcement

## Not blocked any more

OQ-9 is closed ([ADR-0021](../20-decisions/0021-verified-forward-auth-assertion.md)): forward-auth,
with prisme **verifying** the provider's signed assertion instead of trusting an identity header.
The whole workstream can proceed.

## Scope

1. **Human authentication** — verify the provider's signed assertion on every request; trust no
   identity header, ever, not even as a fallback. Signature against the configured JWKS (never a
   URL from the request), asymmetric `alg` allow-list, `iss`, `aud`, `exp`/`nbf` with skew, a
   maximum assertion lifetime, and a `sub` allow-list. Identity is `sub`; username and email are
   display material. **No prisme session cookie** — logout belongs to the provider. The web tier
   forwards the assertion to the API, which verifies it again with the same implementation: the web
   tier is not a trusted hop. A request presenting both an assertion and a bearer token is
   **rejected**, not resolved by precedence.
2. **Scoped API tokens for machines**: minted from the UI, **Argon2id-hashed at rest**, plaintext
   shown exactly once, scoped, expiring, revocable, `last_used_at` recorded, with a recognisable
   prefix so secret scanners can detect a leak.
3. **Authorization middleware**: deny by default. Every route declares a required scope; **a route
   without one fails a test.** No ambient authority, including for the single user.
4. **The MCP confirmation-token mechanism**: short-lived, **bound to the diff it authorises**, and
   rejected if state has moved. W06 consumes it; you build it.
5. **Web hardening**: strict CSP with per-request nonces, an allow-list sanitiser for third-party
   rich text, CSRF origin checks, secure headers.
6. **SSRF guard**: an allow-list for any URL originating in user or third-party data.
7. **Redaction**: deny-list redaction at the log serializer, so a token cannot be logged even by
   `log.info({ config })`.
8. **Rate limiting**: per token and per verified subject.
9. **CI gates**: CodeQL, secret scanning with push protection, Dependabot, dependency review,
   gitleaks, the privacy deny-list scan, `npm audit`, Trivy, `--ignore-scripts` with an allow-list.
10. **Kill switch**: disable outward writes entirely while leaving reads working.

## Out of scope

Infrastructure secrets, TLS, network policy — the deployment repository owns those · MCP tool
definitions (W06) · API route logic (W05).

## Contract

```ts
export const requireScope: (scope: Scope) => Middleware;   // no default, no wildcard
export function issueToken(scopes, expiry): { token: string; id: string };
export function verifyConfirmation(token, diffHash): boolean;

// One implementation, used by both apps/api and apps/web. Pure apart from the
// key-set fetch, so the rejection cases are ordinary unit tests.
export function verifyAssertion(jwt: string, now: Date): Principal;   // throws; never returns a fallback
```

## Definition of done

- A route with no declared scope **fails a test**. Write that test first — it is what keeps
  deny-by-default true as routes multiply.
- The assertion verifier rejects, each proven by its own test: a token signed by the wrong key · one
  with `alg: none` · one with an HMAC `alg` (the alg-confusion case, and the one a misconfigured
  provider actually produces) · a wrong `iss` · a wrong or missing `aud` · an expired one · one
  whose `exp - iat` exceeds the maximum lifetime · a `sub` outside the allow-list · a well-formed
  assertion presented alongside a bearer token.
- **Boot fails** when the configured key set is empty or holds no usable asymmetric key — the
  symptom of a provider deployed without a signing key, and the one failure that would otherwise
  look like a working system.
- **A request carrying only plaintext identity headers — no assertion — is unauthenticated.** This
  is the test that encodes the whole decision; write it beside the happy path so nobody later adds
  a "convenient" fallback without going red.
- The API rejects an unverifiable assertion **even when it arrives from the web tier**, proven by a
  test that calls the API directly.
- A read-scoped token cannot invoke any write endpoint or MCP write tool.
- A stale confirmation token is rejected, proven by a test that mutates state between dry run and
  apply.
- `log.info({ config })` and `log.error(err)` with a token in scope emit **no** secret material.
- CSP blocks inline script; sanitisation strips a script tag embedded in third-party rich text —
  test with a hostile fixture.
- CI fails on a deliberately committed fake secret and on a deliberate deny-list hit. **Test both**;
  a gate nobody has seen fail is a gate nobody knows is wired up.
- The GitHub settings checklist in [`../17-privacy.md`](../17-privacy.md#4-github-settings-checklist)
  is complete.

## Notes

- **The assertion is a bearer credential.** Put its header on the redaction deny-list beside the
  tokens, and never put it in a URL, a log line or an error message.
- **CSRF survives having no cookie of our own.** The gateway's session cookie is ambient in the
  browser, so a cross-site state-changing request still arrives authenticated. Origin checks are
  what stop it; do not conclude they are redundant.
- **Bind the confirmation token to the diff**, not to the session. A token authorising "whatever
  apply does next" is a round trip, not a control.
- The highest-risk path is an MCP agent with a write token — assume confusion rather than malice.
  The control that matters is a threshold refusal, not authentication.
- Third-party rich text is hostile input. It contains markup and content pasted from the open web,
  and it flows into rendering *and* into agent context.
- Do not bypass authentication "for local development". A development bypass is a production bypass
  that has not shipped yet.
- Re-check this workstream whenever another adds an endpoint, a tool or a connector. W14 is not a
  phase that completes.
