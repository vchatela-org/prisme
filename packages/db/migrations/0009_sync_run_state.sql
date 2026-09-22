-- 0009 · what the last reconciler pass did, so a scrape can see it
--
-- docs/15-runtime.md §5 names two signals: `prisme_sync_last_success_timestamp`
-- and `prisme_sync_drift_objects`, the second of which is "the one that
-- actually matters". Neither was observable in a deployment, and the reason was
-- topological rather than a missing `set()`: the reconciler runs as a CronJob
-- pod with no Service, alive for seconds, so Prometheus never scrapes it. Its
-- gauges were set correctly and then died with the process.
--
-- ADR-0018 is the way out — **all** prisme state is in PostgreSQL, sync state
-- included — so the pass writes its outcome here and the long-lived API
-- republishes it on `/metrics`. No Pushgateway, no Service on the CronJob, no
-- second copy of the reconciler.
--
-- ## One row
--
-- The same shape and the same reason as `sync_cursor` (0003): a constant
-- primary key, so a second row cannot be inserted by a bug or a race. Two rows
-- would mean two answers to "how did the last pass go", and a gauge can only
-- publish one.
--
-- This is deliberately **not** a history table. The two metrics are latest-value
-- facts, Prometheus keeps the history once they are scrapeable, and a per-pass
-- table at a fifteen-minute cadence is a retention policy nobody asked for.
-- Per-pass detail that is worth keeping already goes to `event_log`.
--
-- ## Why this is not three more columns on `sync_cursor`
--
-- The cursor answers *where the incremental read got to* — opaque tool state,
-- written only on a pass that was allowed to write. This answers *how the pass
-- went*, is prisme's own bookkeeping, and is written by every apply pass
-- including a refused one. Same table, two lifecycles, and the next person to
-- change one would have had to reason about the other.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS sync_run_state;
--   DELETE FROM prisme_migration WHERE version = '0009';
-- Reversing this loses only the republished view of the last pass: the metrics
-- go back to being unobservable, and nothing else in the system reads the table.
-- Rehearsed against a throwaway database, never against the live one.

CREATE TABLE sync_run_state (
  id                  text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  -- The last apply pass that was not refused and did not stop part-way. NULL
  -- until one has happened, and NULL is the honest answer: a fresh deployment
  -- ships with the write freeze on, so no pass has succeeded yet.
  last_success_at     timestamptz,
  -- What the last apply pass measured. NULL means nothing has measured it,
  -- which is a different fact from zero and must reach Prometheus as a different
  -- fact: an unset gauge rendered as 0 is exactly the defect this migration is
  -- here to close.
  last_drift_objects  integer CHECK (last_drift_objects >= 0),
  last_drift_at       timestamptz,
  -- Whether that measurement came from a full pass. The spec alerts on drift
  -- "above 0 on two consecutive daily full passes", so the provenance of the
  -- number is part of reading it.
  last_drift_full     boolean,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync_run_state IS
  'One row. The reconciler pass writes its outcome here and the API republishes it on /metrics, because a CronJob pod is never scraped (docs/15-runtime.md §5).';

COMMENT ON COLUMN sync_run_state.last_success_at IS
  'Source of prisme_sync_last_success_timestamp. Advanced only by an apply pass that was neither refused nor stopped — the same definition the CronJob binary already used for its own gauge.';

COMMENT ON COLUMN sync_run_state.last_drift_objects IS
  'Source of prisme_sync_drift_objects: objects the full view found changed that the incremental stream never mentioned. A count, never an identifier — nothing instance-identifying is stored here.';
