-- HU-022 (BL-494): propina en el pago.
--
-- pedido: la elección del comensal (porcentaje o monto libre en pesos
-- enteros), guardada antes de pagar para que el mozo la vea también con
-- efectivo y POS. Se guarda la elección y no el monto: el backend calcula la
-- propina sobre las líneas al cobrar (BL-90).
--
-- pago: la propina cobrada, aparte del consumo. `monto` sigue siendo el
-- consumo, que es lo que se factura (CFE) y lo que usan la rebaja de IVA y
-- las ventas por hora.
--
-- Migración ADITIVA (expand/contract, RNF.06): columnas nuevas, nulas o con
-- DEFAULT 0. La versión anterior de la API no las lee y los pagos que ya
-- existen quedan sin propina.

ALTER TABLE "pedido"
  ADD COLUMN "propina_porcentaje" INTEGER,
  ADD COLUMN "propina_monto" INTEGER;

-- La base es la última línea de defensa (BL-86; el DTO valida lo mismo con
-- mensajes claros): como mucho una de las dos columnas, el porcentaje entre
-- 1 y 100 y el monto de al menos 1 peso. El tope contra el consumo lo valida
-- el backend, porque depende de las líneas.
ALTER TABLE "pedido"
  ADD CONSTRAINT "pedido_propina_valida" CHECK (
    ("propina_porcentaje" IS NULL OR "propina_porcentaje" BETWEEN 1 AND 100)
    AND ("propina_monto" IS NULL OR "propina_monto" >= 1)
    AND NOT ("propina_porcentaje" IS NOT NULL AND "propina_monto" IS NOT NULL)
  );

ALTER TABLE "pago"
  ADD COLUMN "propina" DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE "pago"
  ADD CONSTRAINT "pago_propina_no_negativa" CHECK ("propina" >= 0);
