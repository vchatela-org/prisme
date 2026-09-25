-- 0010 · the last *full* pass's drift, so §5's rule can be expressed at all
--
-- docs/15-runtime.md §5 alerts on `prisme_sync_drift_objects` being "above 0 on
-- two consecutive daily full passes". The gauge that exists carries the last
-- pass's measurement of *any* kind, and the reconciler runs every fifteen
-- minutes against a daily full pass — so on a healthy instance it is 0 for
-- almost every sample, and `min_over_time(prisme_sync_drift_objects[48h]) > 0`
-- is false even when two consecutive full passes both drifted: the incremental
-- samples between them reset the minimum. The rule is right and only its
-- expression was missing (FUP-2026-09-24-drift-provenance-decision).
--
-- So the last full pass's drift gets its own column and its own gauge,
-- `prisme_sync_drift_full_objects`, which the API republishes continuously from
-- this row. Republishing is what makes it work: the gauge carries samples
-- *across* the incremental passes in between, so a windowed minimum means
-- "every full pass in the window" rather than "the last one".
--
--   min_over_time(prisme_sync_drift_full_objects[48h]) > 0
--
-- Labelling the existing gauge was rejected: a labelled series carries samples
-- only in the minutes after a full pass, so the same expression would mean
-- "the last one" rather than "two consecutive". Widening the window was
-- rejected because the cadence is not the defect.
--
-- Additive and forward-only: a new nullable column, no backfill. NULL means no
-- full pass has ever recorded one, which is a different fact from a full pass
-- that found no drift — the distinction `last_drift_objects` already carries,
-- for the same reason (an unset gauge rendered as 0 is how the alert came to be
-- unable to fire).
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE sync_run_state DROP COLUMN IF EXISTS last_drift_full_objects;
--   DELETE FROM prisme_migration WHERE version = '0010';
-- Reversing this loses only `prisme_sync_drift_full_objects`: the expression
-- above goes back to being inexpressible, and nothing else reads the column.
-- Rehearsed against a throwaway database, never against the live one.

ALTER TABLE sync_run_state
  ADD COLUMN last_drift_full_objects integer CHECK (last_drift_full_objects >= 0);

COMMENT ON COLUMN sync_run_state.last_drift_full_objects IS
  'Source of prisme_sync_drift_full_objects: the drift the last FULL pass measured, carried across the incremental passes in between so min_over_time(...[48h]) > 0 means two consecutive daily full passes. A count, never an identifier — nothing instance-identifying is stored here.';
