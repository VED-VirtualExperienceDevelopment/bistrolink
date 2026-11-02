-- HU-009 (BL-453): e-Factura con RUT y razón social del comensal.
--
-- El comensal la pide antes de pagar; el CFE se emite cuando se aprueba el
-- pago (tarjeta o cobro del mozo), por eso los datos van en el pedido. Solo
-- se guardan si aceptó el aviso de privacidad (HU-036, Ley 18.331): sin
-- aceptarlo quedan nulos y se emite un e-Ticket.
--
-- receptor_anonimizado_en: el administrador anonimizó el RUT y la razón
-- social a pedido del comensal (los dos quedan nulos). El CFE emitido y los
-- montos no se tocan: se conservan 5 años por la obligación fiscal.
--
-- Migración ADITIVA (expand/contract, RNF.06): columnas nullable, sin
-- default. La versión anterior de la API no las lee. ALTER TABLE no pasa
-- por RLS; las filas siguen protegidas por la política de pedido.

ALTER TABLE "pedido" ADD COLUMN "receptor_rut" VARCHAR(12);
ALTER TABLE "pedido" ADD COLUMN "receptor_razon_social" VARCHAR(150);
ALTER TABLE "pedido" ADD COLUMN "receptor_consentido_en" TIMESTAMPTZ(3);
ALTER TABLE "pedido" ADD COLUMN "receptor_anonimizado_en" TIMESTAMPTZ(3);

CREATE INDEX "pedido_tenant_id_receptor_rut_idx" ON "pedido"("tenant_id", "receptor_rut");
