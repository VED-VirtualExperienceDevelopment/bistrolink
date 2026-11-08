-- BL-197: retira el tenant «Ejemplo» (554915d0-…) de una base que lo tenga
-- (bases locales y staging anteriores a BL-197). Se fusionó en el tenant de
-- testing A («Restaurante Testing A», 11111111-…). Producción nunca lo tuvo.
--
-- Orden: correr PRIMERO el seed (npx prisma db seed), que mueve la fila de
-- admin-test al tenant A; si admin-test sigue en Ejemplo, este script se
-- corta sin borrar nada.
--
-- Cómo se corre (con un usuario dueño del esquema: bistrolink en local,
-- postgres en staging):
--   - Local:   Get-Content apps/backend/scripts/retirar-tenant-ejemplo.sql | docker compose exec -T bistrolink-db psql -U bistrolink -d bistrolink_dev
--   - Staging: pegarlo en la pestaña Query de bistrolink-db en Railway, o
--              con psql/DBeaver por el túnel (runbook migraciones-y-seed.md §5).
--
-- Es un único bloque DO: corre en una sola transacción (si algo falla, no se
-- borra nada) y el editor Query de Railway no le agrega LIMIT. Se puede
-- correr más de una vez: si Ejemplo ya no existe, avisa y no hace nada.
--
-- Los avisos (NOTICE) listan los usuarios de Ejemplo que se borran de la
-- base: hay que borrarlos también en Keycloak (realm bistrolink → Users).

DO $$
DECLARE
  ejemplo CONSTANT uuid := '554915d0-f7ed-4053-b841-56479df29fd9';
  admin_test CONSTANT uuid := 'c832535d-6122-449d-8b21-2371d8b7d9d0';
  fila record;
  n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = ejemplo) THEN
    RAISE NOTICE 'El tenant Ejemplo no existe: no hay nada que retirar.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM usuario WHERE keycloak_id = admin_test AND tenant_id = ejemplo
  ) THEN
    RAISE EXCEPTION 'admin-test sigue en el tenant Ejemplo: correr primero el seed (npx prisma db seed).';
  END IF;

  FOR fila IN
    SELECT username, keycloak_id, rol, activo
    FROM usuario WHERE tenant_id = ejemplo ORDER BY username
  LOOP
    RAISE NOTICE 'Usuario de Ejemplo que se borra (borrarlo también en Keycloak): % (%, %, activo=%)',
      fila.username, fila.keycloak_id, fila.rol, fila.activo;
  END LOOP;

  -- Hijos antes que padres: ninguna FK tiene ON DELETE CASCADE.
  DELETE FROM pedido_estado_historial WHERE tenant_id = ejemplo;
  DELETE FROM comprobante_fiscal WHERE tenant_id = ejemplo;
  DELETE FROM pago WHERE tenant_id = ejemplo;
  DELETE FROM linea_pedido WHERE tenant_id = ejemplo;
  DELETE FROM pedido WHERE tenant_id = ejemplo;
  DELETE FROM item_carta WHERE tenant_id = ejemplo;
  DELETE FROM categoria_carta WHERE tenant_id = ejemplo;
  DELETE FROM mesa WHERE tenant_id = ejemplo;
  DELETE FROM usuario WHERE tenant_id = ejemplo;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Filas de usuario borradas: %', n;
  DELETE FROM restaurante WHERE tenant_id = ejemplo;
  DELETE FROM tenant WHERE id = ejemplo;

  RAISE NOTICE 'Tenant Ejemplo retirado.';
END
$$;
