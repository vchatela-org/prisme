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
| Human, in a browser | **OIDC** against the identity provider — authorization code + PKCE, `httpOnly`/`Secure`/`SameSite` session cookie |
| Agents, MCP clients, scripts | **prisme-issued scoped tokens**, minted from the UI, which is itself behind OIDC |

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

## ⚠ Open: how the browser half is implemented

Verified after this ADR was accepted: the target cluster's established pattern is **forward-auth via
an identity-provider proxy** — the gateway authenticates and passes identity headers upstream —
rather than each application running its own OIDC flow.

The *decision* here stands either way: humans authenticate through the identity provider, agents use
prisme-issued scoped tokens. What is unsettled is the mechanism for the first half, and the two have
materially different trust models:

| | Forward-auth | OIDC in the app |
|---|---|---|
| prisme handles | Trusted headers | The full authorization-code flow |
| Session management | The proxy's | prisme's |
| Safe only if | prisme is **unreachable except through the proxy** | — |
| Matches the cluster | Yes, it is the existing pattern | Needs a client registration |

Header trust is simpler and consistent with everything else deployed, but it fails open if prisme is
ever reachable directly — a network-policy assumption rather than a cryptographic one.

Tracked as **OQ-9**. Resolve before W14 starts; whichever wins, this ADR gets a follow-up recording it.

## Alternatives

**Identity provider service accounts with client credentials for agents.** Central revocation, one
mechanism. Rejected: it puts fine-grained tool scopes in the wrong system, adds a token exchange to
every agent, and couples the tool surface to identity configuration.

**No authentication, network-restricted.** Rejected: "it's only me" is how a system arrives at
having no authorization model on the day it grows a second caller — and it holds tokens to the
user's entire planning workspace.
