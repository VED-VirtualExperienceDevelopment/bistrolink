-- HU-009 (BL-454): copia propia del PDF de cada CFE en S3.
--
-- url_pdf (ya existía, siempre nula) pasa a guardar la clave del objeto en
-- S3_BUCKET_CFE. pdf_sha256 es el hash propio del archivo guardado, que se
-- verifica al descargarlo. pdf_intentos y pdf_ultimo_intento_en espacian
-- los reintentos si Surtec o S3 fallan.
--
-- Migración ADITIVA (expand/contract, RNF.06): columnas con default o
-- nullable. La versión anterior de la API no las lee. ALTER TABLE no pasa
-- por RLS.

ALTER TABLE "comprobante_fiscal" ADD COLUMN "pdf_sha256" CHAR(64);
ALTER TABLE "comprobante_fiscal" ADD COLUMN "pdf_intentos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "comprobante_fiscal" ADD COLUMN "pdf_ultimo_intento_en" TIMESTAMPTZ(3);
