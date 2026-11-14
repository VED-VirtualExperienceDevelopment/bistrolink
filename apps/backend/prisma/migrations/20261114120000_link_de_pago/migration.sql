-- HU-033 (BL-203): link de pago que genera el mozo para un pedido pendiente.
--
-- Migración ADITIVA (expand/contract, RNF.06): dos columnas nulas. La
-- versión anterior de la API no las lee.
--
-- link_pago_hash: SHA-256 (hex) del nonce del link vigente. Uno solo por
-- pedido: generar otro lo reemplaza y el anterior deja de servir.
-- link_pago_vence_en: hasta cuándo sirve el link (HU-032).

ALTER TABLE "pedido"
  ADD COLUMN "link_pago_hash" CHAR(64),
  ADD COLUMN "link_pago_vence_en" TIMESTAMPTZ(3);

ALTER TABLE "pedido"
  ADD CONSTRAINT "pedido_link_pago_completo"
    CHECK (("link_pago_hash" IS NULL) = ("link_pago_vence_en" IS NULL));
