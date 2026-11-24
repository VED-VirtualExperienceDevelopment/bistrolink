-- 03-verificar-restauracion.sql — Contingencia en Render (BL-217)
--
-- Se ejecuta conectado como bistrolink_user a la base "bistrolink", después de
-- 02-permisos-app.sql. No modifica datos: ANALYZE solo actualiza las
-- estadísticas. Runbook: contingencia-render.md, 4.4.

\set ON_ERROR_STOP on

\echo '== Última migración de Prisma aplicada'
SELECT migration_name, finished_at
  FROM "_prisma_migrations"
 WHERE finished_at IS NOT NULL
 ORDER BY finished_at DESC
 LIMIT 1;

\echo '== Datos restaurados: tamaño y filas por tabla'
-- No se usa count(*): en Render el dueño de las tablas (bistrolink_user) no es
-- superusuario y el RLS forzado también se le aplica, así que un count(*) sin
-- app.tenant_id da error. El tamaño en disco y las estadísticas (después de
-- ANALYZE) no pasan por el RLS. Una tabla con 0 bytes está vacía.
DO $$
DECLARE t record;
BEGIN
  -- Solo las tablas del esquema public: un ANALYZE general avisa por cada
  -- tabla del sistema que el usuario de Render no puede analizar.
  FOR t IN SELECT relname FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' LOOP
    EXECUTE format('ANALYZE public.%I', t.relname);
  END LOOP;
END
$$;
SELECT c.relname AS tabla,
       pg_relation_size(c.oid) AS bytes,
       c.reltuples::bigint AS filas_estimadas
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
 ORDER BY pg_relation_size(c.oid) DESC, c.relname;

\echo '== Tablas con RLS activo y forzado'
SELECT count(*) AS tablas,
       count(*) FILTER (WHERE relrowsecurity) AS con_rls,
       count(*) FILTER (WHERE relforcerowsecurity) AS con_rls_forzado
  FROM pg_class
 WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';

\echo '== Políticas de RLS'
SELECT count(*) AS politicas FROM pg_policies WHERE schemaname = 'public';

\echo '== Roles: los dos tienen que dar rolsuper = f y rolbypassrls = f'
SELECT rolname, rolsuper, rolbypassrls
  FROM pg_roles
 WHERE rolname IN ('bistrolink_app', 'bistrolink_user')
 ORDER BY rolname;
