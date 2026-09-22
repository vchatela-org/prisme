# ADR-0026 · Authenticate humans in-app, over OIDC, because the proxy cannot sign asymmetrically

**Status:** Proposed · 2026-09-22 · Supersedes [ADR-0021](0021-verified-forward-auth-assertion.md)

## Context

[ADR-0021](0021-verified-forward-auth-assertion.md) settled the human half of authentication as
**forward-auth with the provider's signed assertion verified** rather than its plaintext identity
headers trusted. It put four obligations on the deployment, and the first was: *"The proxy provider
for prisme has an **asymmetric signing keypair** assigned."*

**That obligation is undeliverable on the identity provider this instance runs.** Not "hard to
configure" — there is no supported configuration that satisfies it, and the reason is a deliberate
design decision by the provider rather than a defect.

Established on 2026-09-22 against the running server, and worth recording precisely because the
first three attempts to explain it were all wrong:

| What | Evidence |
|---|---|
| A proxy provider's signing key is **nulled by design** | `providers/proxy/models.py` — `set_oauth_defaults()` contains an explicit `self.signing_key = None`, under the docstring *"Ensure all OAuth2-related settings are correct"* |
| It is **absent from the supported write surface** | `signing_key` is not in `ProxyProviderSerializer.Meta.fields`, so the API cannot set it on a proxy provider at all |
| The signature is **symmetric by design** | `providers/oauth2/models.py` — `if not self.signing_key: return self.client_secret, JWTAlgorithms.HS256` |
| The provider's maintainers say so | An open, maintainer-confirmed enhancement request records that the proxy outpost used to sign with RSA, that this was dropped for want of certificate rotation, and that *"the current JWT is signed via HS256"* |

Writing the key directly to the row does work — the key set then returns one RSA key and an assertion
verifies against it. It simply does not survive: an app-startup reconcile calls `set_oauth_defaults()`
on **every** proxy provider, and a server-side worker re-fork re-runs that reconcile on a
traffic-driven cadence. Measured: the key set and verified, then gone; twice in one day, with no
container restart and no event in the audit log. The two alibis that made this look mysterious —
`restartCount: 0`, and an unchanged pod `startTime` — were both true and both irrelevant, because the
reconcile runs inside the pod.

The practical consequence is worse than "authentication is broken". It is that authentication works
**until it doesn't**, on a cadence nobody can predict, and the failure appears two layers away — a
crashlooping pod and a failed deployment, not an identity problem.

An in-app OIDC provider is the supported surface, and the difference is empirical rather than
theoretical: another application on this cluster uses one, and **its signing key persists across
authentik restarts** while every proxy provider's is repeatedly cleared.

## Decision

**prisme authenticates humans with OIDC, in-app, against an OAuth2 provider — and keeps the verifier
it already has.**

The shape, stated so it can be checked against code:

1. **The human flow is OIDC authorization-code** in the web tier: redirect to the provider, receive a
   code on a callback route, exchange it, and establish a session.
2. **Verification is unchanged.** `packages/auth` already validates a JWT against a configured JWKS
   with a fixed asymmetric algorithm allow-list, and checks `iss`, `aud`, `exp`/`nbf` and the subject
   allow-list. An ID token is such a JWT; it flows through the existing verifier rather than a new
   one. **The security property ADR-0021 bought is kept**: identity comes from a signature verified
   against a key fetched from a configured URL, never from a header, and `none`/HMAC algorithms stay
   rejected.
3. **`AUTH_JWKS_URL` remains configuration and is still never taken from a request.** The assertion
   header disappears from the request path, but a request cannot influence the trust anchor either
   before or after.
