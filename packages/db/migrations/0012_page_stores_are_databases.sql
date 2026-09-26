-- 0012 · a page store is a database, and its templates are the document tool's own
--
-- ADR-0030. ADR-0025 made a page store an ordinary parent *page* and a template
-- an ordinary page whose top-level blocks prisme copied, because the document
-- tool had no way to instantiate a template. It has one now, and it only works
-- when the parent is a data source — which is also how the owner keeps these
-- pages. So a page store names a database, and what a new page starts from is
-- one of the templates that database holds.
--
-- ## 1. The template bindings go
--
-- `initiative_page_template`, `project_page_template` and `capture_page_template`
-- leave the vocabulary (`packages/connectors/src/role-key.ts`). Their rows would
-- be harmless — nothing resolves a role the code no longer knows, as 0008 says —
-- but a row nobody can see or unbind on the Settings screen is an identifier
-- kept for no reason, so it is deleted. Nothing in the document tool changes:
-- no page was ever created under the old shape, and the pages the rows named
-- are left exactly where they are.
--
-- ## 2. The stores' last checks are forgotten, not the stores
--
-- The three store bindings keep their identifiers. What they lose is the cached
-- result of their last check, because that check described the identifier *as a
-- page*: a title and a "found" earned by a shape the role no longer names. The
-- next check — *Check again* on Settings, or saving the binding — describes it
-- as a database, and a binding that still names a page then fails as the wrong
-- kind of object, which is the truth (ADR-0030, *Consequences*).
--
-- ## 3. What a store's check found: its templates
--
-- `templates` caches the template list the check read, as `[{name, isDefault}]`
-- — the same standing as `title` (0011): a read kept so the Settings overview
-- can say what a store holds without calling the tool on every render. An empty
-- array is a finding of its own — the store is readable and holds no template,
-- so the kind is not addressable yet (ADR-0030 rule 5). `NULL` means the role is
-- not a page store, or the check did not get that far. Template *identifiers*
-- are not cached here: a creation resolves its template from the live list, and
-- an identifier kept in this column is one something could one day send without
-- asking whether it still exists.
--
-- ## 4. The template a page was asked for
--
-- `creation_intent.template_id` is the template chosen where the page was asked
-- for, when the database held several. `NULL` means no choice was made, which is
-- a request for the default — the one template, or the database's marked one —
-- resolved when the intent is applied. A chosen identifier is re-resolved then
-- too, and one that has since been deleted blocks the intent rather than falling
-- back to another (ADR-0030 rule 3). Only a page carries one.
--
-- Additive except for §1, and forward-only. No backfill: no intent has ever
-- carried a choice.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE creation_intent DROP COLUMN template_id;
--   ALTER TABLE role_binding DROP COLUMN templates;
--   DELETE FROM prisme_migration WHERE version = '0012';
-- The deleted template bindings and the forgotten checks are not restored by
-- that: the bindings would have to be entered again under ADR-0025's shape, and
-- a check re-reads what it forgot.

DELETE FROM role_binding
 WHERE role IN ('initiative_page_template', 'project_page_template', 'capture_page_template');

UPDATE role_binding
   SET title = NULL, link_id = NULL, checked_at = NULL, check_error = NULL
 WHERE role IN ('initiative_pages_db', 'project_pages_db', 'capture_pages_db');

ALTER TABLE role_binding
  ADD COLUMN templates jsonb CHECK (templates IS NULL OR jsonb_typeof(templates) = 'array');

COMMENT ON COLUMN role_binding.templates IS
  'A page store''s templates as its last check read them: [{name, isDefault}]. [] is a readable store with no template, which is not addressable yet (ADR-0030 rule 5). NULL: not a page store, or not checked. Instance data, like title; never logged, never committed. No identifier is cached — creation resolves from the live list.';

ALTER TABLE creation_intent
  ADD COLUMN template_id text,
  ADD CONSTRAINT only_pages_choose_a_template
    CHECK (template_id IS NULL OR object_kind = 'page'),
  ADD CONSTRAINT a_chosen_template_is_named
    CHECK (template_id IS NULL OR length(btrim(template_id)) > 0);

COMMENT ON COLUMN creation_intent.template_id IS
  'The template chosen where the page was asked for (ADR-0030 rule 3). NULL asks for the default — the one template, or the database''s marked one. Re-resolved against the live list when the intent is applied; a chosen template that no longer exists blocks rather than falling back. Instance data: never logged, never committed.';
