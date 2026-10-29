-- 0024 · a key result may name the sub-objective it is grouped under
--
-- Objectives are often kept in three levels: the objective, a handful of
-- sub-objectives (`O1`, `O2`, …), and the key results under each. prisme had
-- two, so a sub-objective could only be folded into every statement, and the
-- key result's task then read differently from the one kept by hand beneath the
-- sub-objective's subtask (ADR-0039).
--
-- `sub_objective` is free text, prisme's, and optional. It groups key results
-- on Objectives, and the reconciler places a new key result's task beneath the
-- objective task's subtask that reads as it. It is not an entity: it has no
-- status, no score and no task prisme manages.
--
-- Existing rows keep NULL — one group, as before.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE key_result DROP COLUMN sub_objective;
--   DELETE FROM prisme_migration WHERE version = '0024';
-- Nothing else reads the column; the grouping is lost and the statements keep
-- whatever they say. Rehearsed with a key result carrying a sub-objective, in a
-- rolled-back transaction against a throwaway database, never the live one.

ALTER TABLE key_result
  ADD COLUMN sub_objective text CHECK (sub_objective IS NULL OR length(sub_objective) BETWEEN 1 AND 200);

COMMENT ON COLUMN key_result.sub_objective IS
  'The sub-objective it is grouped under (ADR-0039). Free text; groups key results on Objectives and places a new key result''s task beneath the subtask that reads as it.';
