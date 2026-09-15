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
- Built and scanned by `vchatela-org/shared-workflows/.github/workflows/docker-build-push-harbor.yml@v1`.

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

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PRISME_BASE_URL` | Public base URL, for OIDC redirects and backlinks |
| `OIDC_ISSUER_URL` | Identity provider issuer |
| `OIDC_CLIENT_ID` | |
| `OIDC_CLIENT_SECRET` | *file-mountable — see below* |
| `SESSION_SECRET` | Session cookie signing key |
| `TOKEN_PEPPER` | Additional secret mixed into API-token hashing |
| `DOCTOOL_API_TOKEN` | Document-tool integration token |
| `TASKTOOL_API_TOKEN` | Task-tool API token |

### Optional, with defaults

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | |
| `LOG_LEVEL` | `info` | |
| `SYNC_ENABLED` | `true` | Master switch for the reconciler |
| `SYNC_WRITE_ENABLED` | `false` | **Write freeze. Ships off** — see [`13-migration.md`](13-migration.md) |
| `SYNC_CREATE_THRESHOLD` | `0` | `apply` refuses a plan exceeding this many creates |
| `SYNC_WINDOW_START` / `_END` | `7` / `22` | Active hours, local time |
| `CAPACITY_DEFAULT_TASK_MINUTES` | `25` | Fallback when no duration is recorded |
| `CAPACITY_WINDOW_WEEKS` | `4` | Rolling window for `actual_share` |
| `SCORING_ACTIVE_METHOD` | `wsjf-balanced` | |
| `TZ` | `Europe/Paris` | Drives the sync window and all day boundaries |

`SYNC_WRITE_ENABLED=false` by default is deliberate. A fresh deployment that cannot write outward is
harmless; one that writes on first boot is not.

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

**prisme never reads a secret from a file it ships**, and never from a committed config file.

### External bindings

The identifiers of external databases are **instance data**, not configuration in git. They load
from the seed path into the database, keyed by role: `objectives_db`, `takeaways_db`, `media_db`,
`areas_db`, `processes_db`, `reviews_db`. See [`17-privacy.md`](17-privacy.md).

---

## 3. Database

Containerized PostgreSQL in-cluster. Stock image; no extension beyond `pgcrypto`. Nothing assumes a
managed service.

Verified against the target cluster: PostgreSQL is deployed from the **Bitnami Helm chart**, with no
database operator present. So prisme gets a connection string and nothing else — no `Cluster`
custom resource, no operator-managed failover, no automated backup hook. Two consequences worth
stating rather than discovering:

- **Backups are the deployment repository's responsibility**, and prisme is a system of record
  (ADR-0001). Confirm a backup exists before the first `apply` writes anything outward.
- **Assume a single instance.** Do not design for read replicas or failover.

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

| Role | Grants |
|---|---|
| Application | `SELECT`, `INSERT`, `UPDATE`, `DELETE`. **No DDL** |
| Migration | DDL. Used only by the migration Job |

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
to a file by the Vault agent init container · a PostgreSQL instance, its credentials **and its
backups** · the CronJob schedule and window · ingress via Gateway API `HTTPRoute` · the identity
integration (see below).

**Receives:** `/healthz`, `/readyz`, `/metrics` · exit codes (non-zero on failed reconcile) ·
structured logs on stdout · a documented schema version per image tag.

### ⚠ Identity integration is not settled

The cluster's established pattern is Authentik **forward-auth via a proxy provider** — the gateway
authenticates and passes identity headers upstream — rather than each application running its own
OIDC flow. ADR-0015 assumes the latter.

Both work; they are different trust models, and the choice affects W14 directly. Tracked as
**OQ-9** in [`20-decisions/OPEN.md`](20-decisions/OPEN.md). **Resolve before W14 starts.**

### Verified, and still to verify

Checked against the live cluster on 2026-09-15: k3s v1.36.4, Vault agent injection, Bitnami
PostgreSQL, Gateway API `HTTPRoute`, Authentik present in forward-auth configuration.

Still to confirm before W00 finalises the Dockerfiles: the exact rendered env-file path and format,
whether the registry pull secret is namespace-scoped, and the outcome of OQ-9.
