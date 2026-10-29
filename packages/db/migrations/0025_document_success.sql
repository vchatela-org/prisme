-- 0025 · the document tool's success figure, read and shown, never owned
--
-- The objectives store carries its own per-objective success percentage. It
-- competes with prisme's objective status and key-result `progress_self`: a
-- page can read 100% while prisme says `active`. ADR-0042 decides the figure is
-- the document tool's, **read-only for prisme**: shown beside the status when
-- the objective is judged ("the document says 100% — mark met?"), never written,
-- never a score. It changes no status: ADR-0037's window is unchanged, so an
-- objective still open after its review window is closed `missed` whatever its
-- page says. Whether that should change is an open question for the owner.
--
-- ## 1. `role_binding.success_property` — which column holds it
--
-- Optional, chosen on Settings → Notion from the objectives store's number
-- properties, as `area_property` is chosen from its relation properties (0016).
-- Unset: the feature is off, and nothing is read. A property's **name** is the
-- workspace's: instance data, never in the repository (docs/17-privacy.md).
--
-- `number_properties` is what the last check found: each number property's
-- name and the **format** the tool declares for it (`percent`, `number`, …),
-- because the format is what says whether 1 means 1% or 100%. The API refuses
-- to choose one whose format is neither a percentage nor a plain number.
-- NULL: not checked since this migration, or the check failed.
--
-- ## 2. `objective.document_success` — what was read
--
-- The figure as a percentage (100 = met), normalised from the property's
-- format by `documentSuccessPct` in packages/domain, and when it was read. The
-- objectives pass rewrites it for every objective linked to a page, every pass
-- (level-triggered), and clears it when the property is unset. NULL: off, no
-- page, or the page holds no number. Never written outward; prisme never
-- writes this property.
--
-- Additive and forward-only; no backfill.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE objective DROP COLUMN IF EXISTS document_success,
--     DROP COLUMN IF EXISTS document_success_read_at;
--   ALTER TABLE role_binding DROP COLUMN IF EXISTS success_property,
--     DROP COLUMN IF EXISTS number_properties;
--   DELETE FROM prisme_migration WHERE version = '0025';
-- Reversing it loses the chosen column and the last figures read, and nothing
-- else: the figure is the document tool's and is still on its pages. ADR-0037's
-- window then closes every unjudged objective `missed` again. Rehearse against
-- a throwaway database, never the live one.

ALTER TABLE role_binding
  ADD COLUMN success_property text
    CHECK (success_property IS NULL OR length(btrim(success_property)) > 0),
  ADD COLUMN number_properties jsonb
    CHECK (number_properties IS NULL OR jsonb_typeof(number_properties) = 'array');

COMMENT ON COLUMN role_binding.success_property IS
  'The name of the objectives store''s number property holding the document''s own success figure, chosen on Settings → Notion (ADR-0042). Optional: unset, nothing is read. Instance data, like title: never logged, never committed.';

COMMENT ON COLUMN role_binding.number_properties IS
  'The store''s number properties as its last check read them, each {name, format}, so a success column is chosen rather than typed and its format known. NULL: not checked, or the check failed.';

ALTER TABLE objective
  ADD COLUMN document_success numeric
    CHECK (document_success IS NULL OR document_success >= 0),
  ADD COLUMN document_success_read_at timestamptz,
  ADD CONSTRAINT document_success_says_when
    CHECK (document_success IS NULL OR document_success_read_at IS NOT NULL);

COMMENT ON COLUMN objective.document_success IS
  'The document tool''s own success figure for this objective, as a percentage (100 = met), read by the objectives pass (ADR-0042). Shown, never written, never a score. NULL: not read.';

COMMENT ON COLUMN objective.document_success_read_at IS
  'When document_success was last read.';
