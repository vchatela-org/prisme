# W14 · Security and authentication

**Depends on:** W00 · **Wave:** 2
**Files you may touch:** `apps/api/auth/**`, `apps/web/middleware.ts`, `.github/workflows/**`, security configuration

## Why

prisme holds tokens to an entire personal workspace across two external services, and the repository
is public. Security lands **with** the foundations rather than after — retro-fitting deny-by-default
onto forty existing routes does not happen.

## Read first

- [`../14-threat-model.md`](../14-threat-model.md) — the whole document
- [ADR-0015](../20-decisions/0015-auth-split-by-caller.md) — why authorization stays in prisme
- [`../17-privacy.md`](../17-privacy.md) — you own the CI enforcement

## Scope

1. **OIDC for humans**: authorization code + PKCE against the identity provider. Session cookie
   `httpOnly`, `Secure`, `SameSite=Lax`. Refresh and logout, including provider-initiated logout.
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
8. **Rate limiting**: per token and per session.
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
```

## Definition of done

- A route with no declared scope **fails a test**. Write that test first — it is what keeps
  deny-by-default true as routes multiply.
- A read-scoped token cannot invoke any write endpoint or MCP write tool.
- A stale confirmation token is rejected, proven by a test that mutates state between dry run and
  apply.
- `log.info({ config })` and `log.error(err)` with a token in scope emit **no** secret material.
- CSP blocks inline script; sanitisation strips a script tag embedded in third-party rich text —
  test with a hostile fixture.
- CI fails on a deliberately committed fake secret and on a deliberate deny-list hit. **Test both**;
  a gate nobody has seen fail is a gate nobody knows is wired up.
- The GitHub settings checklist in [`../17-privacy.md`](../17-privacy.md#github-settings-checklist)
  is complete.

## Notes

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
