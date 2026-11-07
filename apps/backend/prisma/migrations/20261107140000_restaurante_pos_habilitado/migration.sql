-- HU-007b (BL-80): el local registra cobros hechos con su propio POS
-- (crédito o débito). El cobro lo hace el POS; BistroLink solo lo registra
-- con el número de autorización del voucher (en pago.pasarela_referencia).
--
-- Default true: casi todos los locales tienen POS (Ley 19.210 de inclusión
-- financiera). El administrador lo apaga en Configuración si no lo usa.
--
-- Migración ADITIVA (expand/contract, RNF.06): columna con default. La
-- versión anterior de la API no la lee. ALTER TABLE no pasa por RLS.

ALTER TABLE "restaurante" ADD COLUMN "pos_habilitado" BOOLEAN NOT NULL DEFAULT true;
