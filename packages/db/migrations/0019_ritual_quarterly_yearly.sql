-- 0019 · a ritual can be quarterly or yearly
--
-- A ritual's cadence was daily, weekly or monthly, so a habit that comes round
-- once a quarter or once a year could not be a ritual at all — and the
-- adoption queue, which sends a processes row to Rituals, had nowhere to send
-- it. The vocabulary grows by two values and nothing else changes: an
-- adherence period is the quarter (or the year) that starts on `period_start`,
-- with one opportunity, like a weekly or monthly one.
--
-- Reversal procedure (forward-only means written down, not generated):
--   a ritual carrying the new values must go first, or the narrower CHECK
--   refuses to be added:
--   DELETE FROM ritual WHERE cadence IN ('quarterly', 'yearly');
--   ALTER TABLE ritual DROP CONSTRAINT ritual_cadence_check,
--     ADD CONSTRAINT ritual_cadence_check
--       CHECK (cadence IN ('daily', 'weekly', 'monthly'));
--   DELETE FROM prisme_migration WHERE version = '0019';
-- Rehearsed with a quarterly ritual and an adherence row present, in a
-- rolled-back transaction against a throwaway database, never the live one.

ALTER TABLE ritual
  DROP CONSTRAINT ritual_cadence_check,
  ADD CONSTRAINT ritual_cadence_check
    CHECK (cadence IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly'));
