-- HU-043 (BL-531): marca propia del local, fase 1 (logo y plantilla).
--
-- Migración aditiva (RNF.06): dos columnas nuevas, una nullable y otra con
-- valor por defecto, así los locales que ya existen quedan sin logo y con la
-- plantilla «clasica» sin backfill. La versión anterior de la API no lee las
-- columnas nuevas. ALTER TABLE no pasa por el RLS.
--
-- restaurante:
-- - logo_key: clave del logo en el almacenamiento de imágenes (la sube y la
--   valida BL-532). NULL = sin logo: la carta muestra el nombre del local.
-- - plantilla: plantilla de colores de la carta del comensal. Los colores
--   viven en el frontend; acá solo se guarda el nombre.

-- AlterTable
ALTER TABLE "restaurante" ADD COLUMN "logo_key" TEXT,
ADD COLUMN "plantilla" VARCHAR(20) NOT NULL DEFAULT 'clasica';

-- Última línea de defensa: la API valida lo mismo con mensajes claros (400).
-- Las filas existentes ya cumplen (todas quedan en 'clasica').
ALTER TABLE "restaurante"
  ADD CONSTRAINT "restaurante_plantilla_valida"
    CHECK ("plantilla" IN ('clasica', 'gourmet', 'rapida', 'familiar'));
