-- 0006 · completion history, materialised capacity, and the backfill cursor
--
-- The balance factor needs observed capacity and the KPI dashboard needs
-- trends; both rest on history that exists in the task tool's completion record
-- and has never been analysed (docs/40-workstreams/W13-backfill.md). Until now
-- the only completions prisme held were in `task_mirror`, which is the *anchor
-- subtree* — everything completed outside an anchor, and everything completed
-- before prisme existed, was invisible.
--
-- Three tables, and the split between them is the design:
--
--   * `completion_history` is a **mirror of what the task tool said**, keyed by
--     the completion rather than the task. It stores the external location
--     rather than an area, because attribution is a decision prisme makes from
--     `area_mapping` and re-makes on every run — adding a mapping must
--     re-attribute years of history without re-fetching a single page.
--   * `capacity_week` is **derived and disposable**. It exists so the dashboard
--     does not aggregate years on every load, and it is replaced wholesale for
--     every week in range on each run. Dropping it costs one recomputation.
--   * `backfill_cursor` is **where the fetch got to**. A multi-year history will
--     hit a rate limit, and a run that restarts from zero each time is a run
--     that never finishes.
--
-- No new field of any external object is owned here (docs/11-ownership.md).
-- Everything in `completion_history` is the task tool's, read-only, and
-- `recorded_minutes` in particular is the tool's own measurement — prisme
-- neither writes it nor writes back the estimate it derives from it (OQ-7).
--
-- **Idempotence is the primary key, not bookkeeping.** `(external_task_id,
-- completed_at)` is the identity of a completion: a recurring task completes
-- many times under one id, and the same completion fetched twice is the same
-- row. Re-running the backfill over the same period therefore cannot
-- double-count, whatever the caller does — which is the property the definition
-- of done says matters most.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS capacity_week;
--   DROP TABLE IF EXISTS completion_history;
--   DROP TABLE IF EXISTS backfill_cursor;
--   DELETE FROM prisme_migration WHERE version = '0006';
-- Rehearsed against a throwaway database, never against the live one. Note that
-- reversing this discards the fetched history, and the next backfill must page
-- the whole range again from the task tool — slow and rate-limited, but lossless:
-- nothing here is a decision, so nothing here is unrecoverable.

-- ---------------------------------------------------------------------------
-- What the task tool said
-- ---------------------------------------------------------------------------

CREATE TABLE completion_history (
  external_task_id    text NOT NULL,
  completed_at        timestamptz NOT NULL,
  -- Where it was completed, as the tool reports it. Attribution to an area is
  -- derived from `area_mapping` on every run and deliberately not stored: a
  -- stored area_key would freeze a mapping decision into years of history.
  external_project_id text,
  external_section_id text,
  -- Minutes, and only when the tool recorded minutes.
  recorded_minutes    integer CHECK (recorded_minutes IS NULL OR recorded_minutes >= 0),
  -- The unit the tool used, kept because the two are not the same measurement.
  duration_scale      text CHECK (duration_scale IS NULL OR duration_scale IN ('minute', 'day')),
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (external_task_id, completed_at)
);

COMMENT ON TABLE completion_history IS
  'The task tool''s completion record, mirrored. Keyed by the completion, not the task: a recurring task completes many times under one id, and that key is what makes a re-run idempotent.';

COMMENT ON COLUMN completion_history.duration_scale IS
  'A day-scale duration is a calendar block-out, not a measurement of effort. It is recorded and never converted: 1440 minutes would let one all-day task outweigh a fortnight of real work.';

COMMENT ON COLUMN completion_history.external_project_id IS
  'Instance data: a real project id from a real workspace. It lives in this database and never in the repository (docs/17-privacy.md).';

CREATE INDEX completion_history_by_time ON completion_history (completed_at);

-- ---------------------------------------------------------------------------
-- Derived: per-area capacity, one row per week
-- ---------------------------------------------------------------------------

CREATE TABLE capacity_week (
  week_start        date NOT NULL,
  area_key          text NOT NULL REFERENCES area (key) ON DELETE CASCADE,
  completions       integer NOT NULL CHECK (completions >= 0),
  -- Zero for the Signals lane by design: responding to an alert is not a choice
  -- about how to spend a week (ADR-0014).
  minutes           integer NOT NULL CHECK (minutes >= 0),
  -- The duration preference order, split out so the share of capacity that
  -- rests on estimates rather than measurements is a number the UI can label
  -- rather than a caveat in a document (docs/12-scoring.md §4).
  minutes_recorded  integer NOT NULL CHECK (minutes_recorded >= 0),
  minutes_declared  integer NOT NULL CHECK (minutes_declared >= 0),
  minutes_default   integer NOT NULL CHECK (minutes_default >= 0),
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, area_key),
  CONSTRAINT minutes_are_the_sum_of_their_sources
    CHECK (minutes = minutes_recorded + minutes_declared + minutes_default)
);

COMMENT ON TABLE capacity_week IS
  'Derived and disposable. Weeks start on a Monday in UTC, matching the KPI buckets. Recomputable from completion_history at any time, and replaced wholesale for every week in range on each backfill.';

-- ---------------------------------------------------------------------------
-- Where the fetch got to
-- ---------------------------------------------------------------------------

CREATE TABLE backfill_cursor (
  id              text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  -- The oldest instant covered. A run asked to start earlier than this must
  -- fetch the gap rather than resume, or the history has a hole nothing revisits.
  covered_from    timestamptz NOT NULL,
  covered_through timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT covered_range_runs_forwards CHECK (covered_through >= covered_from)
);

COMMENT ON TABLE backfill_cursor IS
  'One row, like sync_cursor and for the same reason: two cursors would mean two answers to where the last run got to. Each slice''s completions and the cursor advance commit together (ADR-0018), so a cursor can never claim a slice whose rows were lost.';
