# FUP · 2026-09-23 · The human login completes, in the cluster

**Agent:** Claude · **Duration:** one session ·
**Outcome:** the last operator step of ADR-0026 is closed — a real account completed the round trip

[The preceding entry](FUP-2026-09-23-oidc-in-the-cluster.md) registered the client, converted the
provider and applied the deployment, and then stopped on purpose at one boundary: **the round trip
was verified *to* the provider's sign-in form and no further**, because completing it needs a real
account — the owner's to give, not an agent's. That sign-in has happened, and the browser came up in
the application. This entry records what it proves, and what it does not.

## What was done

- The owner signed in at the deployment's host with a real account.
- The result was read back **from the outside** rather than from the login's own success: the web
  tier's log, the edge's request log, and the same routes' answers before and after the callback.

## What the sign-in proves

**The callback's line is not a courtesy log.** `login accepted` is written only after the pending
flow's state matched, the authorization code was exchanged with the PKCE verifier, and the ID token
verified against the live key set — signature, fixed algorithm allow-list, issuer, audience and the
**subject allow-list** — and the session cookie was set. That is every step the preceding entry left
to the credential, including the one that would otherwise stay untested: a subject the allow-list
refuses is refused *there* and nowhere earlier, so an identity mismatch is invisible until a login
has already succeeded at the provider. An identity that is real is the only thing that exercises it.

**The session is consumed, not merely issued** — the half a "login succeeded" message cannot show,
and it is visible at the edge as a **contrast**. Before the callback, a navigation to `/` answered
`303` to `/auth/login`: the middleware's gate refusing an unauthenticated browser. After it, `/` and
then every screen — `/backlog`, `/inbox`, `/areas`, `/timeline`, `/kpi`, `/objectives`, `/review`,
`/adoption` — answered `200`. The gate verifies the cookie on each request with the same verifier the
API uses, so those answers are verified assertions rather than a rendered shell that discovers one
fetch later that it has nothing to render.

**The refusal paths still refuse, against the live edge.** A credential-free callback probe answered
`401`, with the reason in the log and nothing on the wire, and the API tier logged no refusal during
the session. The one-shot behaviour is unchanged: a callback with no pending flow is refused rather
than bounced back into the flow, which is what keeps a systematic problem diagnosable instead of an
endless loop.

## What it does not prove

- **Nothing about authorization.** A completed sign-in says the identity is *verified*; which roles
  it holds and which areas it may act on is a separate question, untouched by this entry.
- **No write went outward.** The frozen pass was configured off throughout and behaved as the
  preceding entry recorded; lifting the freeze is still a human's gate
  ([`13-migration.md`](../13-migration.md#5-sequence), step 8).
- **The document-tool half of the read path is unchanged and still unreachable** — nothing loads the
  role bindings, so the scan runs on the task tool alone. Unrelated to login, and no better for it.

## Follow-ups

- **The screens have now been served a session for the first time.** They were built and driven
  against fixtures and a fake provider; reading a browser console on them with a real identity is
  the cheap way to either confirm or clear the two CSP violations recorded in
  [the OIDC follow-up](FUP-2026-09-22-oidc-human-auth.md) — they arrived exactly this way, and are
  still open.
- **Nobody has watched a session expire.** Its lifetime is the ID token's `exp` (ADR-0026 rule 2)
  and there is no refresh path, so the observable is a return to the login form. Worth knowing
  before a session is lost mid-task, because the failure looks like the application forgetting.

## Specs touched

[`15-runtime.md`](../15-runtime.md) — its "verified against the live cluster" paragraph now covers
the completed round trip rather than only the registration. The specs described the flow correctly;
what moved is only how far it has been run.
