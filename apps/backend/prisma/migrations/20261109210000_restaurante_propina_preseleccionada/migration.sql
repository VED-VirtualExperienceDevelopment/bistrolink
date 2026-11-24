-- HU-022 (BL-495): el local puede pedir que la pantalla de pago del comensal
-- abra con el 10 % de propina marcado como «Sugerida». Solo se marca si el
-- 10 % está entre los porcentajes sugeridos (propinas_sugeridas, HU-020).
--
-- Default false: sin que el administrador lo active, no se marca nada y la
-- propina se elige de cero, como hasta ahora.
--
-- Migración ADITIVA (expand/contract, RNF.06): columna con default. La
-- versión anterior de la API no la lee. ALTER TABLE no pasa por RLS.

ALTER TABLE "restaurante" ADD COLUMN "propina_preseleccionada" BOOLEAN NOT NULL DEFAULT false;