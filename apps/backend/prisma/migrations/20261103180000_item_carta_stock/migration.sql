-- HU-015 (BL-120): stock de la jornada y alertas de stock bajo.
--
-- Migración aditiva (RNF.06): tres columnas con valor por defecto y dos
-- CHECK que las filas existentes ya cumplen. Con controla_stock en false
-- (el valor por defecto) la carta sigue funcionando como hasta ahora: solo
-- con «disponible». La versión anterior de la API no lee las columnas
-- nuevas. ALTER TABLE no pasa por el RLS.
--
-- - controla_stock: el administrador activa el control de stock por ítem.
-- - stock_actual: unidades que quedan. Se descuenta al confirmarse el pago
--   (RF.04, RD.09); en 0 el ítem queda no disponible.
-- - umbral_alerta: con stock_actual en o debajo de este valor, alerta
--   «Por agotarse» al administrador.

-- AlterTable
ALTER TABLE "item_carta" ADD COLUMN "controla_stock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stock_actual" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "umbral_alerta" INTEGER NOT NULL DEFAULT 5;

-- Última línea de defensa: la API valida lo mismo con mensajes claros (400)
-- y el descuento nunca baja de 0.
ALTER TABLE "item_carta"
  ADD CONSTRAINT "item_carta_stock_actual_no_negativo" CHECK ("stock_actual" >= 0),
  ADD CONSTRAINT "item_carta_umbral_alerta_no_negativo" CHECK ("umbral_alerta" >= 0);
