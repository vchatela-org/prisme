# 15 · Runtime and packaging

prisme ships as containers. **This repository produces images and the contract to run them; it
contains no cluster configuration.** Deployment manifests live in a separate, private GitOps
repository.

That split is the point: this repo is public, and hostnames, secret paths and cluster topology are
not.

---

## 1. Images

| Image | Contents | Runs as |
|---|---|---|
| `prisme-web` | Next.js server | Deployment |
| `prisme-api` | Hono REST API + MCP server + in-process reconciler | Deployment |
| `prisme-sync` | Reconciler entrypoint — the same binary as the API | CronJob |

`prisme-api` and `prisme-sync` share one build. The reconciler is a library called from two
entrypoints, so the scheduled run and the force-sync button are provably the same code path — not
two implementations that drift.

### Build requirements

- Multi-stage; no toolchain, package manager or source in the final layer.
- **Non-root** user; **read-only root filesystem**; `/tmp` as the only writable mount.
- Base images pinned **by digest**, not tag.
- No shell in the runtime layer where the stack allows it.
- SBOM and provenance attestation emitted at build.
- Built and scanned in CI on every pull request, and pushed to Harbor on a `v*` tag —
  `.github/workflows/images.yml` and `.github/workflows/publish.yml`.

Built as of W00: `node:26-trixie-slim` builder, `gcr.io/distroless/nodejs26-debian13:nonroot`
runtime, both digest-pinned and watched by Dependabot. Distroless means there is no shell to exec
into and nothing to run but `node`. Node 26 is the baseline for builder, runtime and `.nvmrc`
alike — [ADR-0023](20-decisions/0023-node-26-toolchain-baseline.md), which also records why the
builder installs pnpm from npm rather than through corepack.

**Correction (W00).** An earlier version of this section named
`vchatela-org/shared-workflows/.github/workflows/docker-build-push-harbor.yml@v1` as the build path.
That workflow builds one image from `context: .` and exposes no input for the Dockerfile path or the
build target, so it cannot build a monorepo that ships two Dockerfiles which both need the
repository root as their context. `publish.yml` therefore pushes directly, emitting the SBOM and
provenance attestation itself. Moving back is a one-line change once the shared workflow grows a
`dockerfile_path` input.

### Health endpoints

| Endpoint | Checks | Used for |
|---|---|---|
| `/healthz` | Process is alive. **No dependencies** | Liveness |
| `/readyz` | Database reachable; schema version matches the binary | Readiness |
| `/metrics` | Prometheus exposition | Scraping |

`/healthz` must not touch the database. A liveness probe that fails when a dependency is down
restarts a healthy process and turns a brief outage into a crash loop.

---

## 2. Configuration contract

Every setting arrives as an environment variable and is **validated at boot by a schema that fails
fast**. A missing or malformed value stops the process with a clear message; nothing silently
defaults. A service that starts successfully with half its configuration missing fails later,
further from the cause.

Names are public; values never are.

### Required

Required **by service**, not globally. Four things load configuration — `web`, `api`, `sync` and
the migration job — and each is refused a value it has no business holding. `W` `A` `S` `M` below
mark which of them require the variable; a blank means the variable is not part of that service's
contract at all.

