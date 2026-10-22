-- BL-410 (HU de gestión de establecimientos, BL-404): estado del
-- establecimiento (suspensión) y fin del alta en la tabla tenant.
--
-- Migración aditiva (expand/contract): solo agrega columnas con valor por
-- defecto o nulas. La versión anterior de la API no las lee y sigue
-- funcionando mientras dura el deploy. La tabla tenant no tiene RLS.

-- CreateEnum
CREATE TYPE "TenantEstado" AS ENUM ('ACTIVO', 'SUSPENDIDO');

-- AlterTable
ALTER TABLE "tenant" ADD COLUMN     "alta_completada_en" TIMESTAMPTZ(3),
ADD COLUMN     "estado" "TenantEstado" NOT NULL DEFAULT 'ACTIVO',
ADD COLUMN     "motivo_suspension" VARCHAR(200),
ADD COLUMN     "suspendido_en" TIMESTAMPTZ(3);

-- Coherencia de la suspensión: un tenant SUSPENDIDO tiene fecha de
-- suspensión y uno ACTIVO no la tiene (BL-413 escribe los dos juntos y los
-- limpia al reactivar).
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_suspension_coherente_check"
  CHECK (("estado" = 'SUSPENDIDO') = ("suspendido_en" IS NOT NULL));

-- Datos existentes: los tenants que ya tienen restaurante quedan con el alta
-- completa, con la fecha de su alta (no se sabe cuándo terminó, pero fue
-- después; created_at se guarda en UTC). Los que no tienen restaurante
-- quedan en «Alta incompleta», como ya los mostraba el listado (BL-407).
--
-- `restaurante` tiene RLS forzado. Para no depender de que el rol que
-- aplica la migración lo saltee, se consulta tenant por tenant con
-- app.tenant_id, igual que la API (set_config local: no queda puesto
-- después de este bloque).
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT "id" FROM "tenant" WHERE "alta_completada_en" IS NULL LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);
    IF EXISTS (SELECT 1 FROM "restaurante" r WHERE r."tenant_id" = t."id") THEN
      UPDATE "tenant" SET "alta_completada_en" = "created_at" AT TIME ZONE 'UTC'
        WHERE "id" = t."id";
    END IF;
  END LOOP;
END $$;
