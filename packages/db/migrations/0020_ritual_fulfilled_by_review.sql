-- 0020 · a ritual can be fulfilled by closing a review session
--
-- The review is the product's central ritual, and prisme could not see it:
-- closing a weekly review session recorded decisions and a capacity snapshot
-- and counted for nothing, so a *weekly review* ritual read "not measured yet"
-- unless it was also ticked by hand or mirrored by a recurring task
-- (docs/19-how-it-works.md S3).
--
-- `fulfilled_by_review` makes the close the completion: the ritual's
-- adherence is rebuilt from the closed sessions of its own cadence each time
-- one closes. A daily ritual has no review that comes round as often, so the
-- CHECK refuses the pair. That a ritual has no recurring task as well — one
-- source per series — is enforced where the binding is written, because the
-- binding lives in `entity_external_ref`, not on this row.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE ritual DROP CONSTRAINT ritual_review_is_not_daily,
--     DROP COLUMN fulfilled_by_review;
--   DELETE FROM prisme_migration WHERE version = '0020';
-- The adherence rows a review wrote stay, as rows recorded by hand would:
-- they are what was observed, and the image before this one reads them as
-- such. Rehearsed with a fulfilled ritual and its adherence rows present, in a
-- rolled-back transaction against a throwaway database, never the live one.

ALTER TABLE ritual
  ADD COLUMN fulfilled_by_review boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT ritual_review_is_not_daily
    CHECK (NOT fulfilled_by_review OR cadence <> 'daily');

COMMENT ON COLUMN ritual.fulfilled_by_review IS
  'Closing a review session of this ritual''s cadence is its completion (S3). Never with a recurring task, never daily.';
