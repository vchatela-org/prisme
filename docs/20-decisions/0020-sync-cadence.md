# ADR-0020 · Sync every 15 minutes, in a daytime window, with a force button

**Status:** Accepted · 2026-09-15

## Context

Given a reconciler (ADR-0009), the remaining question is how often it runs. Faster feels better and
costs API quota; slower is cheaper but frustrating when you are sitting in a review waiting for
something to appear.

## Decision

| | Setting |
|---|---|
| Interval | Every **15 minutes** |
| Window | **07:00–23:00** local |
| Overnight | Nothing runs |
| Full pass | Once daily, at the first run of the window |
| On demand | Force-sync button, at any time |

The force-sync button calls `POST /sync` on the API, behind a PostgreSQL advisory lock, running
**the same reconciler library** as the scheduled job.

## Consequences

- Fifteen minutes is not a compromise: nothing here is urgent at a finer resolution, since
  priorities change at review cadence rather than continuously.
- The force button covers the one genuinely annoying case — being in a review and having just
  changed something — so there is no reason to shorten the interval.
- Calling the API rather than creating a Kubernetes Job means the web application needs **no
  cluster RBAC**. A compromised web process cannot schedule workloads.
- One code path for both triggers, so scheduled and manual runs cannot drift apart.
- The daily full pass is what detects drift the incremental path missed — reported as
  `prisme_sync_drift_objects`, and non-zero on two consecutive days means incremental sync is broken
  while appearing healthy.
- Rate limits are a non-issue at this cadence.
- An edit made at 23:30 is not reflected until morning. Acceptable, and the force button exists.

## Alternatives

**Every minute.** Near-real-time. Rejected: no benefit for weekly-cadence decisions, and it turns a
scheduled job into a service that must be watched.

**Webhooks.** Seconds of latency. Rejected as the *mechanism* — one missed event drifts forever.
Viable later as a **hint** that shortens the wait before the next run, which keeps the failure mode
harmless.

**Hourly.** Cheaper. Rejected: too slow to feel responsive during a review, and the saving is
meaningless.