| Variable | W | A | S | M | Purpose |
|---|:--:|:--:|:--:|:--:|---|
| `DATABASE_URL` | | ● | ● | | PostgreSQL connection string, **application role** — DML only |
| `MIGRATION_DATABASE_URL` | | | | ● | PostgreSQL connection string, **migration role** — DDL. Used only by the pre-rollout Job |
| `PRISME_BASE_URL` | ● | ● | ● | | Public base URL, for backlinks and origin checks |
| `PRISME_API_URL` | ● | | | | Where the web tier reaches the API |
| `AUTH_ISSUER_URL` | ● | ● | | | Identity provider issuer, as it appears in the `iss` claim |
| `AUTH_AUDIENCE` | ● | ● | | | Expected `aud` — the provider client the assertion was issued for |
| `AUTH_ALLOWED_SUBJECTS` | ● | ● | | | Comma-separated allow-list of `sub` values. Empty is a boot failure, not "allow everyone" |
| `OIDC_CLIENT_ID` | ● | | | | The OIDC client the web tier logs humans in with. Also the expected `aud` of the ID token, so it must equal `AUTH_AUDIENCE` |
| `OIDC_REDIRECT_URI` | ● | | | | Absolute public URL of `/auth/callback`. Its origin must equal `PRISME_BASE_URL`'s |
| `OIDC_AUTHORIZATION_ENDPOINT` | ● | | | | Where the browser is sent to authenticate. **Configuration, never discovery** — below |
| `OIDC_TOKEN_ENDPOINT` | ● | | | | Where the code is exchanged. Configuration, for the same reason |
| `TOKEN_PEPPER` | | ● | | | Additional secret mixed into API-token hashing |
| `DOCTOOL_API_TOKEN` | | ● | ● | | Document-tool integration token |
| `TASKTOOL_API_TOKEN` | | ● | ● | | Task-tool API token |

