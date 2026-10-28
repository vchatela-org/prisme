-- 0021 · an initiative says whether it has been estimated
--
-- The four estimates are NOT NULL, so adoption and the intent channel's
-- capture (the `prisme` label) give every initiative they make the middle of
-- the scale — 3, 3, 3, 3. Every adopted initiative in an area then has the
-- same score, the ranking is a tie broken by order, and nothing distinguished
-- *estimated as average* from *never estimated* (docs/19-how-it-works.md S5).
--
-- `estimated` says which. It is `false` where prisme wrote the placeholder and
-- becomes `true` the first time any estimate is written by a person or an
-- agent — including the same value, which is a judgement that the placeholder
-- is right. An initiative created in prisme is estimated by whoever created it,
-- so the default is `true`.
--
-- Existing rows: an adopted initiative whose four estimates are all still the
-- placeholder is taken to be unestimated. Estimate edits were never logged, so
-- one deliberately set to 3, 3, 3, 3 reads as unestimated too; a single
-- *Keep these estimates* puts it right, and that error is the visible one.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE initiative DROP COLUMN estimated;
--   DELETE FROM prisme_migration WHERE version = '0021';
-- Nothing else reads the column. Rehearsed with an unestimated initiative
-- present, in a rolled-back transaction against a throwaway database, never
-- the live one.

ALTER TABLE initiative
  ADD COLUMN estimated boolean NOT NULL DEFAULT true;

UPDATE initiative SET estimated = false
WHERE origin = 'adopted'
  AND value = 3 AND time_criticality = 3 AND risk = 3 AND size = 3;

COMMENT ON COLUMN initiative.estimated IS
  'False while the four estimates are the placeholder adoption or a capture wrote; true once any is written. An unestimated initiative is not ready for now (S5).';
