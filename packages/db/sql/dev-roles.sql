-- Development only. Run automatically by docker-compose on first start.
--
-- It creates the same two roles the cluster has (docs/15-runtime.md §3) with
-- throwaway passwords, so the DML/DDL split is exercised locally instead of
-- being discovered in the cluster. The production equivalent, with its
-- placeholders, is ./roles.example.sql and belongs to the deployment repository.

CREATE ROLE prisme_migrate LOGIN PASSWORD 'prisme';
CREATE ROLE prisme_app     LOGIN PASSWORD 'prisme';

-- CREATE on the database, so the migration role can install a *trusted*
-- extension (pgcrypto has been trusted since PostgreSQL 13) without being a
-- superuser. The application role gets no such grant.
GRANT CREATE ON DATABASE prisme TO prisme_migrate;

ALTER SCHEMA public OWNER TO prisme_migrate;
GRANT USAGE ON SCHEMA public TO prisme_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM prisme_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prisme_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prisme_app;

ALTER DEFAULT PRIVILEGES FOR ROLE prisme_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO prisme_app;
ALTER DEFAULT PRIVILEGES FOR ROLE prisme_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO prisme_app;
