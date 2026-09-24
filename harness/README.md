# harness

**A local stack you can actually log into, and a script that checks the login.**

```sh
pnpm dev:db          # postgres, once (it is a daemon and outlives the stack)
./harness/up.sh      # provider + API + web tier, seeded — builds first if needed
node harness/drive.mjs
./harness/down.sh
```

Nothing here runs in CI and nothing here ships. It is a development tool, and it
is the answer to a gap this repository kept rediscovering: **ten sessions built
this, used it, and threw it away**, because it lived in the gitignored `seed/`
and each session started from nothing. What kept being lost was not the idea —
it was the details, and the details are the whole cost.

## What it is

| File | What it does |
|---|---|
| `up.sh` | kills leftovers, sources `env.sh`, seeds, starts the three processes, checks each one answers |
| `idp.mjs` | a throwaway OpenID Connect provider — `/authorize`, `/token`, `/jwks`, `/end-session`, and two deliberately bad tokens |
| `seed.mjs` | truncates the local database and loads `fixtures/` — safe to run twice |
| `drive.mjs` | drives login → provider → callback → session → a populated screen → logout, asserting every header on the way |
| `env.sh` | the environment all three processes share. Tracked, because agreeing on it is the hard part |
| `down.sh` | stops the stack, leaves PostgreSQL alone |

## What it is for

**The seam.** Every assertion `drive.mjs` makes is about an agreement between two
processes, and each of the parts passes its own unit tests while the agreement is
wrong. The one that matters most: `code_challenge` must be the S256 hash of the
`code_verifier` the application *stored*, not of one it merely sent. A unit test
around either half cannot see that, and the provider here recomputes it.

So `idp.mjs` is **strict on purpose**, and each of its refusals is something
prisme is supposed to fail against:

- the authorization code is single use — a replayed callback gets `invalid_grant`;
- `code_verifier` must match the challenge the code was issued for;
- `redirect_uri` must match the one the code was issued for;
- `state` is echoed exactly as received, so a flow that lost it is refused by the
  application rather than passing quietly.

## The traps

**Stale processes.** A stack from an earlier session keeps 9099, so the new
provider dies of `EADDRINUSE` while requests are answered by the old one — whose
keypair is different, so every token it signed is refused. That presents as *"my
change broke login"*, and the fix is to kill something that appears in none of the
logs you are reading. `up.sh` kills first, for that reason rather than tidiness.

**The provider's keypair is generated at boot.** Restarting `idp.mjs` invalidates
every token it signed — including one held in a browser. That is correct
behaviour and it is why the provider must be up *before* the API first probes the
key set: an empty JWKS makes the API fail closed, naming the issuer.

**It is not sandboxed, and it authenticates anybody who asks.** `idp.mjs` binds
to loopback and mints a token for whoever arrives. Do not expose it, and do not
point a real instance at it.

**The database is yours to start.** `up.sh` will not run `docker compose up` for
you — that daemon outlives the stack, and a script that starts a background
daemon on the way to doing something else is a script that leaves one behind.

## What it does not do

- **No outward calls.** The write freeze stays on and neither external tool is
  reachable from here; the fixtures in `fixtures/` are the only data.
- **No browser.** A browser cannot assert on a `Set-Cookie` attribute or on the
  difference between a `303` and a `401`, and those are what the checks are
  about. Use it for what it is good at — seeing a populated screen — which is a
  different question from the one `drive.mjs` answers.
- **No fixture of its own.** It seeds the same synthetic set the integration
  suites use, so a screen here and a test there cannot disagree.

## Privacy

`fixtures/` is synthetic and this directory names no real instance: the issuer and
client id are invented, the subject is `local-owner`, and the only hostnames are
loopback and `elsewhere.example.com`, which is reserved for exactly this. Keep it
that way — this file is committed, and the repository is public
([`17-privacy.md`](../docs/17-privacy.md)).
