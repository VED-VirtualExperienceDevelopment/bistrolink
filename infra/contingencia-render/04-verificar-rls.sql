-- 04-verificar-rls.sql — Contingencia en Render (BL-217)
--
-- Se ejecuta conectado como bistrolink_app (el rol de la API) a la base
-- "bistrolink". Comprueba que el aislamiento entre establecimientos se aplica:
-- con un tenant que no existe en la sesión, la API no ve ningún pedido.
-- No modifica nada. Runbook: contingencia-render.md, 4.4.
--
-- Las políticas usan current_setting('app.tenant_id') sin valor por defecto:
-- si la sesión no fija el tenant, la consulta da error en lugar de 0 filas.
-- Por eso se fija un UUID que no corresponde a ningún establecimiento.

\set ON_ERROR_STOP on

\echo '== Usuario de la conexión (tiene que ser bistrolink_app)'
SELECT current_user;

SET app.tenant_id = '00000000-0000-0000-0000-000000000000';

\echo '== Pedidos visibles con un tenant inexistente (tiene que dar 0)'
SELECT count(*) AS pedidos_visibles FROM pedido;
