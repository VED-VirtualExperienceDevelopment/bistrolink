-- HU-011 (BL-489): ventas hechas directamente en el POS del local,
-- importadas para el dashboard con el canal POS.
--
-- Migración ADITIVA (expand/contract, RNF.06): un valor nuevo del enum y una
-- tabla nueva. La versión anterior de la API no las lee.
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla es multi-tenant y lleva RLS,
-- igual que el resto. La importación actualiza las ventas que se anulan en el
-- POS, así que tiene política de UPDATE. No se borran filas: sin DELETE.

-- Canal del resumen del dashboard. Ningún pedido lo usa.
ALTER TYPE "PedidoCanal" ADD VALUE 'POS';

-- CreateTable
CREATE TABLE "venta_pos_importada" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "id_pos" VARCHAR(64) NOT NULL,
    "vendida_en" TIMESTAMPTZ(3) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "medio_pago" VARCHAR(30) NOT NULL,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "actualizada_en_pos" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "venta_pos_importada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "venta_pos_importada_tenant_id_id_pos_key" ON "venta_pos_importada"("tenant_id", "id_pos");

-- CreateIndex
CREATE INDEX "venta_pos_importada_tenant_id_vendida_en_idx" ON "venta_pos_importada"("tenant_id", "vendida_en");

-- CreateIndex
CREATE INDEX "venta_pos_importada_tenant_id_actualizada_en_pos_idx" ON "venta_pos_importada"("tenant_id", "actualizada_en_pos");

-- RLS: el tenant solo ve, inserta y actualiza sus propias filas.
ALTER TABLE "venta_pos_importada" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "venta_pos_importada" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "venta_pos_importada"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "venta_pos_importada"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "venta_pos_importada"
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
