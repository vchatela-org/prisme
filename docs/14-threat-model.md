# 14 · Threat model

prisme is single-user and self-hosted. It is also, in one process, holding API tokens to the
complete personal planning history of the person running it. That combination deserves a real
threat model rather than "it's just a personal app".

**Scope split.** Infrastructure security — secret storage, network policy, TLS termination,
cluster hardening — belongs to the deployment repository. This document covers everything *above*
that line: what the application itself must do.

---

## 1. Assets

Ordered by what an attacker would want most.

| # | Asset | Why it matters | Impact if lost |
|---|---|---|---|
| A1 | **External API tokens** (document tool, task tool) | Full read/write over the user's entire planning workspace, outside prisme's control | Severe, and not contained by shutting prisme down |
| A2 | **prisme API / MCP tokens** | Programmatic access to everything prisme holds and can write outward | High |
| A3 | **Human session credentials** — the gateway's session cookie and the signed assertion derived from it | Impersonation in the UI | High |
| A4 | **The personal data itself** | Goals, health and relationship context, finances, schedule. Highly sensitive in aggregate | High, irreversible — disclosure cannot be undone |
| A5 | **The event log** | A behavioural time series: when the user works, what they avoid | Moderate; uniquely revealing |
| A6 | **Database credentials** | Everything above, at rest | High |

A1 is the asset that makes this more than a personal app: a stolen external token remains useful
long after prisme is turned off, and its blast radius is the user's whole workspace.

A4 deserves a note of its own. This is not commercial data. It is health, relationships and money,
recorded over years, with enough structure to be trivially summarised. Aggregation *is* the harm.

## 2. Trust boundaries

```
  Browser ──①──► web ──②──► API ──③──► PostgreSQL
                            │
  MCP client ──④────────────┤
                            ├──⑤──► document tool  (external SaaS)
  Scheduled job ──⑥─────────┘──⑤──► task tool      (external SaaS)
                            ▲
                         ⑦ secrets, from the deployment's store
```

| # | Boundary | Primary risk |
|---|---|---|
| ① | Untrusted browser → web | XSS, CSRF, assertion theft and replay |
| ② | Web → API | Missing authorization. **The web tier is not a trusted hop** — the API re-verifies the assertion rather than believing the identity the web tier reports |
| ③ | API → database | Injection, over-privileged database role |
| ④ | **MCP client → API** | An agent performing destructive writes — highest-risk path |
| ⑤ | API → external SaaS | **Responses are untrusted input.** Also SSRF, token leakage |
| ⑥ | Job → API/database | Long-lived credential with no human in the loop |
| ⑦ | Secret store → process | Secrets reaching logs, traces or error messages |

Boundary ⑤ is counter-intuitive and gets missed: data arriving *from* the user's own document tool
is not trusted input. It contains markup, arbitrary URLs and content pasted from the open web, and
it flows straight into rendering and into agent context.

---

## 3. Authentication and authorization

Split by caller, because the two have genuinely different constraints.

| Caller | Mechanism |
|---|---|
| Human, in a browser | The self-hosted identity provider, in front of prisme. prisme **verifies the provider's signed assertion on every request** — signature, issuer, audience, expiry, lifetime and subject allow-list — and trusts no identity header. No prisme session cookie ([ADR-0021](20-decisions/0021-verified-forward-auth-assertion.md)) |
| Agents, MCP clients, scripts | **prisme-issued scoped tokens**, minted from the UI (which is itself behind the identity provider) |

A request presenting both credentials is rejected rather than resolved by precedence.

### Why the assertion is verified rather than trusted

The deployment authenticates humans at the gateway and forwards identity upstream. Trusting those
headers would make prisme's security a **network-reachability assumption**: anything that could
reach the application directly, bypassing the gateway, could assert any identity — silently, and
completely, for an application holding read/write tokens to an entire personal workspace. The
gateway already forwards the provider's *signed* token beside the plaintext headers, so verifying
it costs nothing and removes the assumption. Full reasoning and the verification rules:
[ADR-0021](20-decisions/0021-verified-forward-auth-assertion.md).

Two consequences that are easy to get wrong:

- **CSRF is still live.** The absence of a prisme cookie does not help — the gateway's own session
  cookie is ambient in the browser, so a cross-site state-changing request arrives authenticated.
  Origin checks on state-changing requests are mandatory.
- **The assertion is a bearer credential.** It belongs on the log redaction deny-list beside the
  tokens, and its replay window is the provider's token validity.

### Why authorization stays in prisme

Agents cannot complete an interactive login flow, so they need a bearer credential regardless. The
question is who defines its permissions. Keeping tool-level scopes in prisme is deliberate: they are
prisme's domain, they change whenever a tool is added, and pushing them into the identity provider
would make every new MCP tool an IdP configuration change. Identity belongs to the IdP;
authorization belongs to the application.

Accepting IdP-issued JWTs for machine identities stays available later, if central revocation
becomes worth the coupling.

### Token rules

