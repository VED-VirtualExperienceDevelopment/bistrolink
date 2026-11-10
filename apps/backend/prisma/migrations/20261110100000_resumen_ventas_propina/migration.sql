-- HU-022 / HU-012 (BL-496): la propina en el resumen de ventas por hora.
--
-- Migración ADITIVA (expand/contract, RNF.06): dos columnas nuevas con valor
-- por defecto. La versión anterior de la API sigue funcionando: su INSERT no
-- las nombra y quedan en 0.
--
-- - propina: suma de pago.propina de los pagos APROBADOS de la hora. Las
--   ventas (monto) siguen siendo el consumo: la propina se informa aparte.
-- - pedidos_con_propina: pedidos de la fila con propina mayor que cero. Igual
--   que `pedidos`, se cuenta por medio de pago: un pedido con dos pagos
--   aprobados de medios distintos aparece una vez en cada fila.
--
-- Las ventas importadas del POS del local (canal POS) no informan propina:
-- quedan en 0.
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla tiene RLS forzado y política
-- de SELECT, INSERT y DELETE, pero no de UPDATE (el job borra y vuelve a
-- insertar una ventana, nunca actualiza). Por eso el recálculo del historial
-- borra y vuelve a insertar las filas de cada tenant, con app.tenant_id fijo,
-- igual que 20261102120000_reportes_sesion_mesa_y_resumen_ventas.

-- AlterTable
ALTER TABLE "resumen_ventas_hora"
  ADD COLUMN "propina" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pedidos_con_propina" INTEGER NOT NULL DEFAULT 0;

-- Recálculo del historial: mismas consultas que ResumenVentasService, sobre
-- todas las horas. `hora` se trunca en UTC, sin depender de la zona horaria
-- de la sesión. Las ventas importadas del POS vuelven a entrar con el canal
-- POS y la propina en 0.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT "id" FROM "tenant" LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);

    DELETE FROM "resumen_ventas_hora" WHERE "tenant_id" = t."id";

    INSERT INTO "resumen_ventas_hora"
      ("tenant_id", "hora", "canal", "medio_pago", "pedidos", "monto", "propina", "pedidos_con_propina")
    SELECT pg."tenant_id",
           date_trunc('hour', pg."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
           p."canal",
           pg."medio_pago",
           COUNT(DISTINCT pg."pedido_id")::int,
           SUM(pg."monto"),
           SUM(pg."propina"),
           (COUNT(DISTINCT pg."pedido_id") FILTER (WHERE pg."propina" > 0))::int
    FROM "pago" pg
    JOIN "pedido" p ON p."id" = pg."pedido_id"
    WHERE pg."tenant_id" = t."id" AND pg."estado" = 'APROBADO'
    GROUP BY 1, 2, 3, 4;

    INSERT INTO "resumen_ventas_hora"
      ("tenant_id", "hora", "canal", "medio_pago", "pedidos", "monto", "propina", "pedidos_con_propina")
    SELECT v."tenant_id",
           date_trunc('hour', v."vendida_en" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
           'POS'::"PedidoCanal",
           v."medio_pago",
           COUNT(*)::int,
           SUM(v."total"),
           0,
           0
    FROM "venta_pos_importada" v
    WHERE v."tenant_id" = t."id" AND NOT v."anulada"
    GROUP BY 1, 2, 3, 4;
  END LOOP;
END $$;
