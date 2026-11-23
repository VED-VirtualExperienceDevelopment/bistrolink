-- HU-010 (BL-613): número de WhatsApp del bot del local, para el enlace
-- «¿Preferís pedir por WhatsApp?» del menú para retirar.
--
-- Migración ADITIVA (expand/contract, RNF.06): una columna nula. La versión
-- anterior de la API no la lee.
--
-- Formato internacional E.164 con «+» (de 8 a 15 dígitos, sin 0 adelante).

ALTER TABLE "restaurante"
  ADD COLUMN "whatsapp_pedidos" VARCHAR(16);

ALTER TABLE "restaurante"
  ADD CONSTRAINT "restaurante_whatsapp_pedidos_formato"
    CHECK ("whatsapp_pedidos" IS NULL OR "whatsapp_pedidos" ~ '^\+[1-9][0-9]{7,14}$');
