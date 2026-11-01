-- BL-399 (BL-392, Gestión de Carta): el orden de categorías e ítems lo
-- asigna siempre la API y nadie lo escribe a mano.
--
-- 1. Renumera 1, 2, 3… el orden de las categorías de cada restaurante y el de
--    los ítems de cada categoría, respetando el orden que ya tenían (a igual
--    orden, por nombre). Antes el orden de las categorías se escribía a mano
--    y había empates (varios en 0) y saltos.
-- 2. Saca el DEFAULT 0 de las dos columnas: si una versión de la API no
--    asigna el orden, la base lo rechaza en lugar de poner un 0 que manda el
--    registro al principio de la carta.
--
-- Compatible con el deploy (expand/contract): la versión anterior de la API
-- ya manda siempre el orden al crear (categorías: el del formulario o 0;
-- ítems: el siguiente de su categoría, BL-394).

-- categoria_carta e item_carta tienen RLS forzado: se fija app.tenant_id por
-- cada tenant, igual que 20261031120000_carta_orden_archivo_y_nombres_unicos.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT "id" FROM "tenant" LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);

    UPDATE "categoria_carta" AS c
      SET "orden" = o."posicion"
      FROM (
        SELECT "id",
               ROW_NUMBER() OVER (
                 PARTITION BY "restaurante_id"
                 ORDER BY "orden", "nombre", "id"
               ) AS "posicion"
        FROM "categoria_carta"
        WHERE "tenant_id" = t."id"
      ) AS o
      WHERE c."id" = o."id";

    UPDATE "item_carta" AS i
      SET "orden" = o."posicion"
      FROM (
        SELECT "id",
               ROW_NUMBER() OVER (
                 PARTITION BY "categoria_id"
                 ORDER BY "orden", "nombre", "id"
               ) AS "posicion"
        FROM "item_carta"
        WHERE "tenant_id" = t."id"
      ) AS o
      WHERE i."id" = o."id";
  END LOOP;
END $$;

ALTER TABLE "categoria_carta" ALTER COLUMN "orden" DROP DEFAULT;
ALTER TABLE "item_carta" ALTER COLUMN "orden" DROP DEFAULT;