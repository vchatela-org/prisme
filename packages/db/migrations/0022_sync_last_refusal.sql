-- 0022 · why the last pass was refused, so a screen can say so
--
-- A reconciler pass refuses its whole plan in two cases: the write freeze
-- (`SYNC_WRITE_ENABLED=false`), and a plan that creates more objects than
-- `SYNC_CREATE_THRESHOLD` allows. The second is the surprising one. With the
-- threshold at 0 — its default, and the right value during adoption — the
-- first initiative created in prisme that reaches `next` makes every
-- following pass refuse **everything**, anchor updates included, and the only
-- trace was a line in a CronJob pod's log that nobody reads
-- (docs/19-how-it-works.md S8).
--
-- The pass already records its outcome in this row for `/metrics` (0009).
-- These two columns add *why* it was refused, overwritten by every apply pass:
-- `NULL` means the last pass was not refused. The time is `last_drift_at`,
-- which every apply pass writes. A kind and a count — never a title.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE sync_run_state DROP COLUMN last_refusal,
--     DROP COLUMN last_refusal_creates;
--   DELETE FROM prisme_migration WHERE version = '0022';
-- Rehearsed with a refusal recorded, in a rolled-back transaction against a
-- throwaway database, never the live one.

ALTER TABLE sync_run_state
  ADD COLUMN last_refusal text
    CHECK (last_refusal IN ('create_threshold', 'write_freeze')),
  ADD COLUMN last_refusal_creates integer
    CHECK (last_refusal_creates >= 0);

COMMENT ON COLUMN sync_run_state.last_refusal IS
  'Why the last apply pass refused its plan, or NULL when it did not. Read by GET /sync, so a refusal for creations reaches a screen (S8).';
