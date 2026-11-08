-- HU-023 (BL-96): conciliación de CFE pendientes.
--
-- Un pago APROBADO sin fila en comprobante_fiscal es un CFE pendiente de
-- emisión (Surtec estuvo caído o rechazó la emisión). La conciliación lo
-- reintenta cada vez más espaciado y, si no sale, el administrador lo ve
-- como «requiere atención». Acá se guarda cuántas veces falló, cuándo y el
-- último error (sin datos personales).
--
-- Migración ADITIVA (expand/contract, RNF.06): columnas con default o
-- nullable. La versión anterior de la API no las lee. ALTER TABLE no pasa
-- por RLS.

ALTER TABLE "pago" ADD COLUMN "cfe_intentos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pago" ADD COLUMN "cfe_ultimo_intento_en" TIMESTAMPTZ(3);
ALTER TABLE "pago" ADD COLUMN "cfe_ultimo_error" VARCHAR(300);

CREATE INDEX "pago_tenant_id_estado_created_at_idx" ON "pago"("tenant_id", "estado", "created_at");
