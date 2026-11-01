-- BL-452: Plexo queda fuera del MVP, igual que Handy.
--
-- Mercado Pago es la única pasarela del proyecto (decisión del 17/10/2026,
-- Anexo 2 v1.3). HU-020 (BL-72) había dejado plexo_habilitado en true por
-- defecto; se corrige: la columna pasa a false en todos los restaurantes y el
-- valor por defecto también. Con el flag en false, la API rechaza con 409 un
-- pago con Plexo, y la configuración no deja habilitarlo hasta que exista su
-- integración.
--
-- No cambia la estructura: solo el valor por defecto y los datos. Ningún
-- local cobra con Plexo (no está integrado), así que el comportamiento real no
-- cambia. La versión anterior de la API sigue funcionando.

ALTER TABLE "restaurante" ALTER COLUMN "plexo_habilitado" SET DEFAULT false;

-- "restaurante" tiene RLS forzado: se fija app.tenant_id por cada tenant,
-- igual que 20261031120000_carta_orden_archivo_y_nombres_unicos, para no
-- depender de que el rol de migraciones saltee el RLS.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT "id" FROM "tenant" LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);
    UPDATE "restaurante"
      SET "plexo_habilitado" = false
      WHERE "tenant_id" = t."id" AND "plexo_habilitado";
  END LOOP;
END $$;
