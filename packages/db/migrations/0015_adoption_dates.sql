-- 0015 · an adoption candidate's date, and the column it is read from
--
-- The adoption queue listed every entry of a document-tool store, including
-- ones whose period ended years ago. An objective for a year long gone is not
-- archived in the tool — it is simply over — and nothing in the queue could
-- tell it apart from this year's. Working the queue meant ignoring each one by
-- hand, permanently, which is the wrong answer to "this is history".
--
-- ## 1. `role_binding.date_property` — which column holds a store's dates
--
-- Optional, per store, chosen on Settings → Notion. A property's **name** is
-- the workspace's, like a store's title: instance data, kept in this database
-- and never in the repository (docs/17-privacy.md). The document tool owns the
-- values; prisme reads them and writes nothing back.
--
-- `date_properties` is what the last check found the store to hold — the names
-- of its date-typed properties — so the screen offers a choice rather than a
-- text field, exactly as `templates` does for a page store (0012). NULL: not
-- checked, or the check failed.
--
-- ## 2. `adoption_candidate.source_role`, `starts_on`, `ends_on`
--
-- Which store a page came from, so the queue can be filtered by it, and the
-- period its date property names. A single date is stored as a one-day period.
-- The queue hides a candidate whose period has ended; the scan still mirrors
-- it, so the decision stays visible, and clearing the setting brings every
-- one back on the next scan. Derived like the rest of this table: replaced
-- wholesale each scan (0005), so rows written before this migration carry
-- NULLs until the next scan fills them in.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE adoption_candidate DROP CONSTRAINT IF EXISTS a_period_runs_forward,
--     DROP CONSTRAINT IF EXISTS only_a_page_has_a_store,
--     DROP COLUMN IF EXISTS source_role, DROP COLUMN IF EXISTS starts_on,
--     DROP COLUMN IF EXISTS ends_on;
--   ALTER TABLE role_binding DROP COLUMN IF EXISTS date_property,
--     DROP COLUMN IF EXISTS date_properties;
--   DELETE FROM prisme_migration WHERE version = '0015';
-- Rehearsed against a throwaway database, never against the live one. The
-- candidate columns come back on the next scan; the chosen date columns have
-- to be chosen again.

ALTER TABLE role_binding
  ADD COLUMN date_property text
    CHECK (date_property IS NULL OR length(btrim(date_property)) > 0),
  ADD COLUMN date_properties jsonb
    CHECK (date_properties IS NULL OR jsonb_typeof(date_properties) = 'array');

COMMENT ON COLUMN role_binding.date_property IS
  'The name of the store''s date property that says when an entry''s period runs, chosen on Settings → Notion. Optional. Instance data, like title: never logged, never committed.';

COMMENT ON COLUMN role_binding.date_properties IS
  'The names of the store''s date-typed properties as its last check read them, so a date property is chosen rather than typed. NULL: not checked, or the check failed.';

ALTER TABLE adoption_candidate
  ADD COLUMN source_role text,
  ADD COLUMN starts_on date,
  ADD COLUMN ends_on date,
  ADD CONSTRAINT only_a_page_has_a_store
    CHECK (source_role IS NULL OR external_kind = 'page'),
  ADD CONSTRAINT a_period_runs_forward
    CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on);

COMMENT ON COLUMN adoption_candidate.source_role IS
  'The role key of the document-tool store a page was read from. NULL for a task-tool object, and for a row scanned before 0015.';

COMMENT ON COLUMN adoption_candidate.ends_on IS
  'The last day of the period the store''s date property names; a single date is a one-day period. A candidate whose period ended before today is hidden from the queue by default, not removed from it.';
