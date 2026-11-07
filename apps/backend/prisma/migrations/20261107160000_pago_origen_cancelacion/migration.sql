-- HU-024 (BL-104): cancelación de un pedido pagado con devolución del pago.
--
-- pago_estado_historial.origen suma CANCELACION: el pago pasó a REEMBOLSADO
-- porque el personal canceló el pedido (reembolso en Mercado Pago o
-- devolución manual del efectivo o del POS).
--
-- Migración ADITIVA (expand/contract, RNF.06): agregar un valor a un enum no
-- cambia las filas existentes. La versión anterior de la API no lo usa.

ALTER TYPE "PagoOrigen" ADD VALUE IF NOT EXISTS 'CANCELACION';
