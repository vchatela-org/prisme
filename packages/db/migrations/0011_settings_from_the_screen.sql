-- 0011 · what the Settings screens need to store
--
-- Until this migration, three pieces of an instance's configuration could only
-- be changed by editing a gitignored JSON file and running a CLI as a Job: the
-- areas, where each area's work lives in the task tool, and which document-tool
-- store each role names. The API already carried the first two (`POST/PATCH
-- /areas`, `PUT /areas/{key}/mappings`); no screen called them. The Settings
-- screens call them, and need three facts the schema could not hold.
--
-- ## 1. An area's colour
--
-- `AREA_COLOR_PINS` pins an area to one of the palette's eight slots, and it is
-- deployment configuration: changing a colour meant a GitOps commit and a
-- rollout. A colour is a presentation choice about an area, owned by prisme
-- like the area's name, so it moves onto the area. `NULL` means "not chosen":
-- the environment's pin applies if there is one, and the key's hash otherwise —
-- exactly the behaviour before this migration, so an instance that never opens
-- the screen sees nothing change.
--
-- ## 2. Where new work for an area goes
--
-- An area may fold several task-tool locations together (many-to-one), and two
-- code paths had to pick one of them to *create* in: the reconciler's anchor
-- create took the first mapping in key order, the capture flow took the most
-- specific. The same area could therefore send new work to two places, and
-- neither was a choice anybody made. `is_home` makes it one: at most one
-- mapping per area is the home, and both paths now read the same rule —
-- `homeLocation` in packages/domain: the home, else the most specific mapping,
-- else the first by identifier. For an anchor that fallback is a change (it was
-- key order alone); no instance has let prisme create an anchor yet, the write
-- freeze being on everywhere, so nothing already created can move because of it.
--
-- ## 3. What a bound role actually points at
--
-- `role_binding` held an identifier and nothing a person could recognise. The
-- Settings screen checks a binding against the document tool and keeps what it
-- found — the store's title, and the identifier a person *opens* — so the
-- overview can say "Takeaways → Reading notes" rather than a UUID. The two
-- identifiers differ for a data source: prisme queries the data source, and a
-- browser opens the database that holds it. No URL is stored: the tool's own
-- page URL identifies the workspace and the connectors refuse to read it
-- (docs/17-privacy.md §1), so a link is `DOCTOOL_PAGE_URL_TEMPLATE` applied to
-- `link_id` in the web tier, as *Open page* already is. The columns are a cache
-- of a read: `external_id` stays the only fact the connectors resolve.
--
-- Additive and forward-only: nullable columns, a defaulted boolean and a
-- partial index. No backfill.
--
-- Reversal procedure (forward-only means written down, not generated):
--   ALTER TABLE role_binding DROP COLUMN title, DROP COLUMN link_id,
--     DROP COLUMN checked_at, DROP COLUMN check_error;
--   DROP INDEX IF EXISTS area_mapping_one_home_per_area;
--   ALTER TABLE area_mapping DROP COLUMN is_home;
--   ALTER TABLE area DROP COLUMN color_slot;
--   DELETE FROM prisme_migration WHERE version = '0011';

ALTER TABLE area
  ADD COLUMN color_slot smallint CHECK (color_slot BETWEEN 1 AND 8);

COMMENT ON COLUMN area.color_slot IS
  'The palette slot (1–8) the area paints with, chosen on the Settings screen. NULL: the AREA_COLOR_PINS entry if any, else the hash of the key. Lanes ignore it — they paint grey.';

ALTER TABLE area_mapping
  ADD COLUMN is_home boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX area_mapping_one_home_per_area
  ON area_mapping (area_key) WHERE is_home;

COMMENT ON COLUMN area_mapping.is_home IS
  'Where prisme creates new work for this area — anchors and captures alike. At most one per area; with none, the most specific mapping, then the first by identifier.';

ALTER TABLE role_binding
  ADD COLUMN title       text,
  ADD COLUMN link_id     text,
  ADD COLUMN checked_at  timestamptz,
  ADD COLUMN check_error text;

COMMENT ON COLUMN role_binding.title IS
  'The store''s title as the document tool reported it at checked_at. Instance data, like external_id: never logged, never committed.';

COMMENT ON COLUMN role_binding.link_id IS
  'What a person opens to see this store: the page for a page or template, the database holding it for a data source. Rendered through DOCTOOL_PAGE_URL_TEMPLATE; never a URL.';

COMMENT ON COLUMN role_binding.check_error IS
  'Why the last check failed, as a connector failure kind (e.g. refused, invalid_token). Never an upstream message: those can carry identifiers.';
