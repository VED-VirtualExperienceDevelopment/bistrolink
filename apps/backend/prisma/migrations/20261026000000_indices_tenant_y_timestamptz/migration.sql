-- BL-213 (Línea de Base §3.3.4, Anexo 6 §11): índices compuestos por tenant
-- y marcas de tiempo con zona horaria (timestamptz).
--
-- 1) Índices: migración ADITIVA (RNF.06). Empiezan por tenant_id, así sirven
--    junto con el predicado de RLS (tenant_id = app.tenant_id). El de
--    comprobante_fiscal(tenant_id, estado) queda para HU-009, cuando exista
--    la columna estado.
--
-- 2) timestamp -> timestamptz: migración TRANSFORMACIONAL (RNF.06). Requiere
--    un respaldo verificado de la base antes de aplicarla en staging o
--    production.
--
--    Los valores existentes se interpretan como UTC (USING ... AT TIME ZONE
--    'UTC'), NO como America/Montevideo: Prisma siempre escribe las fechas en
--    UTC, también en columnas sin zona horaria. Interpretarlos como hora de
--    Montevideo correría todas las fechas 3 horas. Mismo criterio que la
--    migración 20261022120000 (BL-410).
--
--    Sin el USING, Postgres convertiría con el TimeZone de la sesión que
--    aplica la migración, y el resultado dependería de dónde se corra.
--
--    Las columnas @db.Date (cae_vencimiento, retencion_hasta) son fechas sin
--    hora y no cambian. tenant.suspendido_en y tenant.alta_completada_en ya
--    son timestamptz (BL-410).
--
-- La zona horaria del local (restaurante.timezone) se aplica al MOSTRAR las
-- fechas, no al guardarlas.

-- CreateIndex
CREATE INDEX "pedido_tenant_id_created_at_idx" ON "pedido"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "pedido_tenant_id_estado_idx" ON "pedido"("tenant_id", "estado");

-- CreateIndex
CREATE INDEX "linea_pedido_pedido_id_idx" ON "linea_pedido"("pedido_id");

-- CreateIndex
CREATE INDEX "pago_pedido_id_idx" ON "pago"("pedido_id");

-- AlterTable
ALTER TABLE "tenant"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "restaurante"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "usuario"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "mesa"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "categoria_carta"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "item_carta"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pedido"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "linea_pedido"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pago"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "comprobante_fiscal"
  ALTER COLUMN "fecha_emision" SET DATA TYPE TIMESTAMPTZ(3) USING "fecha_emision" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "pedido_estado_historial"
  ALTER COLUMN "timestamp" SET DATA TYPE TIMESTAMPTZ(3) USING "timestamp" AT TIME ZONE 'UTC';
