-- HU-046 (BL-552): reglas de asociación entre platos («quien pide A suele
-- pedir B») por local, para sugerir un complemento antes de pagar. Las
-- recalcula el job nocturno de la aplicación (ReglasComplementoJob): borra
-- las del local y las vuelve a insertar. No hay carga inicial: hasta la
-- primera corrida, el endpoint usa el respaldo de popularidad (HU-045).
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla es multi-tenant y lleva RLS
-- forzado como el resto (20260802150000_enable_rls). Solo guarda conteos
-- agregados: nada del comensal ni de un pedido en particular.

-- CreateTable
CREATE TABLE "regla_complemento" (
    "tenant_id" UUID NOT NULL,
    "antecedente_id" UUID NOT NULL,
    "consecuente_id" UUID NOT NULL,
    "pedidos_con_ambos" INTEGER NOT NULL,
    "soporte" DOUBLE PRECISION NOT NULL,
    "confianza" DOUBLE PRECISION NOT NULL,
    "lift" DOUBLE PRECISION NOT NULL,
    "calculada_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "regla_complemento_pkey" PRIMARY KEY ("tenant_id","antecedente_id","consecuente_id"),
    CONSTRAINT "regla_complemento_distintos" CHECK ("antecedente_id" <> "consecuente_id")
);

-- AddForeignKey: si se elimina un plato (solo los que no tienen pedidos),
-- se van sus reglas.
ALTER TABLE "regla_complemento" ADD CONSTRAINT "regla_complemento_antecedente_id_fkey" FOREIGN KEY ("antecedente_id") REFERENCES "item_carta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "regla_complemento" ADD CONSTRAINT "regla_complemento_consecuente_id_fkey" FOREIGN KEY ("consecuente_id") REFERENCES "item_carta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: FORCE para que tampoco el dueño de la tabla la saltee. El job borra
-- y vuelve a insertar; nunca actualiza.
ALTER TABLE "regla_complemento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "regla_complemento" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "regla_complemento"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON "regla_complemento"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON "regla_complemento"
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
