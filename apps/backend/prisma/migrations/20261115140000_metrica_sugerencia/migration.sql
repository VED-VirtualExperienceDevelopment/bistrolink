-- HU-046 (BL-554): medición de la sugerencia de complementos.
-- - linea_pedido.desde_sugerencia: el comensal agregó el plato desde la
--   sugerencia. Solo sirve para contar las aceptadas al aprobarse el pago.
-- - metrica_sugerencia_dia: contadores por local, día del calendario del
--   local y canal. Mostradas: respuestas del endpoint con al menos un plato.
--   Aceptadas: platos sugeridos de pedidos pagados. No guarda nada del
--   comensal ni del pedido: no se puede reconstruir quién pidió qué.
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla es multi-tenant y lleva RLS
-- forzado como el resto (20260802150000_enable_rls).

-- AlterTable
ALTER TABLE "linea_pedido"
  ADD COLUMN "desde_sugerencia" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "metrica_sugerencia_dia" (
    "tenant_id" UUID NOT NULL,
    "dia" DATE NOT NULL,
    "canal" "PedidoCanal" NOT NULL,
    "mostradas" INTEGER NOT NULL DEFAULT 0,
    "aceptadas" INTEGER NOT NULL DEFAULT 0,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrica_sugerencia_dia_pkey" PRIMARY KEY ("tenant_id","dia","canal"),
    CONSTRAINT "metrica_sugerencia_dia_no_negativos" CHECK ("mostradas" >= 0 AND "aceptadas" >= 0)
);

-- RLS: FORCE para que tampoco el dueño de la tabla la saltee. Se suma con
-- INSERT … ON CONFLICT DO UPDATE (necesita SELECT, INSERT y UPDATE) y se
-- borra al eliminar el establecimiento (BL-418).
ALTER TABLE "metrica_sugerencia_dia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "metrica_sugerencia_dia" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "metrica_sugerencia_dia"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON "metrica_sugerencia_dia"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON "metrica_sugerencia_dia"
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON "metrica_sugerencia_dia"
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
