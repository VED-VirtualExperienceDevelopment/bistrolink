-- HU-007: emisión de CFE con Surtec (FEU) tras un pago aprobado.
-- El proveedor devuelve una URL de consulta DGI y un hash en Base64 (44 chars);
-- el XML y el PDF se guardan recién en HU-009 (BL-92), por eso pasan a ser opcionales.
ALTER TABLE "comprobante_fiscal" ALTER COLUMN "url_xml" DROP NOT NULL;
ALTER TABLE "comprobante_fiscal" ALTER COLUMN "url_pdf" DROP NOT NULL;
ALTER TABLE "comprobante_fiscal" ALTER COLUMN "hash_sha256" DROP NOT NULL;
-- CHAR(64) rellena con espacios: un hash de 44 caracteres quedaría alterado.
ALTER TABLE "comprobante_fiscal" ALTER COLUMN "hash_sha256" TYPE VARCHAR(64);

ALTER TABLE "comprobante_fiscal"
  ADD COLUMN "proveedor" TEXT NOT NULL DEFAULT 'SURTEC',
  ADD COLUMN "proveedor_ref" TEXT,
  ADD COLUMN "id_externo" TEXT,
  ADD COLUMN "cae_numero" TEXT,
  ADD COLUMN "cae_vencimiento" DATE,
  ADD COLUMN "url_consulta" TEXT;

CREATE UNIQUE INDEX "comprobante_fiscal_id_externo_key" ON "comprobante_fiscal"("id_externo");