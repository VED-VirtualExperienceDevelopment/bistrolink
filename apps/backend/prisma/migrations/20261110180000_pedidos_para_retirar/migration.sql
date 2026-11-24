-- HU-040 (BL-210): pedidos para retirar por el enlace web.
--
-- Migración ADITIVA (expand/contract, RNF.06): columnas nuevas con default o
-- nulas e índices. La versión anterior de la API no las lee.
--
-- restaurante: si acepta pedidos para retirar, la franja horaria (la misma
-- todos los días, HH:MM en la zona del local; las dos nulas = todo el día) y
-- el contador del código de retiro.
-- pedido: el código de retiro (R-042) y el nombre y el contacto opcionales,
-- que solo se guardan con el consentimiento del comensal (HU-036).

ALTER TABLE "restaurante"
  ADD COLUMN "retiro_habilitado" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "retiro_hora_desde" VARCHAR(5),
  ADD COLUMN "retiro_hora_hasta" VARCHAR(5),
  ADD COLUMN "ultimo_codigo_retiro" INTEGER NOT NULL DEFAULT 0;

-- HH:MM de 00:00 a 23:59; las dos horas o ninguna; distintas entre sí.
ALTER TABLE "restaurante"
  ADD CONSTRAINT "restaurante_retiro_hora_desde_formato"
    CHECK ("retiro_hora_desde" IS NULL OR "retiro_hora_desde" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "restaurante_retiro_hora_hasta_formato"
    CHECK ("retiro_hora_hasta" IS NULL OR "retiro_hora_hasta" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "restaurante_retiro_horario_completo"
    CHECK (("retiro_hora_desde" IS NULL) = ("retiro_hora_hasta" IS NULL)),
  ADD CONSTRAINT "restaurante_retiro_horario_distinto"
    CHECK ("retiro_hora_desde" IS NULL OR "retiro_hora_desde" <> "retiro_hora_hasta"),
  ADD CONSTRAINT "restaurante_ultimo_codigo_retiro_rango"
    CHECK ("ultimo_codigo_retiro" BETWEEN 0 AND 999);

ALTER TABLE "pedido"
  ADD COLUMN "codigo_retiro" VARCHAR(5),
  ADD COLUMN "retiro_nombre" VARCHAR(60),
  ADD COLUMN "retiro_contacto" VARCHAR(100),
  ADD COLUMN "retiro_consentido_en" TIMESTAMPTZ(3),
  ADD COLUMN "retiro_anonimizado_en" TIMESTAMPTZ(3);

ALTER TABLE "pedido"
  ADD CONSTRAINT "pedido_codigo_retiro_formato"
    CHECK ("codigo_retiro" IS NULL OR "codigo_retiro" ~ '^R-[0-9]{3}$');

-- CreateIndex
CREATE INDEX "pedido_tenant_id_retiro_contacto_idx" ON "pedido"("tenant_id", "retiro_contacto");
