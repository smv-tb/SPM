-- Least-privilege database role for the application (S3.2).
--
-- The app only reads and writes rows. It never needs to change the schema, so it
-- must not be able to: a compromised app (or a stolen DATABASE_URL) could otherwise
-- drop tables, switch off the triggers that make the ledger and audit log tamper-proof,
-- or rewrite history. This script creates that role. The schema OWNER keeps its
-- rights and is used only to run migrations (MIGRATION_DATABASE_URL).
--
-- Run it once as a superuser (or an owner with CREATEROLE), connected to the
-- application database, and re-run it any time — it is idempotent. Re-running with
-- a new password rotates the password.
--
--   psql -d smartvie_pm \
--     -v owner_role=smartvie_pm -v app_role=smartvie_app -v app_password='a-long-random-password' \
--     -f deploy/db/app-role.sql
--
-- owner_role is the role that owns the tables (the one migrations run as).
-- See docs/security/DB-ROLES.md for the full procedure.

\set ON_ERROR_STOP on

\if :{?owner_role} \else \echo 'Set -v owner_role=<role that owns the tables>' \quit \endif
\if :{?app_role} \else \echo 'Set -v app_role=<role for the application>' \quit \endif
\if :{?app_password} \else \echo 'Set -v app_password=<password for the application role>' \quit \endif

BEGIN;

-- The role: no superuser, no creating databases or roles, no replication, no RLS bypass.
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_role', :'app_password') \gexec

-- Get in, and see the tables; but never create anything in the schema.
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_role";
REVOKE CREATE ON SCHEMA public FROM :"app_role";

-- Rows only: no TRUNCATE, REFERENCES or TRIGGER (and, not being the owner, no ALTER/DROP,
-- and no DISABLE TRIGGER, which needs ownership).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- Tables and sequences a later migration creates get the same rights automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- The audit log is append-only. A trigger already refuses UPDATE, DELETE and TRUNCATE;
-- this removes the permission as well, so it holds even if the trigger were ever dropped.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM :"app_role";

-- Migration history is the owner's: the app must not be able to forge or erase it.
REVOKE ALL ON "_prisma_migrations" FROM :"app_role";

-- Optional: a read-only role for the backup job (needs PostgreSQL 14+). The app role cannot
-- read the migration history, which a complete dump includes, so give the backup its own:
--   -v backup_role=smartvie_backup -v backup_password='another-long-random-password'
\if :{?backup_role}
\if :{?backup_password}
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'backup_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'backup_role') \gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'backup_role', :'backup_password') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'backup_role') \gexec
GRANT pg_read_all_data TO :"backup_role";
\else
\echo 'backup_role given without backup_password: skipped'
\endif
\endif

COMMIT;

\echo 'Application role ready. Put DATABASE_URL=postgresql://<app_role>:<password>@<host>:5432/<db> in .env'
\echo 'and keep the owner connection as MIGRATION_DATABASE_URL.'
