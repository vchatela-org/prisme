# ADR-0015 · OIDC for humans, prisme-issued scoped tokens for agents

**Status:** Accepted · 2026-09-15

## Context

prisme has two kinds of caller with genuinely different constraints: a human in a browser, and
agents or scripts calling the API and MCP server. A self-hosted identity provider is already
available.

Agents cannot complete an interactive OIDC flow, so they need a bearer credential regardless. The
real question is **who defines its permissions**.

## Decision

| Caller | Mechanism |
|---|---|
| Human, in a browser | **The identity provider**, through a verified signed token — mechanism settled in [ADR-0026](0026-human-auth-via-oidc.md) (in-app OIDC), which supersedes [ADR-0021](0021-verified-forward-auth-assertion.md)'s forward-auth transport |
| Agents, MCP clients, scripts | **prisme-issued scoped tokens**, minted from the UI, which is itself behind the identity provider |

Tokens are Argon2id-hashed at rest, scoped, expiring, revocable, with `last_used_at` recorded and a
recognisable prefix so secret scanners can detect a leak.

**Identity belongs to the identity provider; authorization belongs to prisme.**

## Consequences

- No password handling, and session management is a solved problem.
- Tool-level scopes live where they change — adding an MCP tool is a prisme change, not an identity
  provider change.
- A read-only agent is genuinely read-only, because write scopes are separate.
- Two authentication paths to maintain and test.
- Revocation is per-application rather than central. Accepted for a single-user deployment;
  accepting provider-issued JWTs for machine identities remains available later if central
  revocation becomes worth the coupling.

## Resolved: how the browser half is implemented

This ADR originally assumed per-application OIDC. Verification after it was accepted found the
target cluster's established pattern is **forward-auth through an identity-provider proxy**, which
is a different trust model — safe only while prisme is unreachable except through the proxy. That
was tracked as **OQ-9** and it blocked W14.

Closed by **[ADR-0021](0021-verified-forward-auth-assertion.md)**: forward-auth, with prisme
**verifying the provider's signed assertion** on every request rather than trusting an identity
header. The split decided here is unchanged — identity from the provider, authorization in prisme —
and the browser half no longer depends on a network-reachability assumption.

**Corrected 2026-09-22 — the transport moved, the decision did not.** ADR-0021's obligation 1 (an
asymmetric signing keypair on the forward-auth proxy provider) turned out to be undeliverable on the
target identity provider, by that provider's design.
[**ADR-0026**](0026-human-auth-via-oidc.md) supersedes it on that point alone: prisme now runs the
OIDC authorization-code flow in the web tier, and the token it obtains is verified by the same
verifier — every rule of ADR-0021 except rule 5 survives. Note that ADR-0015's original assumption
was per-application OIDC, so this is a return to it rather than a third model.

Read [ADR-0026](0026-human-auth-via-oidc.md) for the flow and
[ADR-0021](0021-verified-forward-auth-assertion.md) for the verification rules; those are the binding
ones.

## Alternatives

**Identity provider service accounts with client credentials for agents.** Central revocation, one
mechanism. Rejected: it puts fine-grained tool scopes in the wrong system, adds a token exchange to
every agent, and couples the tool surface to identity configuration.

**No authentication, network-restricted.** Rejected: "it's only me" is how a system arrives at
having no authorization model on the day it grows a second caller — and it holds tokens to the
user's entire planning workspace.
