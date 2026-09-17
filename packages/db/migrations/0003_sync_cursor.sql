-- 0003 · the reconciler's cursor
--
-- Where the incremental read left off: the task tool's opaque sync token, the
-- document tool's change-timestamp watermark, and when the last full pass ran
-- (docs/16-sync.md §2). W01 landed every other piece of reconciliation state —
-- `entity_external_ref`, `entity_link`, `last_applied`, `sync_conflict` — and
-- this is the one it did not, because nothing needed it until the reconciler
-- existed (W04).
--
-- All of it in PostgreSQL, with no volume and no local file (ADR-0018). The
-- token and the changes it represents commit in one transaction, so they cannot
-- diverge: a token advanced without its changes silently loses every edit it
-- covered, and nothing later would ever revisit them.
--
-- **One row.** The primary key is a constant, so a second cursor cannot be
-- inserted by a bug or a race — two cursors would mean two answers to "where
-- did we get to", and the reconciler would alternate between them.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS sync_cursor;
--   DELETE FROM prisme_migration WHERE version = '0003';
-- Rehearsed against a throwaway database, never against the live one.

CREATE TABLE sync_cursor (
  id                text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  task_tool_token   text,
  doc_watermark     timestamptz,
  last_full_pass_at timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sync_cursor IS
  'One row. The incremental read is only as good as this, and a second row would mean two answers to where the last pass got to.';

COMMENT ON COLUMN sync_cursor.task_tool_token IS
  'Opaque to prisme. Stored, never parsed — its shape is the tool''s business.';

COMMENT ON COLUMN sync_cursor.doc_watermark IS
  'Already overlapped by two minutes when it is written: change timestamps round down to the minute, so >= last_run loses same-minute edits (docs/16-sync.md §2).';