- Argon2id-hashed at rest; the plaintext is displayed exactly once, at creation.
- **Scoped** — `read:focus`, `write:initiative`, `admin:settings` — with no implicit wildcard.
- Expiring by default; `last_used_at` recorded so stale tokens are visible.
- Revocable individually and in bulk.
- A recognisable prefix so secret scanners can detect a leak.

### Authorization

**Deny by default.** Every route declares its required scope; a route without one fails closed and
fails a test. There is no ambient authority anywhere, including for the single user — "it's only me"
is how a system ends up with no authorization model at the moment it grows a second caller.

---

## 4. The MCP surface

The sharpest edge in the system. An agent with a write token and a confused plan can restructure a
real backlog, and it will do it faster than a human can interrupt.

- **Read tools are open** within their scope.
- **Every write tool is dry-run by default.** It returns a diff and takes no action.
- Executing requires a **confirmation token** returned by the dry run, bound to that exact diff and
  short-lived. A stale or mismatched token is rejected — so an agent cannot confirm a plan it has
  not actually seen, and cannot replay one after the underlying state has moved.
- Write scopes are separate from read scopes, so a read-only agent is genuinely read-only.
- Every MCP-initiated write lands in the event log with the token identity as actor.

This is the same `plan` / `apply` split the reconciler uses ([`16-sync.md`](16-sync.md)), for the
same reason: the system should be incapable of large unreviewed changes, rather than merely
unlikely to make them.

---

## 5. Application controls

| Risk | Control |
|---|---|
| Injection | Parameterized queries only, via the query builder. No string-built SQL; lint-enforced |
| XSS | Strict CSP with per-request nonces. No raw HTML injection of third-party content. Rich text from the document tool is sanitised through an allow-list, never a deny-list |
| CSRF | Origin checks on every state-changing request. prisme sets no session cookie, but the gateway's is ambient in the browser, so the check does the work |
| Identity spoofing | Identity is read **only** from a verified signed assertion. Plaintext identity headers are never a fallback, and a direct connection that bypasses the gateway authenticates nothing |
| SSRF | Content from external tools contains arbitrary URLs. Nothing fetches a URL originating in user or third-party data without an allow-list |
| Untrusted input | One Zod schema per boundary, parsed before any other code sees the value — including **responses from external APIs** |
| Secret leakage | Redacting logger with a deny-list; no secrets in errors, traces, URLs or query strings |
| Over-privileged database role | Application role has DML only; DDL belongs to the migration job's separate role |
| Rate limiting | Per-token limits on the API; backoff and jitter on outbound calls |
| Mass assignment | Explicit field allow-lists on every write path; never spread a parsed body into an update |

### Least privilege outbound

The document-tool integration is granted access to **only** the databases it needs, at the narrowest
capability each requires:

| Role key | Access |
|---|---|
| `processes_db`, `media_db`, `areas_db` | **read-only** |
| `takeaways_db` | read-only |
| `objectives_db` | read/write — prisme owns specific fields |
| `reviews_db` | write — review summaries |

Read-only wherever prisme owns nothing is not a formality: it is the difference between a bug
corrupting a field and a bug corrupting an archive.

Both tokens are rotatable without a redeploy, and a kill switch disables outward writes entirely
while leaving reads working.

---

## 6. Supply chain

| Control | Notes |
|---|---|
| CodeQL | Default setup, enabled at repository level |
| Secret scanning + **push protection** | Blocks credentials *before* they reach public history |
| Dependabot | Alerts, security updates, version updates |
| Dependency review | On pull requests |
| `gitleaks` | CI **and** pre-commit — catches it locally first |
| `npm audit`, Trivy | Gate the build; Trivy also scans the images |
| `--ignore-scripts` | With an explicit allow-list for packages that genuinely need one |
| Pinned lockfile, pinned base image digests | Reproducible builds |
| SBOM + provenance attestation | Emitted at build |

## 7. Privacy as a security property

The repository is public. Credential leakage is covered above; **personal-content leakage has no
automated equivalent** and is the more likely failure. Rules and enforcement:
[`17-privacy.md`](17-privacy.md).

The highest-risk moment is an agent debugging against live data and writing a real record into a
committed journal entry or test fixture. It is called out in every workstream brief for that reason.

## 8. Explicitly out of scope

| Not covered | Why |
|---|---|
| Multi-tenancy, per-user isolation | Single owner by design. Revisit before a second user, not after |
| Infrastructure secret management, TLS, network policy | Deployment repository |
| Database backup, restore, retention and dump storage | Deployment repository, as a dump CronJob — [ADR-0022](20-decisions/0022-backups-belong-to-the-deployment-repository.md). prisme ships no backup capability and holds no credential for one |
| Availability and DoS | Internal service, no public ingress. Data loss is the concern, not uptime |
| Compromise of the external SaaS providers | Accepted. Limited by token scope and rotation |
| Physical access to the cluster | Deployment repository |

## 9. Review triggers

Revisit this document when any of the following happens — not on a calendar:

- a new external integration is added;
- the MCP tool surface grows a new write capability;
- anything becomes reachable from outside the local network;
- a second user or a shared instance is considered;
- an incident occurs, however small.
