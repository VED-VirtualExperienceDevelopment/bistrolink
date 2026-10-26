-- BL-213: EXPLAIN de las consultas que usan los índices nuevos, como lo hace
-- la API (rol de la app, RLS activo, app.tenant_id seteado).
-- Uso (base LOCAL, nunca staging/production):
--   docker exec -i bistrolink-db psql -U bistrolink -d bistrolink_dev < scripts/db/explain-bl213.sql
-- Correrlo ANTES y DESPUÉS de aplicar la migración 20261026000000 y adjuntar
-- las dos salidas al PR. Con pocos datos Postgres puede preferir un Seq Scan:
-- es normal; la diferencia se ve con volumen.
BEGIN;
SET LOCAL ROLE bistrolink_app;
SELECT set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);

-- Un pedido cualquiera del tenant para las dos últimas consultas.
SELECT id AS pedido_id FROM pedido LIMIT 1 \gset

\echo '== KDS: pedidos activos del tenant (pedidos-transicion.service listarPendientes)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, estado, created_at FROM pedido
WHERE estado IN ('RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_ENTREGAR')
ORDER BY created_at ASC;

\echo '== Pedidos del tenant por fecha (listados y reportes)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id FROM pedido
WHERE created_at >= now() - interval '1 day'
ORDER BY created_at DESC LIMIT 50;

\echo '== Pagos de un pedido (cobro, webhook, consulta del comensal)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, estado FROM pago
WHERE pedido_id = :'pedido_id';

\echo '== Líneas de un pedido (KDS, monto del pago, CFE)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, cantidad FROM linea_pedido
WHERE pedido_id = :'pedido_id';
ROLLBACK;
