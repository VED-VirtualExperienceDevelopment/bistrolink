-- HU-039 (BL-209): pedido cargado por el mozo para un comensal sin celular.
-- Aditiva: un valor nuevo del enum, sin cambios de RLS.
ALTER TYPE "PedidoCanal" ADD VALUE 'MOZO';
