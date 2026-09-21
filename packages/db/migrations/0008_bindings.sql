-- 0008 · the role bindings: which external store each role key names
--
-- docs/15-runtime.md §2, *External bindings*: "The identifiers of external
-- databases are **instance data**, not configuration in git. They load from the
-- seed path into the database, keyed by role: `objectives_db`, `takeaways_db`,
-- `media_db`, `areas_db`, `processes_db`, `reviews_db`."
--
-- W03 built the client and the schema and left the loader unwritten; W12 and
-- W13 both found the consequence and recorded it as their missing dependency.
-- This is the table that loader writes to.
--
-- ## Why this is a table and not six environment variables
--
-- `packages/connectors/src/role-key.ts` says it: "External stores are addressed
-- by **role key**, never by name or ID." An identifier in the environment would
-- be an identifier in a deployment manifest, and a manifest is a thing people
-- paste. A table is loaded from the gitignored seed path
-- (`docs/17-privacy.md` §1), and the application reads it at run time.
--
-- ## Why there is no CHECK on `role`
--
-- The vocabulary is `ROLE_KEYS` in `packages/connectors/src/role-key.ts`, and
-- it **grows** — ADR-0025 proposes four more keys for the page stores and their
-- templates. A CHECK here would mean a migration for every addition, and the
-- vocabulary is already enforced where it matters: the loader parses the file
-- with `roleBindingsSchema`, so an unknown role is refused **before** it reaches
-- this table, and the client refuses a role that is not bound.
--
-- A row whose role the code no longer knows is therefore impossible to create
-- through the loader and harmless if it somehow exists: nothing resolves it.
--
-- Reversal procedure (forward-only means written down, not generated):
--   DROP TABLE IF EXISTS role_binding;
--   DELETE FROM prisme_migration WHERE version = '0008';
-- Reversing this only removes a cache of the seed file: the identifiers are
-- still on disk in `seed/`, and re-running the loader restores every row.

CREATE TABLE role_binding (
  -- One of `ROLE_KEYS`. Instance data lives in `external_id`; the *role* is
  -- prisme's own vocabulary and is the same in every instance.
  role        text PRIMARY KEY,
  -- The external identifier. A real data-source id from a real workspace: it
  -- lives in this database and never in the repository (docs/17-privacy.md).
  external_id text NOT NULL CHECK (length(btrim(external_id)) > 0),
  -- Which tool the store belongs to. Two roles may name the same document once
  -- ADR-0025's page keys land, so nothing here forces one store per tool.
  tool        text NOT NULL DEFAULT 'doc' CHECK (tool IN ('doc', 'task')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE role_binding IS
  'Role key → external identifier, loaded from the seed path. One row per bound role; a role with no row is not addressable, which the connectors report as "not read" rather than guessing.';

COMMENT ON COLUMN role_binding.external_id IS
  'Instance data: a real store id from a real workspace. It is never logged, never put in an error message and never committed (docs/17-privacy.md §1).';

COMMENT ON COLUMN role_binding.tool IS
  'Which external tool the store belongs to. The task tool is not addressed by role yet — it has one workspace — so every row is a document-tool store today.';
