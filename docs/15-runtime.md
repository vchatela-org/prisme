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

### Optional, with defaults

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | |
| `LOG_LEVEL` | `info` | |
| `AUTH_JWKS_URL` | *discovered from the issuer* | Where signing keys are fetched. **Never taken from a request header**, whatever the proxy offers |
| `AUTH_ASSERTION_HEADER` | `X-authentik-jwt` | Header carrying the signed assertion. The default is the target proxy's name for it; prisme assumes no particular provider |
| `AUTH_ALLOWED_ALGS` | `RS256,ES256` | Asymmetric only. `none` and every HMAC variant are rejected regardless of this value |
| `AUTH_CLOCK_SKEW_SECONDS` | `60` | Tolerance on `exp` and `nbf` |
| `AUTH_ASSERTION_MAX_LIFETIME` | `24h` | Reject an assertion whose `exp - iat` exceeds this — catches a provider configured to issue long-lived tokens |
| `AUTH_JWKS_CACHE_TTL` | `10m` | Refetched early on an unknown `kid`, so key rotation does not need a restart |
| `SYNC_ENABLED` | `true` | Master switch for the reconciler |
| `SYNC_WRITE_ENABLED` | `false` | **Write freeze. Ships off** — see [`13-migration.md`](13-migration.md) |
| `SYNC_CREATE_THRESHOLD` | `0` | `apply` refuses a plan exceeding this many creates |
| `SYNC_WINDOW_START` / `_END` | `7` / `22` | Active hours, local time |
| `CAPACITY_DEFAULT_TASK_MINUTES` | `25` | Fallback when no duration is recorded |
| `CAPACITY_WINDOW_WEEKS` | `4` | Rolling window for `actual_share` |
| `SCORING_ACTIVE_METHOD` | `wsjf-balanced` | |
| `DOCTOOL_DURATION_PROPERTY` | *unset* | The document-tool property a process page carries its declared duration in. Unset leaves the duration preference order two-tier |
| `TZ` | `Europe/Paris` | Drives the sync window and all day boundaries |

`DOCTOOL_DURATION_PROPERTY` is the middle tier of the duration preference order
([`12-scoring.md`](12-scoring.md) §4). It is configuration rather than seed data for the same reason
`AUTH_ALLOWED_SUBJECTS` is: the document tool keys its properties by whatever an instance happens to
call them, and no instance's name may be compiled into this repository. Unset is not a broken
deployment — the preference order simply has two tiers, and the backfill's report says so rather
than passing a two-tier estimate off as a three-tier one.

`SYNC_WRITE_ENABLED=false` by default is deliberate. A fresh deployment that cannot write outward is
harmless; one that writes on first boot is not.

**The human authentication path holds no secret.** [ADR-0021](20-decisions/0021-verified-forward-auth-assertion.md)
resolved it as forward-auth with a *verified* assertion: prisme validates a signature with public
keys and issues no session of its own, so the earlier `OIDC_CLIENT_SECRET` and `SESSION_SECRET` are
gone rather than renamed. Nothing above needs them; if either turns up in a deployment, it is a
leftover. `AUTH_*` values are configuration, not credentials — which does not make them public, only
harmless if the process leaks them.

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

Settled by [ADR-0021](20-decisions/0021-verified-forward-auth-assertion.md): **forward-auth, with
prisme verifying the provider's signed assertion** rather than trusting the identity headers beside
it. That puts four obligations on the deployment, and three of them are silent if missed.

| # | Obligation | What happens if it is missed |
|---|---|---|
| 1 | The proxy provider for prisme has an **asymmetric signing keypair** assigned | The provider falls back to signing with the client secret and publishes an **empty JWKS** — the default, and not an error anywhere. prisme cannot verify anything and fails closed at boot |
| 2 | Its **token validity is short** — an hour is plenty, the outpost refreshes transparently | The replay window for a stolen assertion becomes the provider's default, which is a day |
| 3 | The forward-auth middleware is attached to the **UI route only**. The API and MCP route must not carry it | The outpost intercepts inbound `Authorization` headers by default and consumes the bearer token agents send, so every machine caller breaks. Human traffic loses nothing: the assertion is verified, not trusted, so an unprotected route is just as safe |
| 4 | A **default-deny network policy** on the namespace | Nothing immediately — this is defence in depth now rather than the control. Worth having; no longer load-bearing |

prisme needs the issuer, the audience and the subject allow-list as configuration (§2). It needs no
client secret and no credential of any kind for this path.

### Verified, and still to verify

Checked against the live cluster on 2026-09-15: Vault agent injection, Helm-chart PostgreSQL, and an
identity provider already serving forward-auth.

Two corrections to an earlier reading of the cluster, both measured:

- **Ingress is the proxy's own route CRD, not Gateway API.** Gateway API types are installed — the
  distribution ships them — but nothing routes through them. Assume the proxy's route object.
- **The forward-auth middleware already forwards the provider's signed ID token** alongside the
  plaintext identity headers, and a companion header carrying the **URL** of the key set, not the
  keys. ADR-0021 depends on the first and deliberately ignores the second.

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
