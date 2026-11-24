-- HU-011 (BL-488): sincronización de las ventas con el POS del local.
--
-- Migración ADITIVA (expand/contract, RNF.06): una columna con default y una
-- tabla nueva. La versión anterior de la API no las lee.
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla es multi-tenant y lleva RLS,
-- igual que el resto (20260802150000_enable_rls). Es una bandeja de salida:
-- el job la actualiza (estado, intentos), así que tiene política de UPDATE.
-- No se borran filas: sin política de DELETE.

-- Interruptor por local. Default false: se activa cuando hay un POS conectado.
ALTER TABLE "restaurante" ADD COLUMN "pos_sincronizacion_habilitada" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "PosSincronizacionTipo" AS ENUM ('VENTA', 'ANULACION');

-- CreateEnum
CREATE TYPE "PosSincronizacionEstado" AS ENUM ('PENDIENTE', 'ENVIADA', 'ERROR', 'DESCARTADA');

-- CreateTable
CREATE TABLE "sincronizacion_pos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pedido_id" UUID NOT NULL,
    "tipo" "PosSincronizacionTipo" NOT NULL,
    "estado" "PosSincronizacionEstado" NOT NULL DEFAULT 'PENDIENTE',
    "pos_ref" VARCHAR(64),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimo_intento_en" TIMESTAMPTZ(3),
    "ultimo_error" VARCHAR(200),
    "enviada_en" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sincronizacion_pos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sincronizacion_pos_pedido_id_tipo_key" ON "sincronizacion_pos"("pedido_id", "tipo");

-- CreateIndex
CREATE INDEX "sincronizacion_pos_tenant_id_estado_created_at_idx" ON "sincronizacion_pos"("tenant_id", "estado", "created_at");

-- CreateIndex
CREATE INDEX "sincronizacion_pos_tenant_id_created_at_idx" ON "sincronizacion_pos"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "sincronizacion_pos" ADD CONSTRAINT "sincronizacion_pos_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: el tenant solo ve, inserta y actualiza sus propias filas.
ALTER TABLE "sincronizacion_pos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sincronizacion_pos" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "sincronizacion_pos"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "sincronizacion_pos"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON "sincronizacion_pos"
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
