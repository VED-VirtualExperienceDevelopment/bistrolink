-- HU-012 (BL-108) y BL-219: datos para el dashboard de reportes.
--
-- Migración aditiva (RNF.06): tres tablas nuevas y un índice. La versión
-- anterior de la API sigue funcionando (no las usa).
-- - sesion_mesa: historial de sesiones de mesa (HU-017) para la rotación de
--   mesas. Hasta ahora, al cerrar la mesa se perdía la sesión.
-- - resumen_ventas_hora y resumen_platos_hora: resumen por hora de las ventas
--   (pagos APROBADOS) para que el dashboard no consulte las tablas
--   operativas. Las mantiene el job de agregación de la aplicación.
-- - pago(tenant_id, created_at): el job recalcula una ventana de horas por
--   tenant.
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): las tablas nuevas son multi-tenant y
-- llevan RLS forzado como el resto (20260802150000_enable_rls).

-- CreateTable
CREATE TABLE "sesion_mesa" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mesa_id" UUID NOT NULL,
    "abierta_en" TIMESTAMPTZ(3) NOT NULL,
    "cerrada_en" TIMESTAMPTZ(3),

    CONSTRAINT "sesion_mesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resumen_ventas_hora" (
    "tenant_id" UUID NOT NULL,
    "hora" TIMESTAMPTZ(3) NOT NULL,
    "canal" "PedidoCanal" NOT NULL,
    "medio_pago" TEXT NOT NULL,
    "pedidos" INTEGER NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumen_ventas_hora_pkey" PRIMARY KEY ("tenant_id","hora","canal","medio_pago")
);

-- CreateTable
CREATE TABLE "resumen_platos_hora" (
    "tenant_id" UUID NOT NULL,
    "hora" TIMESTAMPTZ(3) NOT NULL,
    "canal" "PedidoCanal" NOT NULL,
    "item_carta_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "recaudado" DECIMAL(12,2) NOT NULL,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumen_platos_hora_pkey" PRIMARY KEY ("tenant_id","hora","canal","item_carta_id")
);

-- CreateIndex
CREATE INDEX "sesion_mesa_tenant_id_cerrada_en_idx" ON "sesion_mesa"("tenant_id", "cerrada_en");

-- CreateIndex
CREATE INDEX "pago_tenant_id_created_at_idx" ON "pago"("tenant_id", "created_at");

-- RLS: FORCE para que tampoco el dueño de las tablas las saltee.
-- sesion_mesa: se lee, se agrega, se cierra (UPDATE) y se borra al eliminar
-- el establecimiento (BL-418).
-- resumen_*: el job borra y vuelve a insertar una ventana; nunca actualiza.
ALTER TABLE "sesion_mesa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sesion_mesa" FORCE ROW LEVEL SECURITY;
ALTER TABLE "resumen_ventas_hora" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resumen_ventas_hora" FORCE ROW LEVEL SECURITY;
ALTER TABLE "resumen_platos_hora" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resumen_platos_hora" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tabla TEXT;
BEGIN
  FOREACH tabla IN ARRAY ARRAY['sesion_mesa', 'resumen_ventas_hora', 'resumen_platos_hora'] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON %I
         FOR SELECT
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid);',
      tabla
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON %I
         FOR INSERT
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid);',
      tabla
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON %I
         FOR DELETE
         USING (tenant_id = current_setting(''app.tenant_id'')::uuid);',
      tabla
    );
  END LOOP;
END $$;

CREATE POLICY tenant_isolation_update ON "sesion_mesa"
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Datos existentes. Las tablas tienen RLS forzado: se fija app.tenant_id por
-- cada tenant, igual que 20261101180000_restaurante_plexo_fuera_del_mvp, para
-- no depender de que el rol de migraciones saltee el RLS.
-- - Las mesas abiertas en este momento entran al historial con su sesión, así
--   el cierre la encuentra. Las sesiones ya cerradas no se pueden recuperar:
--   la rotación cuenta desde esta versión.
-- - El resumen se carga con todas las ventas existentes (misma consulta que
--   el job de agregación). `hora` se trunca en UTC, sin depender de la zona
--   horaria de la sesión.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT "id" FROM "tenant" LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);

    INSERT INTO "sesion_mesa" ("id", "tenant_id", "mesa_id", "abierta_en")
    SELECT m."sesion_id", m."tenant_id", m."id", m."sesion_abierta_en"
    FROM "mesa" m
    WHERE m."tenant_id" = t."id"
      AND m."sesion_id" IS NOT NULL
      AND m."sesion_abierta_en" IS NOT NULL;

    INSERT INTO "resumen_ventas_hora"
      ("tenant_id", "hora", "canal", "medio_pago", "pedidos", "monto")
    SELECT pg."tenant_id",
           date_trunc('hour', pg."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
           p."canal",
           pg."medio_pago",
           COUNT(DISTINCT pg."pedido_id")::int,
           SUM(pg."monto")
    FROM "pago" pg
    JOIN "pedido" p ON p."id" = pg."pedido_id"
    WHERE pg."tenant_id" = t."id" AND pg."estado" = 'APROBADO'
    GROUP BY 1, 2, 3, 4;

    -- Cada pedido cuenta en la hora de su primer pago aprobado (un pedido
    -- con dos pagos aprobados no duplica sus platos).
    INSERT INTO "resumen_platos_hora"
      ("tenant_id", "hora", "canal", "item_carta_id", "nombre", "cantidad", "recaudado")
    SELECT p."tenant_id",
           date_trunc('hour', pagados."pagado_en" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
           p."canal",
           lp."item_carta_id",
           MAX(lp."nombre_snapshot"),
           SUM(lp."cantidad")::int,
           SUM(lp."subtotal")
    FROM (
      SELECT "pedido_id", MIN("created_at") AS "pagado_en"
      FROM "pago"
      WHERE "tenant_id" = t."id" AND "estado" = 'APROBADO'
      GROUP BY "pedido_id"
    ) pagados
    JOIN "pedido" p ON p."id" = pagados."pedido_id"
    JOIN "linea_pedido" lp ON lp."pedido_id" = p."id"
    GROUP BY 1, 2, 3, 4;
  END LOOP;
END $$;
