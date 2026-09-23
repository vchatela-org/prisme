# FUP · 2026-09-23 · The OIDC client exists, in the cluster

**Agent:** Claude · **Duration:** one session ·
**Outcome:** the deployment side of ADR-0026 is done, applied and verified

[ADR-0026](../20-decisions/0026-human-auth-via-oidc.md) was implemented and driven end to end against a fake
provider, and left exactly one thing undone: **no OIDC client existed on the deployment's identity
provider**, which is the operator's step and the only thing between the code and a working login in
the cluster ([the implementation entry](FUP-2026-09-22-oidc-human-auth.md)). This entry is that
step, plus the two facts that make it less mechanical than "register a client".

The starting state was worth measuring before changing anything: the deployment ran an image that
predated ADR-0026 entirely, its **key set was empty**, and its UI was gated by the forward-auth
outpost — so **human sign-in did not work at all**. There was no working state to preserve across
the change, which is why the sequencing below could be blunt.

## What was done

- **Registered a real OIDC client** on the identity provider and pointed the web tier at it. The
  login is in-app now; the outpost is out of the path.
- **Converted the provider from a proxy to a genuine OAuth2 provider**, which is where the two
  non-obvious facts live.
- **Patched both Vault entries** — the platform's own config entry and the web tier's — and read the
  values back rather than trusting the write.
- **Published and pinned a new image version**, whose only deployment-relevant change is the login
  flow, and **removed the forward-auth middleware** from the web route together with the callback
  route the outpost needed.
- **Verified against the live provider** rather than against the registration's own output — below.

## Decisions taken

**A public client, and the deployment's own tooling could not create one.** prisme's exchange sends
no client secret — PKCE binds the code to the verifier instead (ADR-0026 rule 4) — so the client had
to be registered **public**. The repository's OIDC registration script had only ever written
confidential clients, because the app it was written for sends its secret in the POST body and
implements no PKCE. So the script gained a client-type option (defaulting to its existing behaviour,
so that app is untouched) and a consent-flow option, and now states how to tell which shape an app
is: a token request carrying a secret is confidential; one carrying a `code_verifier` and no secret
is public. Registering the wrong one is not loud — a public client's secret check is skipped
entirely, so the app is silently unauthenticated rather than refused.

**The provider had to be deleted, not updated, and the client id changed as a result.** The provider
standing there was a proxy provider, and the registration script matches by **name**. A proxy
provider *is* an OAuth2 provider underneath, sharing one row — so aiming the script at that row
would have updated the OAuth half, left the row a proxy, and silently kept the behaviour ADR-0026
exists to escape: a key that is assigned and then wiped. Deleting the proxy removes the whole row
(Django collects parents on delete), the application survives with no provider, and the registration
repoints it. **The cost is a new client id**, so the audience changes on *both* tiers — the API
verifies the same token the web tier forwards, and its `aud` is the client id.

**The subject allow-list did not change, and that was checked rather than assumed.** Both provider
types mint `sub` from the same field with the same default, so the identifier is unchanged by the
move. Confirming it saved a step and, more usefully, would have caught a real lockout: the schema
refuses a mismatched audience at boot, but a *subject* mismatch is invisible until a login has
already succeeded at the provider and is then refused here.

**The middleware and the callback route are deleted, not disabled.** A forward-auth middleware
cannot express "this path must be reachable while unauthenticated", and the callback is exactly such
a path — leaving it on is a login loop with no error anywhere. The API route keeps no middleware
either, for the older reason: the outpost consumes the `Authorization` header agents send.

**`patch`, never `put`, on an entry that already exists.** The Vault CLI's `put` replaces the whole
entry, so on a running instance it silently drops every key not repeated — the database URL and both
integration tokens. The runbook now says so, and distinguishes the first-time path from the
update path.

## What running it exposed

Three things a plan would not have shown, all about propagation rather than registration:

1. **Vault changes reach a pod on a refresh interval, not on the write.** The Secret the
   deployment consumes had not picked the new keys up, and the image that *requires* them was about
   to roll — which would have been a crash-looping pod, not a visible config error. The sync was
   forced and confirmed before the image changed, because the failure mode is a boot refusal whose
   only clue is a variable name in a log.