4. **The code exchange uses PKCE.** Where the provider supports it for this client type, no client
   secret is stored, which preserves the property [`15-runtime.md`](../15-runtime.md#2-configuration-contract)
   states today — *"the human authentication path holds no secret"*. If a confidential client proves
   necessary, the secret is a Vault entry like any other and the claim is corrected rather than
   quietly weakened.
5. **The API tier still verifies independently.** The web tier is not a trusted hop; it is not one
   today and does not become one. Whatever credential the web tier presents to the API, the API
   validates it with the same implementation.
6. **Machine callers are untouched.** Scoped bearer tokens in `Authorization`, exactly as
   [ADR-0015](0015-auth-split-by-caller.md) settled. The two mechanisms remain mutually exclusive: a
   request presenting both is rejected, not resolved by precedence.

## Consequences

- **prisme now issues a session cookie, and ADR-0021 rule 5 is superseded.** That rule's value was
  real: *"There is no prisme session to steal, fixate, or forget to invalidate."* OIDC requires
  prisme to hold a session, so that sentence stops being true and the obligations it avoided become
  real work — a cookie with correct attributes, fixation resistance on the callback, a bounded
  lifetime, and a logout that actually ends the session. This is the price of the decision and it
  should not be paid quietly.
- **The web tier gains a login flow and loses nothing.** It already holds no database credential
  ([`14-threat-model.md`](../14-threat-model.md#2-trust-boundaries)); the flow adds routes, not
  authority.
- **CSRF is unchanged in kind.** ADR-0021's note stands: a cookie is ambient in the browser, so
  origin checks on state-changing requests remain mandatory. The session cookie makes them *more*
  load-bearing, not less.
- **The deployment's obligation changes shape.** Obligation 1 ("assign a signing keypair to the proxy
  provider") is replaced by "register an OIDC client and configure its issuer, audience and redirect
  URI". Only the first of those is undeliverable; the rest is ordinary registration.
- **The escape hatch closes in the other direction.** ADR-0021 kept OIDC *"in reserve, and cheap to
  reach from here"*. That is now the main path, and reverting would be the expensive move. Worth
  stating plainly: this ADR is not a retreat from verification, it is a change of *where the login
  happens*.
- **Existing deployments must be re-registered.** An instance running the forward-auth arrangement
  needs an OIDC client and a redirect URI. There is one such instance and it is read-only, so the
  migration is a configuration change rather than a data one.

## Alternatives

**Persist the proxy provider's signing key by re-assigning it on a schedule** — a CronJob that
re-runs the assignment when the key set empties. Rejected: it treats a designed behaviour as a fault,
it needs a privileged job holding database or ORM access purely to defeat a reconcile, it fails
whenever the schedule and the re-fork interleave badly, and it leaves the system one missed run from
an outage. A workaround that must never fail is a worse dependency than a supported mechanism that
does not.

**Accept the HMAC assertion, signed with the client secret.** Durable and needs no new
infrastructure, and it is what the provider offers for this provider type. Rejected: to verify an
HMAC assertion the application must hold the same secret that *mints* assertions, so the party that
checks identity becomes the party that can create it. RS256 keeps minting capability in the provider
and verification capability in the application, and that separation is worth the login flow. Note the
implementation deliberately makes this hard to do by accident — the algorithm allow-list is fixed and
a non-asymmetric value stops the process at boot — so choosing it would mean changing the decision,
not flipping a flag.

**Trust the plaintext identity headers, as every other workload on the cluster does.** Simplest,
durable, consistent with the local pattern. Rejected for the reason ADR-0021 already gave: the
application namespace is reachable in-cluster with no default-deny policy, so any workload there
could assert any identity, and this application holds read/write tokens to an entire personal
workspace. The header path is the one an attacker inside the perimeter would prefer.

**Change identity provider** — to one whose proxy provider signs asymmetrically. Rejected as
disproportionate: it replaces a working identity provider serving several applications in order to
keep a *transport* choice, when the login flow is the smaller change. Revisit only if the provider
becomes unsuitable for other reasons.

**Do nothing; keep re-assigning the key by hand.** Rejected: the observed failure is
indistinguishable from an outage to the user, it arrives without warning, and "someone remembers to
run a script" is not a control. It is also the alternative most likely to be chosen by default,
which is why it is written down.
