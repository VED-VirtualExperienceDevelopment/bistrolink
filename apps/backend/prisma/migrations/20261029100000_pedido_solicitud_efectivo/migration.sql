-- HU-031b (BL-442): el comensal de una mesa pide pagar en efectivo. Aditiva:
-- dos columnas nulas en pedido, sin cambios de RLS.
ALTER TABLE "pedido" ADD COLUMN "efectivo_solicitado_en" TIMESTAMPTZ(3),
ADD COLUMN "efectivo_paga_con" DECIMAL(10,2);