2. **The registration's own output is not the verification.** The check that matters is what the
   provider's endpoints do with the values: the authorize endpoint **accepts** the exact configured
   callback with an `S256` challenge and **refuses a near-miss**, which is the one thing that proves
   the redirect URI was registered as strictly as prisme needs it to be. Both were exercised, with a
   credential-free request — no login was completed to prove the registration.
3. **The key set went from empty to one asymmetric key**, which is the whole point of the exercise
   and is a single command to check. It is also the check that would have caught the previous
   arrangement's failure, which is why it is now in the runbook's "check it came up" list.
4. **Forcing the Vault re-sync by hand blocked the next apply.** The propagation in (1) was made to
   happen *now* rather than within the refresh interval, with a one-field `kubectl patch`. That
   patch became the field manager for that field, and the deployment repository's own apply is a
   server-side apply — so it hit a field-manager conflict on a resource it had written successfully
   many times before, and the **apply failed after the API tier had already rolled**. The web tier
   was left on the old image, behind a route whose middleware had just been removed, which presents
   as a `401` from an application that has no way to authenticate anybody. Setting the field back to
   the value the apply wanted cleared it and the re-run completed. The lesson is narrow and worth
   keeping: **a hand-edit that makes a controller reconcile faster can be a landmine for the
   declarative apply that owns the same object**, and the failure lands on an unrelated resource.

The ordering is a constraint, not a preference: **the provider and the entries must change before
the image does**, or the new web tier boots without its login configuration and refuses to start.
And the apply is the last step, because removing the forward-auth middleware while the old image is
still serving is a `401` rather than a login — the middleware and the image have to change together,
which is what makes them one apply.

## The apply, and what it took

The deployment repository's manifest half — the image pin, the middleware removal and the
callback-route deletion — merged and applied, and both tiers now run the version that logs humans
in. It failed once, on finding 4 above, and the re-run completed. The two changes are one pull
request on purpose: the middleware and the image must move in the same apply, because a
forward-auth middleware left on a route whose image no longer reads an assertion is a `401` for
every request rather than a login.

## Verified after the apply

- **Both tiers rolled clean** — `0` restarts. The web tier refuses to boot without its login
  configuration, so a green rollout is itself evidence the values arrived.
- **A browser gets the login; a script does not.** Opening the app in a real browser follows
  `/` → `/auth/login` → the provider, and the provider's page reads *"Log in to continue to prisme"*,
  scoped to this client and carrying its id, the exact callback URL and an `S256` challenge. The same
  request with no browser-style `Accept` answers `401` instead — the deliberate distinction:
  sending a navigation to a login form is useful, sending an API client there is not.
- **The callback refuses rather than loops** — an unknown `state` answers `401`, with the reason in
  the log line and not on the wire.
- **The forward-auth route and its middleware are gone**, and nothing serves the outpost on this host.
- **The reconciler still works**: a frozen pass exits `0`, reports nothing to do, and refuses to
  write outward. The roll did not disturb it.
- **The API is ready**, schema version matching the binary.

## Not done

- **The login was not completed with a credential, so the round trip is verified only to the
  provider's sign-in form.** Everything up to that boundary is confirmed against the live provider —
  including three refusal paths — but the exchange, the ID-token verification and the session are
  **not** exercised end to end against the real provider by this entry, and it should not be read as
  claiming they were. The last step needs a real account, which is the owner's to give; that is one
  sign-in in a browser, and it is the only thing left.
- **Nothing about the API tier changed** — the same verifier, the same key set, the same fixed
  algorithm allow-list, the same origin check. ADR-0026 rule 5 keeps that deliberately.
- **Deployment-repository PR #1233 was closed rather than merged.** It documented the proxy
  provider's non-durable key at length and explicitly left the choice to the operator; the choice is
  now made, so its runbook section is superseded. Its still-true findings — the trigger chain, and
  that the symmetric signature is design rather than a defect — were folded into the rewritten
  deployment runbook as the *reason* prisme is not on that path, and its correction to the shared
  forward-auth script's header was kept because that script is still there for other apps.
