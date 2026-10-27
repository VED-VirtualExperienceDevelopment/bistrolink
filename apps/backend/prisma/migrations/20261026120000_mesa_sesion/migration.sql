-- HU-017 (BL-60): sesión de mesa. El mozo la abre al recibir comensales y la
-- cierra cuando todos los pedidos están entregados o cancelados. El QR impreso
-- solo sirve con la sesión abierta, y cada apertura tiene un id nuevo.
--
-- Migración aditiva (RNF.06): columnas nulas y un CHECK. Las mesas que hoy
-- están ocupadas o cobrando reciben una sesión, para que el CHECK se cumpla y
-- sus comensales puedan seguir pidiendo después del deploy (con el id nuevo
-- que les da el menú al recargar).

-- AlterTable
ALTER TABLE "mesa" ADD COLUMN     "sesion_abierta_en" TIMESTAMPTZ(3),
ADD COLUMN     "sesion_id" UUID;

-- Datos existentes. mesa tiene RLS forzado: se recorre tenant por tenant con
-- app.tenant_id, igual que la API y que la migración de BL-410.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT "id" FROM "tenant" LOOP
    PERFORM set_config('app.tenant_id', t."id"::text, true);
    UPDATE "mesa"
      SET "sesion_id" = gen_random_uuid(), "sesion_abierta_en" = now()
      WHERE "tenant_id" = t."id"
        AND NOT "es_virtual"
        AND "estado" IN ('OCUPADA', 'EN_PROCESO_DE_PAGO');
  END LOOP;
END $$;

-- Coherencia: una mesa física tiene sesión si y solo si está OCUPADA o
-- EN_PROCESO_DE_PAGO. La mesa virtual (pedidos para retirar) no tiene sesión.
ALTER TABLE "mesa" ADD CONSTRAINT "mesa_sesion_coherente_check"
  CHECK (
    "es_virtual"
    OR (("sesion_id" IS NOT NULL) = ("estado" IN ('OCUPADA', 'EN_PROCESO_DE_PAGO')))
  );
