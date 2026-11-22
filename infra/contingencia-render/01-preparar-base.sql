-- 01-preparar-base.sql — Contingencia en Render (BL-217)
--
-- Se ejecuta UNA vez sobre la base nueva de Render, ANTES de restaurar el
-- respaldo, conectado como el usuario de Render (bistrolink_user) a la base
-- "bistrolink". Runbook: docs/runbooks/contingencia-render.md, sección 4.4.
--
-- 1. Crea el rol de runtime de la API (bistrolink_app), sin superusuario ni
--    bypass de RLS, igual que en Railway (Anexo 12, D9 y A11). Tiene que existir
--    antes de restaurar: las políticas de RLS del respaldo pueden nombrarlo.
-- 2. Crea la base "keycloak" en la misma instancia (prueba de factibilidad del
--    08/11/2026: el usuario de Render tiene CREATEDB y CREATEROLE).
--
-- La contraseña de bistrolink_app no se escribe acá ni en la línea de comandos:
-- se lee de la variable de entorno APP_DB_PASSWORD (\getenv, psql 15 o superior).

\set ON_ERROR_STOP on
\getenv app_pw APP_DB_PASSWORD

\if :{?app_pw}
\else
  \echo 'ERROR: falta la variable de entorno APP_DB_PASSWORD'
  \quit 1
\endif

CREATE ROLE bistrolink_app
  LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
  PASSWORD :'app_pw';

CREATE DATABASE keycloak;

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
  FROM pg_roles
 WHERE rolname IN ('bistrolink_user', 'bistrolink_app')
 ORDER BY rolname;
