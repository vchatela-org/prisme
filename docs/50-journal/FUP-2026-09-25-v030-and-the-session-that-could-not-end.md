# FUP · 2026-09-25 · v0.3.0, and the session that could not end

**Agent:** Claude · **Duration:** one session · **PR** [#89](https://github.com/vchatela-org/prisme/pull/89) · **Outcome:** complete

Asked, in one line: *the application returns "not authenticated" and does not redirect to the
provider — might something be missing?* The answer is that nothing was missing, and reaching it took
separating two things that look identical from outside.

## The finding

**The web tier's route carries no forward-auth middleware, and that is correct.** ADR-0026 moved the
human login into the web tier, so the outpost must not intercept the browser: it would gate the
callback route, which has to be reachable while unauthenticated, and the login could never complete.
The absence is the design rather than the defect. Every other route on the deployment is arranged the
same way, and the one that still carries the middleware is the one that never moved.

**The defect was a session that could not end.** The gate's own doc comment files expiry under *no
credential* — "nobody has logged in yet, **or the session has expired**" — and the code did not: every
`AssertionRejection`, expiry included, collapsed into the same `401`. The test was written to the code
rather than to the comment, so it pinned the wrong half of the distinction it exists to check.

The consequence is a dead end, and it is every session rather than an edge case: the cookie **is** the
ID token, nothing refreshes it, and the provider's access token lives an hour. The refusal is plain
text with no control on it, and the logout route is POST-only and origin-checked **by design** — a
`GET` is a `405` — so a browser sitting on that 401 has no way out but clearing cookies by hand.

Fixed: an expired assertion on a **navigation** now gets the login flow, exactly as an empty cookie
does. `expired` is deliberately the **only** reason that redirects — a wrong signature, a token that
is not a JWS, a non-allow-listed subject and an over-long lifetime all still refuse on a navigation —
so the reason stays unobservable to a caller probing with garbage, which is the property
`docs/14-threat-model.md` §5 asks for. A fetch or a server action still gets the truthful `401`.

## Surprises

**`curl` nearly sent this to the wrong layer.** The gate branches on whether the request is a
*navigation*, and `curl`'s default `Accept: */*` is not one — so it takes the refusal branch and
answers `401 not authenticated` **by design**. Read once, that looks exactly like a gateway that has
lost its middleware, which is where the first hour went. The same request with a browser-like `Accept`
is a `303` into the login flow. The tell that the application is answering and not a proxy: a
`text/plain` body carrying the application's own security headers.

**The version asked for was not the version the rule allows.** The request named a patch. Since the
last tag, `main` gained an **Accepted ADR** (0029) *and* a **`feat:` commit** — the release rule's two
minor signals — so the field was raised with the owner and cut as a minor. A patch would have labelled
an architecture decision and new behaviour as a dependency move.

## Decisions taken

**The bump is minor, not patch** — both minor signals are present, and the reason is stated in the tag
message rather than left for a reader to infer from the commit log.

**The redirect is scoped twice: to expiry, and to navigations.** Redirecting on *any* rejection would
hand a login flow to whoever probes with garbage — the outcome the gate's comment refuses — and
redirecting on a fetch would answer a question nobody asked. Both limits are asserted in the test
suite rather than left as comments.

## Follow-ups

1. **The fix is not in the cluster yet, and this is the open obligation.** The deployment still pins
   the previous version, so the dead end is still live until the pin moves. Release, then pin — the
   same fixed order the previous release had to learn, and the reason a cut version is not a
   delivered one.

2. **The session still dies at an hour.** The provider grants a refresh token that prisme never uses,
   so this release makes the end *recoverable* rather than *postponed*. Using that grant reaches into
   the threat model's "the human authentication path holds no secret", so it wants its own ADR pass
   instead of riding on the fix.

3. **A signed-out browser still has no control to press.** The logout route is POST-only and
   origin-checked by design, so a `401` page cannot offer one. This release means nobody needs one; a
   sign-out control is a UI matter and remains unowned.

## Specs touched

None. No spec diverged — the fix realigns the code with what the gate's own comment and ADR-0026's
bounded-lifetime consequence already said.
