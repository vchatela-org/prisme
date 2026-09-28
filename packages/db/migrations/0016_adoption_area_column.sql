-- 0016 · a store's area column, and the page each area is recognised by
--
-- A document-tool row never carried an area. `area_mapping` names task-tool
-- locations only, so every page the adoption scan read sat "outside every
-- mapped area": an action takeaway could not be adopted, identity resolution
-- (rules 2 and 3 need the same area on both sides) never proposed a page
-- against a key result or a ritual, and the queue's Area filter never reached
-- one. The workspace already says which area a row belongs to — every store
-- points at a Life areas database through a relation — so prisme reads that
-- (ADR-0033).
--
-- ## 1. `role_binding.area_property` — which column holds a store's area
--
-- Optional, per store, chosen on Settings → Notion from the store's relation
-- properties, exactly as `date_property` is chosen from its date properties
-- (0015). A property's **name** is the workspace's: instance data, kept in this
-- database and never in the repository (docs/17-privacy.md).
--
-- `relation_properties` is what the last check found the store to hold — the
-- names of its relation-typed properties — so the screen offers a choice
-- rather than a text field. NULL: not checked since this migration, or the
-- check failed.
--
-- ## 2. What a relation resolves to
--
-- `area.external_page_id` has existed since 0002, as the area's narrative page.
-- ADR-0033 makes it the one thing a relation is matched against: exactly one
-- related page, and it is exactly one area's page, names that area. Anything
-- else names none. The column is unchanged; its comment says so now. No
-- uniqueness is added at the database: two areas naming one page resolve to
-- neither, and the API refuses to make it so.
--
-- Who owns the value read (ADR-0033): a takeaway's area is the document
-- tool's, read on every scan. An objective's and a ritual's area are prisme's,
-- and the relation only seeds one at adoption.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE role_binding DROP COLUMN IF EXISTS area_property,
--     DROP COLUMN IF EXISTS relation_properties;
--   COMMENT ON COLUMN area.external_page_id IS NULL;
--   DELETE FROM prisme_migration WHERE version = '0016';
-- Rehearsed against a throwaway database, never against the live one. The
-- chosen area columns have to be chosen again; the areas' pages are untouched.

ALTER TABLE role_binding
  ADD COLUMN area_property text
    CHECK (area_property IS NULL OR length(btrim(area_property)) > 0),
  ADD COLUMN relation_properties jsonb
    CHECK (relation_properties IS NULL OR jsonb_typeof(relation_properties) = 'array');

COMMENT ON COLUMN role_binding.area_property IS
  'The name of the store''s relation property that says which area an entry belongs to, chosen on Settings → Notion (ADR-0033). Optional. Instance data, like title: never logged, never committed.';

COMMENT ON COLUMN role_binding.relation_properties IS
  'The names of the store''s relation-typed properties as its last check read them, so an area column is chosen rather than typed. NULL: not checked, or the check failed.';

COMMENT ON COLUMN area.external_page_id IS
  'The area''s own page in the document tool — an entry of the store bound to areas_db, picked on Settings → Areas. A relation to exactly this page names this area (ADR-0033). Compared dashed or bare alike.';
