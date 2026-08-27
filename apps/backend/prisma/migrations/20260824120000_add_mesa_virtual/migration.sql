-- HU-003: soporte para pedidos "desde fuera del local" (HU-002), donde no
-- hay una mesa física asociada. En vez de volver mesaId opcional en Pedido
-- (lo que obligaría a todo el resto del sistema, incluido el KDS, a manejar
-- el caso null), cada restaurante tiene una única "mesa virtual"
-- (numero = 0, es_virtual = true) que representa los pedidos sin mesa real.
-- Decisión de equipo, ver hilo de Linear HU-003.

ALTER TABLE "mesa" ADD COLUMN "es_virtual" BOOLEAN NOT NULL DEFAULT false;