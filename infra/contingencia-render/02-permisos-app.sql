-- 02-permisos-app.sql — Contingencia en Render (BL-217)
--
-- Se ejecuta DESPUÉS de restaurar bistrolink-db, conectado como bistrolink_user
-- a la base "bistrolink". Runbook: docs/runbooks/contingencia-render.md, 4.4.
--
-- El respaldo se genera con --no-acl y se restaura con --no-owner --no-acl:
-- las tablas quedan con dueño bistrolink_user y sin ningún permiso para
-- bistrolink_app. Este script vuelve a dar los mismos permisos que tiene el
-- rol en Railway (Anexo 12, D9):
--   - USAGE en public; SELECT, INSERT, UPDATE y DELETE en todas las tablas;
--   - USAGE y SELECT en las secuencias;
--   - sin escritura en _prisma_migrations (las migraciones las aplica el
--     pre-deploy con el dueño, no la API);
--   - registro_auditoria sin UPDATE, DELETE ni TRUNCATE (BL-475, migración
--     20261028000000_registro_auditoria);
--   - permisos por defecto para las tablas que creen las migraciones futuras.
--     En Railway son FOR ROLE postgres; en Render, el dueño es bistrolink_user.

\set ON_ERROR_STOP on

GRANT CONNECT ON DATABASE bistrolink TO bistrolink_app;
GRANT USAGE ON SCHEMA public TO bistrolink_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bistrolink_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bistrolink_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "_prisma_migrations" FROM bistrolink_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "registro_auditoria" FROM bistrolink_app;

ALTER DEFAULT PRIVILEGES FOR ROLE bistrolink_user IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bistrolink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bistrolink_user IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bistrolink_app;

-- Resumen: cantidad de permisos de bistrolink_app por tabla.
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS permisos
  FROM information_schema.role_table_grants
 WHERE grantee = 'bistrolink_app' AND table_schema = 'public'
 GROUP BY table_name
 ORDER BY table_name;
