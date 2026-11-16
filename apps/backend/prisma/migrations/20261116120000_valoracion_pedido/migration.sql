-- HU-050 (BL-558): valoración privada del pedido (1 a 5 y comentario
-- opcional), después de la entrega. Solo la ve el Administrador.
-- - Anónima (E1): no guarda nada del comensal. pedido_id es la clave solo
--   para impedir que se valore dos veces; la pantalla del Administrador no
--   lo muestra.
-- - Del momento se guarda el día del calendario del local, no la hora: así
--   no se puede cruzar con la hora de entrega de una mesa.
-- - Se borra con el pedido (ON DELETE CASCADE).
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla es multi-tenant y lleva RLS
-- forzado como el resto (20260802150000_enable_rls).

-- CreateTable
CREATE TABLE "valoracion_pedido" (
    "pedido_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dia" DATE NOT NULL,
    "estrellas" SMALLINT NOT NULL,
    "comentario" VARCHAR(500),

    CONSTRAINT "valoracion_pedido_pkey" PRIMARY KEY ("pedido_id"),
    CONSTRAINT "valoracion_pedido_estrellas_rango" CHECK ("estrellas" BETWEEN 1 AND 5)
);

-- CreateIndex
CREATE INDEX "valoracion_pedido_tenant_id_dia_idx" ON "valoracion_pedido"("tenant_id", "dia");

-- AddForeignKey
ALTER TABLE "valoracion_pedido" ADD CONSTRAINT "valoracion_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: FORCE para que tampoco el dueño de la tabla la saltee. El comensal
-- inserta y el Administrador lee; no se edita. DELETE para el borrado del
-- pedido.
ALTER TABLE "valoracion_pedido" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "valoracion_pedido" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "valoracion_pedido"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON "valoracion_pedido"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON "valoracion_pedido"
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
