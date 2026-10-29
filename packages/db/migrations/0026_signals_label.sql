-- 0026 · a label can put a task in the Signals lane
--
-- ADR-0041. Signals are machine-generated: digests, change alerts, reminders
-- an appliance sends. Until this migration a completion reached the Signals
-- lane only by *where* it sat — `area_mapping` is a location (project, and
-- optionally section) — and the automations that write those tasks write them
-- into ordinary area sections. Every one of them was therefore counted as that
-- area's work, with its default duration, in the balance the owner reads.
--
-- Two additions, and nothing else changes:
--
-- ## 1. `completion_history.labels` — the labels a completed task carried
--
-- The task tool's own field, read and never written (docs/11-ownership.md §5,
-- *Labels other than the anchor marker*). Nullable, because every row fetched
-- before this migration has none and a response may send none: `NULL` means
-- *not known*, and the fetch's upsert keeps what is held rather than erasing it
-- with an absence. An empty array is a known answer — no labels.
--
-- Attribution stays a decision re-made on every run (0006): the labels are
-- stored, the lane is not. Changing the setting below re-attributes history on
-- the next refresh without a fetch, for every completion whose labels are
-- known.
--
-- ## 2. `signals_label_setting` — which label, and which Signals lane
--
-- A singleton the application upserts, like `selection_setting` (0023): no row
-- means the feature is off and attribution is by location alone, exactly as
-- before this migration. The row names the label and the area of kind
-- `signals` that a labelled completion is attributed to — named, never
-- inferred, because an instance may hold more than one Signals lane and
-- picking one would be a guess. The area must be of kind `signals`; the API
-- checks that on the way in and the sync ignores the row if it ever stops
-- being true. Deleting the area deletes the row, which turns the feature off
-- rather than leaving it pointing at nothing.
--
-- Additive and forward-only; no backfill, and no GRANT beyond the default
-- privileges the migration role already gives the application role.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS signals_label_setting;
--   ALTER TABLE completion_history DROP COLUMN IF EXISTS labels;
--   DELETE FROM prisme_migration WHERE version = '0026';
-- Rehearsed against a throwaway database, never against the live one. The
-- first loses the chosen label: attribution is by location again on the next
-- refresh. The second loses the recorded labels, which come back only for
-- completions a later fetch covers.

ALTER TABLE completion_history ADD COLUMN labels text[];

COMMENT ON COLUMN completion_history.labels IS
  'The completed task''s labels as the tool reported them. Read, never written. NULL: not known (fetched before 0026, or the tool sent none) — a later fetch fills it; an absence never erases it (ADR-0041).';

CREATE TABLE signals_label_setting (
  id          text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  label       text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100 AND label = btrim(label)),
  area_key    text NOT NULL REFERENCES area (key) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL
);

COMMENT ON TABLE signals_label_setting IS
  'One row, upserted from the Settings screen. A completion carrying `label` is attributed to `area_key`, a Signals lane, wherever it sits. No row: attribution is by location only (ADR-0041).';