**The web tier has no database credential.** [`14-threat-model.md`](14-threat-model.md#2-trust-boundaries)
puts the boundaries at browser → web → API → PostgreSQL, so `DATABASE_URL` is absent from its
contract rather than merely unused. Its `/readyz` asks the API whether *it* is ready.

Two variables here were not in the P0 draft and were added by W00 because the split above needs
them: `PRISME_API_URL`, and `MIGRATION_DATABASE_URL` for the role split that was already specified
in §3 but had no variable to carry it.

**The three `AUTH_*` rows gained a `W` in W14**, and the P0 draft was wrong rather than out of date:
[ADR-0021](20-decisions/0021-verified-forward-auth-assertion.md) rule 6 says *both* tiers verify —
"the web tier forwards the assertion it verified to the API, and the API verifies it again" — and a
tier that verifies needs the issuer, the audience and the subject allow-list. There is no
verification without them. This does not widen what the web process holds in any way that matters:
`AUTH_*` values are configuration rather than credentials (below), the human authentication path
holds no secret at all, and `DATABASE_URL` is still absent from the web contract, which is the
boundary [`14-threat-model.md`](14-threat-model.md#2-trust-boundaries) actually draws.

**The four `OIDC_*` rows above gained a `W` in [ADR-0026](20-decisions/0026-human-auth-via-oidc.md)**,
and they are required of **no other service**. The decision moved the human login into the web tier
— it now performs the authorization-code flow rather than inheriting an assertion from a proxy — so
the client registration belongs to the tier that runs the flow. The API still verifies a JWT it is
handed, with the same implementation and the same `AUTH_*` values (ADR-0026 rule 5), and it is
refused a client id, a callback URL and a token endpoint, because a tier that never exchanges a code
has no business holding the means to.

**The flow's two endpoints are configuration and deliberately not discovered.** OIDC normally reads
them from the issuer's `/…/openid-configuration`. prisme takes them as settings instead, and the
reason is the same one ADR-0021 rule 2 gives for the key set: a discovery document is a response
body from an external service, and
[`14-threat-model.md`](14-threat-model.md#5-application-controls) §5 classifies those as untrusted
input. Pointing a code exchange at a URL that arrived over the network is the mistake the key-set
URL is refused for, one hop along. Two URLs copied from the provider's console are validated at
boot, so a typo is a failed start rather than a failed login. **The key set is unaffected**: it is
still discovered from `AUTH_ISSUER_URL` when `AUTH_JWKS_URL` is unset, through `@prisme/auth`'s own
origin-allow-listed fetch, and the trust anchor is exactly where it was.

Two combinations are refused at boot rather than at the first login, because each is silent at the
provider and produces a login that cannot work:

- **`OIDC_REDIRECT_URI` must share an origin with `PRISME_BASE_URL`.** The session cookie is scoped
  to that origin, so a callback elsewhere would be a browser that never sends it back — a login loop
  with no error anywhere.
- **`AUTH_AUDIENCE` must equal `OIDC_CLIENT_ID` for the web tier.** An ID token's `aud` *is* the
  client id (OIDC Core §2) and prisme verifies `aud`, so a mismatch means a login that succeeds at
  the provider and is refused here, one hop from either variable, as an unexplained 401.

### Optional, with defaults

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | |
| `LOG_LEVEL` | `info` | |
| `AUTH_JWKS_URL` | *discovered from the issuer* | Where signing keys are fetched. **Never taken from a request header**, whatever the proxy offers |
| `AUTH_ASSERTION_HEADER` | `X-authentik-jwt` | The header the ID token travels in **between the two tiers** — web sets it, API reads it. The default dates from the proxy that used to inject the assertion and is kept rather than renamed; nothing outside prisme writes this header any more |
| `AUTH_ALLOWED_ALGS` | `RS256,ES256` | Asymmetric only. `none` and every HMAC variant are rejected regardless of this value |
| `AUTH_CLOCK_SKEW_SECONDS` | `60` | Tolerance on `exp` and `nbf` |
| `AUTH_ASSERTION_MAX_LIFETIME` | `24h` | Reject an assertion whose `exp - iat` exceeds this — catches a provider configured to issue long-lived tokens |
| `AUTH_JWKS_CACHE_TTL` | `10m` | Refetched early on an unknown `kid`, so key rotation does not need a restart |
| `OIDC_SCOPES` | `openid profile email` | Space- or comma-separated. **`openid` is required** — without it the provider returns no ID token, so there would be nothing to verify |
| `OIDC_END_SESSION_ENDPOINT` | *unset* | Where a logout also ends the provider's session. Unset is a working configuration; see §6 |
| `SYNC_ENABLED` | `true` | Master switch for the reconciler |
| `SYNC_WRITE_ENABLED` | `false` | **Write freeze. Ships off** — see [`13-migration.md`](13-migration.md) |
| `SYNC_CREATE_THRESHOLD` | `0` | `apply` refuses a plan exceeding this many creates |
| `SYNC_WINDOW_START` / `_END` | `7` / `22` | Active hours, local time |
| `CAPACITY_DEFAULT_TASK_MINUTES` | `25` | Fallback when no duration is recorded |
| `CAPACITY_WINDOW_WEEKS` | `4` | Rolling window for `actual_share` |
| `SCORING_ACTIVE_METHOD` | `wsjf-balanced` | |
| `AREA_COLOR_PINS` | `{}` | Area key → palette slot, JSON: `{"craft":3,"health":1}`. **Web tier only** |
| `DOCTOOL_DURATION_PROPERTY` | *unset* | The document-tool property a process page carries its declared duration in. Unset leaves the duration preference order two-tier |
| `DOCTOOL_BASE_URL` | *the vendor's public API* | The document tool's **API host**. Set it to point the client at a self-hosted deployment, a proxy or a stub |
| `TASKTOOL_BASE_URL` | *the vendor's public API* | The task tool's **API host**, for the same reason |
| `TZ` | `Europe/Paris` | Drives the sync window and all day boundaries |

`AREA_COLOR_PINS` is **instance data carried as configuration**, and it is the one optional variable
whose *keys* are. The palette has eight categorical slots and that ceiling is fixed — a ninth
generated hue is indistinguishable from an existing one under colour-vision deficiency — so an
instance with more than a handful of areas will hash two of them into the same slot; six keys
collide most of the time. The map pins each area to a slot of its own. A slot outside `1`–`8` stops
the process with the key named, because a colour the palette cannot paint is otherwise discovered
on a chart as a missing swatch. An area the map does not name keeps the key-derived fallback, so the
map is a partial answer rather than a replacement.

`DOCTOOL_DURATION_PROPERTY` is the middle tier of the duration preference order
([`12-scoring.md`](12-scoring.md) §4). It is configuration rather than seed data for the same reason
`AUTH_ALLOWED_SUBJECTS` is: the document tool keys its properties by whatever an instance happens to
call them, and no instance's name may be compiled into this repository. Unset is not a broken
deployment — the preference order simply has two tiers, and the backfill's report says so rather
than passing a two-tier estimate off as a three-tier one.

`DOCTOOL_BASE_URL` and `TASKTOOL_BASE_URL` are the **API hosts** the connectors call. They have no
default *here* on purpose: the vendor hostname lives in [`packages/connectors`](../packages/connectors/CLAUDE.md),
which is the only package that talks to either tool, and a second copy in the configuration schema
would be a second place to change. Unset therefore reaches the client as `undefined` and it applies
its own default — so naming the hostname twice is a mistake this shape cannot make.

They exist because the default cannot cover every deployment: a self-hosted instance, a proxy, or a
stub for driving the outward path locally all need the client pointed elsewhere. Before them, doing
that meant editing a constant inside the connectors.

**These are not the browser-facing hosts.** The host serving JSON is not a host a person can open a
page at, and prisme reads no page URL from either tool for exactly that kind of reason — the URL a
page carries identifies a workspace and is instance data
([`17-privacy.md`](17-privacy.md#1-the-line)). Configuration naming an API host
does not change that.

`SYNC_WRITE_ENABLED=false` by default is deliberate. A fresh deployment that cannot write outward is
harmless; one that writes on first boot is not.

**The human authentication path holds no secret — and after ADR-0026 that sentence needs stating
precisely rather than repeating.** [ADR-0021](20-decisions/0021-verified-forward-auth-assertion.md)
resolved it as forward-auth with a *verified* assertion, and the two variables that would have been
secret — `OIDC_CLIENT_SECRET` and `SESSION_SECRET` — were removed rather than renamed.
[ADR-0026](20-decisions/0026-human-auth-via-oidc.md) puts an OIDC client back in the web tier and
**keeps that property, by using PKCE**: the code exchange sends a `code_verifier` and no client
secret, so the client is public and the process holds nothing that could mint a token at the
provider. What the provider mints, prisme verifies with public keys. Neither variable returns; if
either turns up in a deployment, it is a leftover.

Three corrections to the older sentence, because it was written when prisme had no session:

- **prisme issues a session cookie now.** The ID token the provider signed *is* the session, held in
  an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`-prefixed cookie and verified on every request.
  It is a credential in the browser, and it is the reason the origin checks below became the control
  rather than belt-and-braces (ADR-0026 consequences).
- **There is no server-side session.** The web tier holds no database credential
  ([`14-threat-model.md`](14-threat-model.md#2-trust-boundaries)), and a process-local session store
  would be one that disappears when a pod restarts — so clearing the cookie *is* ending the session,
  with nothing left to invalidate (§6, logout).
- **`AUTH_*` and `OIDC_*` values are configuration, not credentials** — which does not make them
  public, only harmless if the process leaks them.

### Secret delivery

Verified against the target cluster: secrets are injected by a **Vault agent init container** that
renders a template to a file inside the pod — not by per-key Kubernetes Secrets or an external-secrets
operator. prisme must therefore support **a rendered env file**, which is the primary path:

| Mechanism | Variable | Notes |
|---|---|---|
| **Rendered env file** | `PRISME_ENV_FILE` | Path to a `KEY=value` file. Parsed at boot, **before** schema validation. The primary path in the target cluster |
| Per-secret file | `<NAME>_FILE` | Alternative, for any single value mounted on its own |
| Plain environment | `<NAME>` | Local development |

Precedence: plain environment overrides the env file, so a single value can be overridden without
re-rendering. Whichever path supplies it, the same schema validates it.

**Path and format, as built.** prisme never assumes a path — it reads whatever `PRISME_ENV_FILE`
names, which is why the cluster's actual mount point does not need to be written down here (and
must not be: [`17-privacy.md`](17-privacy.md)). The parser accepts what a Vault agent template
realistically renders: `KEY=value`, single or double quotes, `export ` prefixes, `#` comment lines
and a trailing ` # comment` on an unquoted value; `\n` and `\t` are unescaped inside double quotes.
A per-secret `<NAME>_FILE` has its trailing newline stripped, because almost every mounted secret
has one and a token that fails to compare for an invisible reason is a bad afternoon.

A line that is none of those **fails the boot** rather than being skipped. A silently ignored line
is a required secret that goes missing at the worst moment.

If `PRISME_ENV_FILE` names a file that cannot be read — the init container has not finished — the
process exits rather than starting without its secrets.

**prisme never reads a secret from a file it ships**, and never from a committed config file.

### External bindings

The identifiers of external databases are **instance data**, not configuration in git. They load
from the seed path into the database, keyed by role: `objectives_db`, `takeaways_db`, `media_db`,
`areas_db`, `processes_db`, `reviews_db`. See [`17-privacy.md`](17-privacy.md).

```
prisme-sync bindings --from <path>     load seed/bindings.json
```

The path is required rather than defaulted: the seed directory is gitignored, its mount point is
deployment detail, and a command that silently read nothing from a path that does not exist would
look like a success. The file's format is [`seed.example/bindings.json`](../seed.example/bindings.json).

**A role with no binding is not addressable**, and the connectors report it rather than guessing: a
scan says `document tool   not read`, and the backfill reports the declared-duration tier as
unavailable. That is the state of every instance that has not run the command, and it is a state
the passes handle rather than fail on.

**The command replaces the whole table.** Removing a role from the file unbinds it. A merge would
leave a role bound to a store the file no longer mentions, with no way to unbind one short of
truncating the table by hand.

---

## 3. Database

Containerized PostgreSQL in-cluster. Stock image; no extension beyond `pgcrypto`. Nothing assumes a
managed service.

Verified against the target cluster: PostgreSQL is deployed from a **plain Helm chart**, with no
database operator present. So prisme gets a connection string and nothing else — no `Cluster`
custom resource, no operator-managed failover, no automated backup hook. Two consequences worth
stating rather than discovering:

- **Backups happen outside this application entirely** — see below. Nothing here creates, schedules
  or verifies one.
- **Assume a single instance.** Do not design for read replicas or failover.

### Backups — outside the application

Settled by [ADR-0022](20-decisions/0022-backups-belong-to-the-deployment-repository.md).
**Backup and restore belong to the GitOps deployment repository. prisme ships no backup capability.**

| Question | Answer |
|---|---|
| **Mechanism** | A scheduled dump **CronJob in the deployment repository**, one per stateful application — the pattern that repository already uses for its other databases. prisme is another row in it, not a special case |
| **Owner** | The deployment repository, for the schedule, retention, off-cluster copy and monitoring |
| **In this repository** | Nothing. No `pg_dump`, no dump-to-storage client, no backup entrypoint, no `/backup` route, no MCP tool, no button. A grep for `pg_dump` here returns nothing — if it ever does, that is the bug |
| **prisme's obligation** | Stay restorable: all state in PostgreSQL (ADR-0018), no volume, no local files, forward-only migrations with a written reversal, a documented schema version per image tag |

So there is no backup metric, no `/readyz` check and no UI warning about backup age. The application
cannot know, deliberately — it holds no credential that could look.

**The one gate.** Before the write freeze is lifted for the first time (`SYNC_WRITE_ENABLED=true`,
[`13-migration.md`](13-migration.md#5-sequence) step 8), a restore must have been **rehearsed once**
— not merely scheduled. That is a human checklist item owned by the deployment repository; prisme
does not enforce it, cannot detect it, and refuses nothing on its account. It blocks no workstream
here: P0 and P1 write nothing outward regardless, and the infrastructure work can land at any point
before that step.

A dump is the full private instance in one file. It is `seed/`-class data
([`17-privacy.md`](17-privacy.md)) — it lives off-cluster, and it is never an input to a test, a
fixture or a journal entry.

### Migrations

Run as a **Job before rollout**, never on application start.

- Two replicas starting simultaneously must never race on schema changes.
- A failed migration must block the rollout, not produce a half-migrated cluster serving traffic.
- `/readyz` compares schema version to the binary's expectation, so a version skew is visible rather
  than mysterious.

Forward-only. Each migration has a written-down reversal procedure, tested at least once, rather
than an auto-generated `down` nobody has run.

**Data imports are ordinary migrations.** Seeding the link table from a pre-existing external-ID
mapping ([`13-migration.md`](13-migration.md), Guard 4) belongs here — it is deterministic, needs to
run exactly once, and benefits from the same ordering guarantees as schema changes.

### Roles

| Role | Grants | Reaches it through |
|---|---|---|
| Application | `SELECT`, `INSERT`, `UPDATE`, `DELETE`. **No DDL** | `DATABASE_URL` |
| Migration | Owns `public`; `CREATE` on the database so it can install a *trusted* extension. Used only by the migration Job | `MIGRATION_DATABASE_URL` |

Neither role is a superuser. `CREATE` on the database is what lets the migration role install
`pgcrypto`, which PostgreSQL has marked trusted since 13 — without it, `CREATE EXTENSION` needs a
superuser and the migration Job cannot be the thing that runs it.
`packages/db/sql/roles.example.sql` is the reference the deployment repository adapts; the
development equivalent runs automatically under `docker compose`.

Neither role is the backup's role. That workload has its own credential in the deployment
repository, and prisme holds no part of it ([ADR-0022](20-decisions/0022-backups-belong-to-the-deployment-repository.md)).

### State

**All state is in PostgreSQL** — including the incremental sync token, change watermark,
`last_applied` values and conflict ledger. No persistent volume, no local files.

This matters more than it looks: state on a volume means a single-writer deployment, a restore
procedure, and a sync token that can silently diverge from what the database believes. In PostgreSQL
it participates in transactions, and any replica can take over mid-stream.

---

## 4. Scheduling

The reconciler runs on a schedule **and** on demand, from the same code.

| Trigger | Mechanism |
|---|---|
| Scheduled | CronJob, `prisme-sync`, every 15 minutes within the active window |
| On demand | `POST /sync` on the API, behind a PostgreSQL advisory lock |

The force-sync button calls the API, not Kubernetes. The web application therefore needs no cluster
RBAC — it cannot create Jobs, and a compromised web process cannot schedule workloads. The advisory
lock prevents a manual run from overlapping a scheduled one.

CronJob expectations: `concurrencyPolicy: Forbid`, a starting deadline, an active deadline, and
bounded history. Exact manifests live in the GitOps repository.

---

## 5. Observability

### Metrics

| Metric | Type | Alert |
|---|---|---|
| `prisme_sync_last_success_timestamp` | gauge | Older than 2 windows during active hours |
| `prisme_sync_duration_seconds` | histogram | — |
| `prisme_sync_actions_total{type}` | counter | `create` above threshold outside adoption |
| `prisme_sync_conflicts_total` | counter | Reviewed weekly, not alerted |
| `prisme_sync_drift_objects` | gauge | Above 0 on two consecutive daily full passes |
| `prisme_external_requests_total{tool,status}` | counter | Sustained `429` or `5xx` |
| `prisme_auth_failures_total{reason}` | counter | Unusual rate |

`prisme_sync_drift_objects` is the one that actually matters: it is the daily full pass reporting
what the incremental path missed. Persistent non-zero drift means incremental sync is broken while
appearing to work.

### Logging

Structured JSON, one event per line, with a run ID correlating every action in a reconciler pass.
Redacting by deny-list at the serializer, so a token cannot be logged even by an unwise
`log.info({ config })`.

---

## 6. Interface to the deployment repository

What the GitOps repository must supply, and what it gets back:

**Supplies:** the images and their tags · every required environment variable, with secrets rendered
to a file by the Vault agent init container · a PostgreSQL instance and its credentials · **its
backups, as a dump CronJob owned there** (ADR-0022 — this repository supplies no part of it) · the
`prisme-sync` CronJob schedule and window · ingress, through the proxy's own route object · the
identity integration (see below).

**Receives:** `/healthz`, `/readyz`, `/metrics` · exit codes (non-zero on failed reconcile) ·
structured logs on stdout · a documented schema version per image tag · a database that is safe to
dump and restore as a whole, because nothing lives outside it.

Two CronJobs, two owners, and they are unrelated: `prisme-sync` runs prisme's reconciler from an
image this repository builds; the backup CronJob runs a stock PostgreSQL client against the same
database and knows nothing about prisme. Do not merge them, and do not give prisme's image the
backup's credential.

### Identity integration

Settled by [ADR-0026](20-decisions/0026-human-auth-via-oidc.md), which supersedes
[ADR-0021](20-decisions/0021-verified-forward-auth-assertion.md) on one point. **prisme authenticates
humans in-app over OIDC**: the web tier redirects the browser to the provider, receives a code on
`/auth/callback`, exchanges it with PKCE and verifies the ID token it gets back — with the verifier
that was already there, against the same configured JWKS and the same fixed asymmetric allow-list.
What did **not** change is the part that matters: identity comes from a signature verified against a
key fetched from a configured URL, never from a header, and `none`/HMAC stay rejected.

The shape, so the deployment knows what it is standing up:

| | |
|---|---|
| **What runs** | The login flow is in `prisme-web`. `prisme-api` keeps verifying a JWT and gains nothing |
| **Routes** | `/auth/login`, `/auth/callback`, `/auth/logout` — all on the web tier, none on the API |
| **Session** | The ID token, in a `__Host-prisme_session` cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`. **No server-side session and no refresh path**, so the session cannot outlive the token's own `exp` |
| **What the API sees** | The same token in the assertion header, verified again by the API (ADR-0026 rule 5). The session cookie is stripped from the forwarded request |
| **What prisme holds** | No client secret. PKCE means the client is public (§2) |

That moves the deployment's obligations from four to five, and **obligation 1 is a different kind of
thing from what it replaced** — it is ordinary registration rather than a provider setting that may
be undeliverable:

| # | Obligation | What happens if it is missed |
|---|---|---|
| 1 | An **OIDC client is registered** for prisme, with the redirect URI `<PRISME_BASE_URL>/auth/callback`, and **a signing keypair exists on that application's provider** | The keypair half is the one that does not fail loudly at the provider: without it the JWKS is empty, prisme cannot verify anything, and it fails closed with a message naming the issuer (`@prisme/auth`'s boot check). The registration half is loud — the provider refuses the redirect |
| 2 | The client's **ID-token validity is short** — an hour is plenty | The replay window for a stolen token becomes the provider's default, which is a day. The session cookie has no lifetime of its own, so this **is** the session's lifetime |
| 3 | **No forward-auth middleware on the API or MCP route.** Ingress goes through the proxy's own route object as before | Under ADR-0021 the outpost consumed the `Authorization` header agents send; that obligation is unchanged in kind. What is gone is the requirement that the UI route carry the middleware at all — the browser now authenticates against the provider directly, so the UI route needs only ordinary ingress |
| 4 | The **issuer, audience and subject allow-list** are configured, plus the four `OIDC_*` values (§2) | The audience must equal the client id, and the configuration schema refuses the pair at boot rather than after a successful login |
| 5 | A **default-deny network policy** on the namespace | Nothing immediately — defence in depth rather than the control. Worth having; not load-bearing |

prisme needs no client secret and no credential of any kind for this path (§2).

### Logout, and what it does not do

`POST /auth/logout` clears the session cookie and ends prisme's session completely — the cookie *is*
the session, so there is no server-side row to leave behind and nothing to invalidate. It is
origin-checked like every other state change, and it is reachable without a session on purpose, so a
user whose cookie no longer verifies can throw it away.

**It does not end the provider's session unless `OIDC_END_SESSION_ENDPOINT` is set.** Without that
setting, prisme clears its own session and says so; because the provider's session is still alive,
the next visit walks the login flow and returns without a prompt. That is a real difference and worth
configuring for: **set `OIDC_END_SESSION_ENDPOINT`** if the point of logging out is to be logged
out. The login flow is driven server-side, so the endpoint is also the only place a user is sent off
this origin.

### Verified, and still to verify

Checked against the live cluster on 2026-09-15: Vault agent injection, Helm-chart PostgreSQL, and an
identity provider already serving forward-auth.

Two corrections to an earlier reading of the cluster, both measured:

- **Ingress is the proxy's own route CRD, not Gateway API.** Gateway API types are installed — the
  distribution ships them — but nothing routes through them. Assume the proxy's route object.
- **The forward-auth middleware already forwards the provider's signed ID token** alongside the
  plaintext identity headers, and a companion header carrying the **URL** of the key set, not the
  keys. ADR-0021 depended on the first and deliberately ignored the second; ADR-0026 makes both
  irrelevant, because the token now arrives through a flow prisme runs itself. The measurement is
  kept because it is what the two superseded alternatives were weighed against.

**Now verified against the live cluster — the client registration, 2026-09-23.** An OIDC client is
registered on the deployment's identity provider, the web tier is pointed at it, and the
forward-auth arrangement it replaced is gone. What was checked is the provider's *behaviour* rather
than its configuration output: the authorize endpoint accepts the configured callback with an
`S256` challenge and refuses a near-miss, and the key set went from empty to one asymmetric key —
the condition whose absence the replaced arrangement could not report at all. The flow itself was
verified earlier end to end against a locally running fake provider (`seed/harness/`, gitignored) —
real redirects, real cookies, a real PKCE exchange and a real signature check. Neither repository
points at a real provider's endpoints ([`17-privacy.md`](17-privacy.md)); the one deployment-specific
fact that moved — a **new client id**, because a proxy provider cannot be converted to an OAuth2 one
in place — is recorded in
[the entry](50-journal/FUP-2026-09-23-oidc-in-the-cluster.md) rather than in this repository.

**Closed by W00 — the rendered env-file path and format.** It turned out not to need confirming:
prisme reads whatever path `PRISME_ENV_FILE` names and hardcodes none, so the cluster's mount point
is the deployment's business and stays out of this public repository. The format is handled by
accepting everything a Vault agent template plausibly emits and refusing anything else loudly (§2,
*Secret delivery*).

**Still open — the registry pull secret.** Whether it is namespace-scoped is a question for the
deployment repository. It gates nothing here: this repository builds and pushes images, and pulling
them is the cluster's side of the contract.

### How the runner and the migration Job are invoked

The commands, so the deployment repository does not have to read a Dockerfile:

| What | Command |
|---|---|
| API (the image default) | `node /app/dist/main.js` |
| Reconciler, one pass | `node /app/sync/main.js` |
| Migration Job, before rollout | `node /app/node_modules/@prisme/db/dist/bin/migrate.js` |
| Migration status, no changes | `… /migrate.js --status` — exit 0 when the schema matches the image |

`prisme-sync` is the same image as `prisme-api` with the command overridden. Running the migration
command is the *only* way migrations are applied; no application start-up path calls it.
