-- HU-032 (BL-202): vencimiento y conciliación de pagos pendientes.
--
-- Migración aditiva (RNF.06): una columna nula en pago y una tabla nueva.
-- - pago.motivo_rechazo: por qué quedó RECHAZADO ('VENCIDO' si venció sin
--   confirmación). El comensal ve un mensaje distinto según el motivo.
-- - pago_estado_historial: cada cambio de estado de un pago con su fecha y
--   origen (cobro, webhook, conciliación o vencimiento). Solo se agrega.
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla nueva es multi-tenant y lleva
-- las mismas políticas RLS que el resto (20260802150000_enable_rls).

-- CreateEnum
CREATE TYPE "PagoOrigen" AS ENUM ('COBRO', 'WEBHOOK', 'CONCILIACION', 'VENCIMIENTO');

-- AlterTable
ALTER TABLE "pago" ADD COLUMN "motivo_rechazo" VARCHAR(60);

-- CreateTable
CREATE TABLE "pago_estado_historial" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pago_id" UUID NOT NULL,
    "estado_anterior" "PagoEstado" NOT NULL,
    "estado_nuevo" "PagoEstado" NOT NULL,
    "origen" "PagoOrigen" NOT NULL,
    "detalle" VARCHAR(60),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_estado_historial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pago_estado_historial_pago_id_idx" ON "pago_estado_historial"("pago_id");

-- AddForeignKey
ALTER TABLE "pago_estado_historial" ADD CONSTRAINT "pago_estado_historial_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: mismas políticas que pago. FORCE para que tampoco el dueño de la
-- tabla las saltee.
ALTER TABLE "pago_estado_historial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pago_estado_historial" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "pago_estado_historial"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "pago_estado_historial"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Solo se agrega: sin políticas de UPDATE ni DELETE, con RLS forzado la base
-- no deja modificar ni borrar ninguna fila (un UPDATE o DELETE afecta 0
-- filas), para todos los roles sin BYPASSRLS.
