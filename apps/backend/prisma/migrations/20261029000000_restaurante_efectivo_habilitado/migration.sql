-- HU-031 (BL-201): el local acepta efectivo. Aditiva: default true, los
-- locales existentes siguen cobrando en efectivo. HU-020 (BL-72) la administra.
ALTER TABLE "restaurante" ADD COLUMN "efectivo_habilitado" BOOLEAN NOT NULL DEFAULT true;
