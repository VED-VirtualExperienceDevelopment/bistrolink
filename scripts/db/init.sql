-- scripts/db/init.sql
-- Las migraciones reales se gestionan con Prisma Migrate.
-- Este archivo agrega extensiones base y el rol de aplicación en runtime.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Rol de aplicación: usado por el backend en runtime (RUNTIME_DATABASE_URL).
-- A diferencia de 'bistrolink' (superusuario, usado por Prisma Migrate para
-- DDL), este rol NO tiene bypass de RLS — así las políticas de aislamiento
-- multi-tenant (ver seed.ts, tenant_isolation) se aplican también en runtime,
-- no solo cuando se corren migraciones o el seed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bistrolink_app') THEN
    CREATE ROLE bistrolink_app WITH LOGIN PASSWORD 'bistrolink_app_dev';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO bistrolink_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bistrolink_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bistrolink_app;

-- Para que las tablas que Prisma Migrate cree DESPUÉS de este init.sql
-- (con el rol 'bistrolink') también queden accesibles para 'bistrolink_app'
-- sin tener que volver a correr estos GRANT a mano cada vez.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bistrolink_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bistrolink_app;