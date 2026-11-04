-- HU-009 (BL-455): estado de cada CFE ante la DGI.
--
-- Surtec no avisa (sin webhooks): EstadoDgiJob consulta
-- GET /consulta/comprobantes/emitidos y guarda el estado hasta que es
-- definitivo. AE = ACEPTADO, BE = RECHAZADO, CE = OBSERVADO; mientras DGI
-- no responde, PENDIENTE.
--
-- Migración ADITIVA (expand/contract, RNF.06): tipo nuevo y columnas con
-- default o nullable. Los comprobantes que ya existen quedan PENDIENTE: el
-- job revisa los de los últimos días (ESTADO_DGI_DIAS). La versión anterior
-- de la API no lee estas columnas. ALTER TABLE no pasa por RLS.

CREATE TYPE "CfeEstadoDgi" AS ENUM ('PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'OBSERVADO');

ALTER TABLE "comprobante_fiscal" ADD COLUMN "estado_dgi" "CfeEstadoDgi" NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE "comprobante_fiscal" ADD COLUMN "estado_dgi_motivo" VARCHAR(200);
ALTER TABLE "comprobante_fiscal" ADD COLUMN "estado_dgi_actualizado_en" TIMESTAMPTZ(3);

CREATE INDEX "comprobante_fiscal_tenant_id_estado_dgi_idx" ON "comprobante_fiscal"("tenant_id", "estado_dgi");
CREATE INDEX "comprobante_fiscal_tenant_id_fecha_emision_idx" ON "comprobante_fiscal"("tenant_id", "fecha_emision");
