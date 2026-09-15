-- Reference only. This file is never executed by prisme.
--
-- docs/15-runtime.md §3 splits the database into two roles, and the split is
-- the control: an application process that cannot run DDL cannot alter the
-- schema, whatever a future bug asks it to do.
--
--   prisme_app      SELECT, INSERT, UPDATE, DELETE. No DDL.   → DATABASE_URL
--   prisme_migrate  DDL. Used only by the pre-rollout Job.     → MIGRATION_DATABASE_URL
--
-- Creating roles and setting passwords belongs to the GitOps deployment
-- repository, beside the PostgreSQL Helm release — not here, and not in any
-- image this repository builds. Replace every placeholder; no real password,
-- host or database name may ever appear in this public repository.
--
-- Neither role is the backup's role. Backups are a dump CronJob owned by the
-- deployment repository (ADR-0022) with its own credential, and prisme holds
-- none of it.

-- \set app_password       'replace-me'
-- \set migrate_password   'replace-me'

CREATE ROLE prisme_migrate LOGIN PASSWORD :'migrate_password';
CREATE ROLE prisme_app     LOGIN PASSWORD :'app_password';

-- CREATE on the database, so the migration role can install a *trusted*
-- extension (pgcrypto has been trusted since PostgreSQL 13) without being a
-- superuser. The application role gets no such grant.
-- GRANT CREATE ON DATABASE :"database" TO prisme_migrate;

-- The migration role owns the schema, so objects it creates are its own.
ALTER SCHEMA public OWNER TO prisme_migrate;
GRANT USAGE ON SCHEMA public TO prisme_app;

-- No CREATE for the application role: that is the "no DDL" half of the split.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM prisme_app;

-- DML on everything that exists now...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prisme_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prisme_app;

-- ...and on everything the migration role creates later, without a re-grant
-- after every migration. Forgetting this is the usual cause of "it works on my
-- laptop and the new table is unreadable in the cluster".
ALTER DEFAULT PRIVILEGES FOR ROLE prisme_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO prisme_app;
ALTER DEFAULT PRIVILEGES FOR ROLE prisme_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO prisme_app;
