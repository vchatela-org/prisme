-- 0001 · bootstrap
--
-- The only extension prisme uses (docs/15-runtime.md §3: "Stock image; no
-- extension beyond pgcrypto"). Domain tables belong to W01 and arrive as later
-- migrations; this one exists so that a fresh database has a schema version and
-- so the runner is exercised end to end from the first deployment.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP EXTENSION IF EXISTS pgcrypto;
--   DELETE FROM prisme_migration WHERE version = '0001';
-- Rehearsed against a throwaway database, never against the live one.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
