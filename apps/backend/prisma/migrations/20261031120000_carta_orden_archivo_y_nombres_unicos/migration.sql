-- BL-393 (BL-392, Gestión de Carta): orden manual de los ítems, baja lógica
-- (archivo) de ítems y categorías, descripción de la categoría, CHECK de
-- precio y nombres únicos.
--
-- Migración ADITIVA (expand/contract, RNF.06): solo agrega columnas,
-- restricciones e índices. La versión anterior de la API sigue funcionando
-- porque no lee las columnas nuevas.
--
-- ANTES de aplicarla en staging o production, correr la consulta de
-- duplicados y precios negativos de la descripción del PR. Si hay nombres
-- repetidos, los índices únicos fallan, el pre-deploy cancela el despliegue y
-- la versión anterior sigue en servicio (no queda nada aplicado a medias:
-- Prisma corre cada migración en una transacción).

-- ── item_carta ────────────────────────────────────────────────────────────────

ALTER TABLE "item_carta"
  ADD COLUMN "orden" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "archivado_en" TIMESTAMPTZ(3);

-- la base es la última línea de defensa del precio.
ALTER TABLE "item_carta"
  ADD CONSTRAINT "item_carta_precio_no_negativo" CHECK ("precio" >= 0);

-- ── categoria_carta ───────────────────────────────────────────────────────────

-- "activo" se mantiene con el significado «visible» (no se renombra para no
-- romper la versión anterior de la API durante el deploy).
ALTER TABLE "categoria_carta"
  ADD COLUMN "descripcion" VARCHAR(200),
  ADD COLUMN "archivada_en" TIMESTAMPTZ(3);

-- ── Orden inicial de los ítems ────────────────────────────────────────────────
-- Se completa con el orden alfabético que usa hoy la carta (dentro de cada
-- categoría), así se ve igual que antes. item_carta tiene RLS forzado: se fija
-- app.tenant_id por cada tenant, igual que 20261026120000_mesa_sesion.

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT "id" FROM "tenant" LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);
    UPDATE "item_carta" AS i
      SET "orden" = o."posicion"
      FROM (
        SELECT "id",
               ROW_NUMBER() OVER (PARTITION BY "categoria_id" ORDER BY "nombre", "id") AS "posicion"
        FROM "item_carta"
        WHERE "tenant_id" = t."id"
      ) AS o
      WHERE i."id" = o."id";
  END LOOP;
END $$;

-- ── Índices ───────────────────────────────────────────────────────────────────

-- Lectura de la carta ordenada (Anexo 6 §11). Está declarado en schema.prisma.
CREATE INDEX "item_carta_tenant_id_categoria_id_orden_idx"
  ON "item_carta"("tenant_id", "categoria_id", "orden");

-- Sin nombres repetidos (sin distinguir mayúsculas) entre
-- los ítems no archivados de una categoría ni entre las categorías no
-- archivadas de un restaurante. Al archivar, el nombre queda libre.
--
-- Prisma no puede expresar índices parciales ni sobre expresiones: por eso
-- NO están en schema.prisma. Si en una migración futura `prisma migrate dev`
-- propone un DROP INDEX de alguno de estos dos, hay que sacar esa línea.
CREATE UNIQUE INDEX "item_carta_categoria_nombre_activo_key"
  ON "item_carta"("categoria_id", lower("nombre"))
  WHERE "archivado_en" IS NULL;

CREATE UNIQUE INDEX "categoria_carta_restaurante_nombre_activa_key"
  ON "categoria_carta"("restaurante_id", lower("nombre"))
  WHERE "archivada_en" IS NULL;