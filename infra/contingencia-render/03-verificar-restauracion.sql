-- 03-verificar-restauracion.sql — Contingencia en Render (BL-217)
--
-- Se ejecuta conectado como bistrolink_user a la base "bistrolink", después de
-- 02-permisos-app.sql. No modifica nada. Runbook: contingencia-render.md, 4.4.

\set ON_ERROR_STOP on

\echo '== Última migración de Prisma aplicada'
SELECT migration_name, finished_at
  FROM "_prisma_migrations"
 WHERE finished_at IS NOT NULL
 ORDER BY finished_at DESC
 LIMIT 1;

\echo '== Datos restaurados (filas por tabla principal)'
SELECT 'tenant' AS tabla, count(*) AS filas FROM tenant
UNION ALL SELECT 'pedido', count(*) FROM pedido
UNION ALL SELECT 'pago', count(*) FROM pago
UNION ALL SELECT 'comprobante_fiscal', count(*) FROM comprobante_fiscal;

\echo '== Fecha del dato más nuevo (para el RPO)'
SELECT max(created_at) AS ultimo_pedido FROM pedido;

\echo '== Tablas con RLS activo y forzado'
SELECT count(*) FILTER (WHERE relrowsecurity) AS con_rls,
       count(*) FILTER (WHERE relforcerowsecurity) AS con_rls_forzado
  FROM pg_class
 WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';

\echo '== Políticas de RLS'
SELECT count(*) AS politicas FROM pg_policies WHERE schemaname = 'public';

\echo '== Rol de la API: tiene que dar rolsuper = f y rolbypassrls = f'
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'bistrolink_app';
