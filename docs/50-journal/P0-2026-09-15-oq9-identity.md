# P0 · 2026-09-15 · OQ-9 resolved: verified assertion, not trusted header

**Agent: session with cluster read access** · **Duration: one session** · **Outcome:** complete

## What was done

Analysed OQ-9 — forward-auth or per-application OIDC — against the deployment repository and the
live cluster, and closed it. Written: [ADR-0021](../20-decisions/0021-verified-forward-auth-assertion.md).
Updated: ADR-0015's open section, `OPEN.md`, the ADR index, the threat model, the runtime contract,
the W14 brief and its agent definition, `apps/api/CLAUDE.md`, `STATUS.md`.

W14 is no longer blocked, and no open question blocks a workstream.

## Decisions taken

**Forward-auth, with prisme verifying the provider's signed assertion on every request.** Neither
option as originally framed: the cluster's pattern is kept, and the trust model is not.

The reasoning, in one line: the middleware already forwards a **signed token** beside the plaintext
identity headers, so the choice was never really "trust the proxy or run our own login" — it was
"check the signature that is already in the request, or don't". Checking it removes the
fail-open property that made forward-auth the weaker option, at the cost of one provider setting and
no new infrastructure.

Nine rules in the ADR are binding on W14. The three worth repeating here:

- Identity comes **only** from the verified assertion. Plaintext identity headers are never a
  fallback — the ADR exists to stop that fallback being added later for convenience.
- The key set is fetched from **configuration**, never from the URL the proxy helpfully supplies in
  a header, and the algorithm allow-list is asymmetric-only.
- Both tiers verify. The web tier forwards the assertion to the API and the API re-checks it, so
  the web tier holds no ambient authority.

## Surprises

- **The signed assertion was already being forwarded.** The middleware's header list included it
  before this question was ever asked. OQ-9 described its own answer as "a reasonable middle path"
  without knowing the infrastructure for it was already in place.
- **The provider's signing key is optional, and defaults to absent** — which silently downgrades the
  assertion to a symmetric signature and publishes an empty key set. Measured on the existing
  configuration. Nothing reports this as a problem; an application that trusted the assertion without
  checking the algorithm would be verifying nothing. Hence the asymmetric-only allow-list, and hence
  it is obligation #1 on the deployment rather than a footnote.
- **The companion header carries a URL, not keys.** Confirmed in the outpost source. An application
  that used it would be fetching its trust anchor from the request it is trying to authenticate.
- **The proxy intercepts inbound `Authorization` headers by default.** If the API route were put
  behind the same middleware, every agent and MCP client would break — a deployment-shaped landmine
  that would have been found at the worst moment. It is now obligation #3.
- **Two earlier cluster readings were wrong**, both recorded in the runtime doc as verified: the
  ingress object type, and the implicit assumption that forward-auth means bare headers. Corrected
  in place with what was measured. A spec cited with confidence is worse than no spec.

## Follow-ups

- **Deployment repository, before W14 ships:** create the proxy provider with an asymmetric signing
  keypair and a short token validity, attach the middleware to the UI route only, keep the API route
  off it. All four obligations are tabulated in [`../15-runtime.md`](../15-runtime.md#identity-integration).
  Nothing was changed in the identity provider or the cluster during this analysis — it was read-only.
- **W14:** the verifier is one implementation shared by both apps. The rejection cases are listed in
  the brief's definition of done; write them as unit tests, including the one that asserts a
  header-only request is unauthenticated.
- **Later, if wanted:** the assertion carries a session identifier, which is what back-channel logout
  would key on. Not needed for a single user; noted so it is not re-derived.

## Specs touched

| File | Why |
|---|---|
| `docs/20-decisions/0021-…` | New. The decision |
| `docs/20-decisions/0015-…` | Its open section was the question; now points at the answer |
| `docs/20-decisions/OPEN.md`, `README.md` | OQ-9 moved to closed; index row added |
| `docs/14-threat-model.md` | Human authentication row, boundaries ① and ②, asset A3, two new control rows |
| `docs/15-runtime.md` | `AUTH_*` configuration replaces the OIDC client and session secrets; deployment obligations; ingress correction |
| `docs/40-workstreams/W14-security.md` | Unblocked; item 1 specified; verifier contract and rejection tests added |
| `.claude/agents/w14-security.md`, `apps/api/CLAUDE.md`, `STATUS.md` | Kept consistent with the above |
