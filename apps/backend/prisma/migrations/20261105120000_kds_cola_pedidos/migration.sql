-- Cola del KDS y límite de pedidos en preparación (ADR 0010).
--
-- Migración aditiva (RNF.06): columnas nuevas con valor por defecto o
-- nullables, CHECK que las filas existentes ya cumplen y un índice. La
-- versión anterior de la API no lee las columnas nuevas. ALTER TABLE no pasa
-- por el RLS. Sin backfill: la cola ordena por COALESCE(encolado_en,
-- created_at), así los pedidos que ya están en RECIBIDO conservan su orden.
--
-- restaurante:
-- - limite_pedidos_en_preparacion: cuántos pedidos puede tener la cocina en
--   EN_PREPARACION a la vez. NULL = cola automática desactivada: el local
--   sigue como hasta ahora (el mozo pasa el pedido a preparación a mano).
-- - umbral_alerta_cola: con más pedidos que este valor esperando, el KDS
--   muestra la alerta de alta demanda.
-- - minutos_preparacion_estimados: tiempo de preparación de referencia para
--   el tiempo estimado, mientras no haya historial del día para promediar.
--
-- pedido:
-- - encolado_en: cuándo el pedido llegó a cocina (pago aprobado, pasa a
--   RECIBIDO). Define el orden FIFO de la cola; no se usa created_at porque
--   el carrito se crea antes de pagar y el orden de pago puede ser otro.

-- AlterTable
ALTER TABLE "restaurante" ADD COLUMN "limite_pedidos_en_preparacion" INTEGER,
ADD COLUMN "umbral_alerta_cola" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN "minutos_preparacion_estimados" INTEGER NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "pedido" ADD COLUMN "encolado_en" TIMESTAMPTZ(3);

-- Última línea de defensa: la API valida lo mismo con mensajes claros (400).
-- Rangos pensados para locales chicos y medianos; se amplían si hace falta.
ALTER TABLE "restaurante"
  ADD CONSTRAINT "restaurante_limite_preparacion_rango"
    CHECK ("limite_pedidos_en_preparacion" IS NULL
           OR "limite_pedidos_en_preparacion" BETWEEN 1 AND 50),
  ADD CONSTRAINT "restaurante_umbral_alerta_cola_rango"
    CHECK ("umbral_alerta_cola" BETWEEN 1 AND 200),
  ADD CONSTRAINT "restaurante_minutos_preparacion_rango"
    CHECK ("minutos_preparacion_estimados" BETWEEN 1 AND 180);

-- CreateIndex: próximo pedido de la cola (FIFO) y conteo por estado.
CREATE INDEX "pedido_tenant_id_estado_encolado_en_idx" ON "pedido"("tenant_id", "estado", "encolado_en");
