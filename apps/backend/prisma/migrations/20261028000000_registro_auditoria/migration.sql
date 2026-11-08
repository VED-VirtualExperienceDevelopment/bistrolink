-- HU-035 (BL-205): registro de auditoría de acciones administrativas.
--
-- Migración aditiva (RNF.06): una tabla nueva, sin tocar datos existentes.
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla es multi-tenant y lleva RLS,
-- igual que el resto (20260802150000_enable_rls).
--
-- Append-only:
-- - RLS solo tiene políticas de SELECT e INSERT, y está forzado.
-- - Además, al rol de la aplicación (bistrolink_app) se le quitan UPDATE y
--   DELETE: un intento de modificar o borrar falla con «permission denied»
--   en lugar de afectar 0 filas en silencio.
-- - Sin claves foráneas: el registro sobrevive a la baja de usuarios y a la
--   eliminación de un establecimiento.

-- CreateTable
CREATE TABLE "registro_auditoria" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_keycloak_id" VARCHAR(64) NOT NULL,
    "usuario_id" UUID,
    "accion" VARCHAR(60) NOT NULL,
    "entidad" VARCHAR(40) NOT NULL,
    "entidad_id" VARCHAR(64),
    "valores_antes" JSONB,
    "valores_despues" JSONB,
    "detalle" JSONB,
    "ip" VARCHAR(45),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registro_auditoria_tenant_id_created_at_idx" ON "registro_auditoria"("tenant_id", "created_at");

-- RLS: el tenant solo ve e inserta sus propios registros.
ALTER TABLE "registro_auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "registro_auditoria" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "registro_auditoria"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON "registro_auditoria"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- Sin UPDATE ni DELETE para el rol de la aplicación. El rol existe en local,
-- en CI y en staging (scripts/db/init.sql, BL-275); si no existe, no hay nada
-- que quitar.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'bistrolink_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "registro_auditoria" FROM bistrolink_app;
  END IF;
END
$$;
