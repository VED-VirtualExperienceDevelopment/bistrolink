-- HU-043 (BL-562): foto de portada del banner de la carta.
--
-- Migración aditiva (RNF.06): una columna nullable, así los locales que ya
-- existen quedan con la portada por defecto, sin backfill. La versión
-- anterior de la API no lee la columna nueva. ALTER TABLE no pasa por el
-- RLS.
--
-- restaurante:
-- - portada_key: clave de la portada en el almacenamiento de imágenes
--   ({tenant}/menu/portada/{uuid}.webp; la valida la API). NULL = la portada
--   por defecto.

-- AlterTable
ALTER TABLE "restaurante" ADD COLUMN "portada_key" TEXT;
