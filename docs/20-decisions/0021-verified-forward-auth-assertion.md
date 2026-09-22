# ADR-0021 · Trust a verified assertion, never an identity header

**Status:** Accepted · 2026-09-15 · Completes [ADR-0015](0015-auth-split-by-caller.md), closes **OQ-9**

> ⚠ **Proposed for supersession by [ADR-0026](0026-human-auth-via-oidc.md)** (2026-09-22). The
> decision below is sound about *what to trust* — a verified signature, never a header — and
> ADR-0026 keeps that. What it got wrong is *where the signature comes from*: its obligation 1 (an
> asymmetric signing keypair on the forward-auth proxy provider) turns out to be undeliverable on the
> target identity provider, by that provider's design rather than by misconfiguration. Read 0026
> before acting on the four obligations at the bottom of this file.

## Context

ADR-0015 settled *who* authenticates how — humans through the identity provider, agents through
prisme-issued scoped tokens — and left the mechanism of the human half open, because verification
found the target cluster's established pattern is **forward-auth through an identity-provider
proxy**, not per-application OIDC. That was **OQ-9**, and it blocked W14.

Verified against the live cluster and the identity provider's outpost source on 2026-09-15:

| Finding | How it was established |
|---|---|
| The gateway authenticates through a forward-auth middleware pointed at the provider's embedded outpost, and already forwards the provider's **signed ID token** upstream alongside the plaintext identity headers | Middleware definition in the deployment repository; header list confirmed against the outpost source and against the strings in the running image |
| The companion "JWKS" header carries a **URL**, not keys | Outpost source: the header is set from the provider's `jwks_uri` |
| The outpost ignores inbound identity headers — a request carrying a forged username header gets the login redirect, not a session | Measured directly against the outpost |
| Nothing stops an in-cluster caller from reaching a workload's Service **directly**, bypassing the gateway: the application namespace has no default-deny network policy | Measured |
| The existing proxy provider has **no signing keypair**, so its JWKS is empty and discovery advertises an HMAC algorithm | Measured: the JWKS endpoint returns `{}` |
| The provider's default access-token validity is long enough that the assertion's own expiry is a weak bound | Provider configuration |

So the middle path OQ-9 sketched — forward-auth, but with prisme verifying a *signed* assertion
rather than a bare header — is available with **no new infrastructure**. It is not available with
*no configuration*: a provider with no signing keypair cannot produce an asymmetrically verifiable
assertion, and that is a silent default rather than an error.

## Decision

**Forward-auth, and prisme authenticates a human by verifying the identity provider's signed
assertion on every request. It never trusts an identity header.**

Rules, stated so they can be checked against code:

1. **Identity comes only from the verified assertion.** The plaintext identity headers are ignored
   entirely — not a fallback, not a hint, not an audit field. If the assertion is absent or fails
   verification, the request is unauthenticated. There is no header path to a principal.
2. **Verification is the full set, not a signature check.** Signature against the JWKS at
   `AUTH_JWKS_URL` — configuration, *never* the URL the request hands over; `alg` restricted to an
   asymmetric allow-list, so `none` and every HMAC variant are rejected whatever the token claims;
   `iss` equal to `AUTH_ISSUER_URL`; `aud` containing `AUTH_AUDIENCE`; `exp` and `nbf` within
   `AUTH_CLOCK_SKEW_SECONDS`; `sub` present in `AUTH_ALLOWED_SUBJECTS`.
3. **An over-long assertion is rejected.** If `exp - iat` exceeds `AUTH_ASSERTION_MAX_LIFETIME`,
   the request fails closed. A provider misconfigured to issue year-long tokens is a mistake prisme
   can detect rather than inherit.
4. **The identity key is `sub`.** Username, name and email are display material. A rename must not
   silently become a different principal, and must not silently become the *same* one.
5. **prisme issues no session cookie for humans.** There is no prisme session to steal, fixate, or
   forget to invalidate. Logout belongs to the provider.
6. **Both tiers verify.** The web tier forwards the assertion it verified to the API, and the API
   verifies it again with the same implementation. The web tier is not a trusted hop and holds no
   ambient authority over the API.
7. **Machine callers are unchanged** (ADR-0015): a prisme-issued scoped token in `Authorization`.
   A request presenting **both** a valid assertion and a bearer token is **rejected**, not resolved
   by precedence — ambiguous authentication is a bug, and a precedence rule is how one caller's
   credential silently becomes another's.
8. **Deny-by-default is unchanged.** A verified human resolves to the owner principal and still
   passes through the same scope middleware as everything else. Being human is not a wildcard.
9. **No development bypass.** Local development runs the same verifier against a locally issued
   key and a development issuer. The verification path is never switched off, because a path that
   can be switched off is a path that will ship switched off.

## Consequences

- **The weakness that blocked OQ-9 is closed cryptographically.** Direct reachability stops being
  catastrophic: a caller that bypasses the gateway can forge every header it likes and still cannot
  mint a signature. Network policy becomes defence in depth instead of the control.
- **The deployment owes one provider setting**: a signing keypair on prisme's proxy provider, and a
  short token validity. Both are recorded in [`../15-runtime.md`](../15-runtime.md#6-interface-to-the-deployment-repository).
  Without the keypair the assertion is HMAC-signed with the client secret and the JWKS is empty —
  prisme fails closed, loudly, at boot rather than at a request.
- **The API route must not sit behind the forward-auth middleware.** The outpost intercepts inbound
  `Authorization` headers by default, which would consume the bearer token an agent sends. Human
  traffic does not need the middleware there anyway: the assertion is verified, not trusted, so it
  is just as safe arriving at an unprotected route.
- **CSRF is not solved by the absence of a prisme cookie.** The proxy's own session cookie is
  ambient in the browser, so a cross-site state-changing request still arrives authenticated.
  Origin checks on every state-changing request remain mandatory — W14 item 5 stands unchanged.
- **The assertion is a bearer credential in a header.** It joins tokens on the log redaction
  deny-list, and the replay window is the provider's token validity — which is why that validity is
  part of the contract rather than a detail.
- **The escape hatch stays open.** If the deployment ever moves off forward-auth, the verifier is
  standard JWT validation and survives untouched; adopting in-app OIDC would mean *adding* a login
  flow, not rewriting authorization.
- Two verification points, one implementation, and a test that must run against both.

## Alternatives

**Trust the identity headers, as everything else deployed does.** Simplest, consistent, and what
the pattern is designed for. Rejected: the workloads that pattern protects are reachable in-cluster
today, and for prisme the failure mode is silent, complete impersonation of the only user — of an
application holding read/write tokens to an entire personal workspace. The assertion is already in
the request; declining to check it would be a choice, not a saving.

**OIDC in the application, as ADR-0015 assumed.** Equivalent at the boundary, and the verification
code is the same code minus the flow. Rejected: it adds a client registration, a callback route,
session storage, refresh and logout handling, and makes prisme the only application in the cluster
with its own login — more surface for the same guarantee. Kept in reserve, and cheap to reach from
here.

**mTLS between gateway and application.** Also closes the fail-open case. Rejected: certificate
plumbing the cluster does not do today, and it authenticates the *hop* rather than the user — the
gateway would still be asserting identity in a header.

**Network policy alone, keeping bare headers.** Rejected: it is an assumption that holds until
someone adds a workload, and nothing detects the moment it stops holding. A control whose failure
is invisible is a control only in the sense that it is written down.
