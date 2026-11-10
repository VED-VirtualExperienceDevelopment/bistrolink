-- HU-038 (BL-506): umbrales de espera de las comandas del KDS.
--
-- Migración aditiva (RNF.06): tres columnas nuevas con valor por defecto, así
-- los locales que ya existen quedan con 30/60/120 sin backfill. La versión
-- anterior de la API no lee las columnas nuevas. ALTER TABLE no pasa por el
-- RLS.
--
-- restaurante:
-- - minutos_espera_atencion: desde cuántos minutos la comanda pasa a
--   «Atención».
-- - minutos_espera_demorado: desde cuántos minutos pasa a «Demorado».
-- - minutos_espera_demora_alta: desde cuántos minutos pasa a «Demora alta».

-- AlterTable
ALTER TABLE "restaurante" ADD COLUMN "minutos_espera_atencion" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "minutos_espera_demorado" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "minutos_espera_demora_alta" INTEGER NOT NULL DEFAULT 120;

-- Última línea de defensa: la API valida lo mismo con mensajes claros (400).
-- Las filas existentes ya cumplen (30 < 60 < 120).
ALTER TABLE "restaurante"
  ADD CONSTRAINT "restaurante_minutos_espera_rango"
    CHECK ("minutos_espera_atencion" BETWEEN 1 AND 600
           AND "minutos_espera_demorado" BETWEEN 1 AND 600
           AND "minutos_espera_demora_alta" BETWEEN 1 AND 600),
  ADD CONSTRAINT "restaurante_minutos_espera_orden"
    CHECK ("minutos_espera_atencion" < "minutos_espera_demorado"
           AND "minutos_espera_demorado" < "minutos_espera_demora_alta");
