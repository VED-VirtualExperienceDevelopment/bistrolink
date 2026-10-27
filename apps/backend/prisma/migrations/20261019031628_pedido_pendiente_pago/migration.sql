-- BL-311 (RD.03, prepago): el pedido se crea en PENDIENTE_PAGO, invisible
-- para el KDS, y pasa a RECIBIDO cuando se aprueba el pago.
-- AlterEnum
ALTER TYPE "PedidoEstado" ADD VALUE 'PENDIENTE_PAGO';