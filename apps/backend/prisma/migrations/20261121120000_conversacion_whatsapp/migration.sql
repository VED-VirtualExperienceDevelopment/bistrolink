-- HU-010 (BL-112): conversación del bot de pedidos por WhatsApp (pedidos
-- para retirar). Una fila por tenant y teléfono, con el paso, el
-- consentimiento del aviso de privacidad (HU-036) y el pedido que se está
-- armando. Vence a los 30 minutos sin mensajes.
--
-- Minimización (Ley 18.331): no hay teléfono en claro. telefono_hash es un
-- HMAC-SHA256 del tenant y el número con una clave que solo tiene la API.
-- El número que sirve para avisar que el pedido está listo se guarda en el
-- pedido (retiro_contacto), como en el retiro web, y solo con el
-- consentimiento.
--
-- IMPORTANTE (regla R-14, Anexo 6 §9): la tabla es multi-tenant y lleva RLS
-- forzado como el resto (20260802150000_enable_rls).

-- CreateTable
CREATE TABLE "conversacion_whatsapp" (
    "tenant_id" UUID NOT NULL,
    "telefono_hash" CHAR(64) NOT NULL,
    "paso" VARCHAR(12) NOT NULL,
    "consentido" BOOLEAN NOT NULL DEFAULT false,
    "carrito" JSONB NOT NULL DEFAULT '[]',
    "ultimo_mensaje_id" VARCHAR(128),
    "vence_en" TIMESTAMPTZ(3) NOT NULL,
    "actualizada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversacion_whatsapp_pkey" PRIMARY KEY ("tenant_id","telefono_hash"),
    CONSTRAINT "conversacion_whatsapp_paso" CHECK ("paso" IN ('INICIO', 'PRIVACIDAD', 'ARMANDO', 'CONFIRMAR')),
    CONSTRAINT "conversacion_whatsapp_carrito_es_lista" CHECK (jsonb_typeof("carrito") = 'array'),
    -- Sin aceptar el aviso de privacidad no hay pedido en armado.
    CONSTRAINT "conversacion_whatsapp_carrito_con_consentimiento" CHECK ("consentido" OR "carrito" = '[]'::jsonb)
);

-- CreateIndex
CREATE INDEX "conversacion_whatsapp_tenant_id_vence_en_idx" ON "conversacion_whatsapp"("tenant_id", "vence_en");

-- RLS: FORCE para que tampoco el dueño de la tabla la saltee.
ALTER TABLE "conversacion_whatsapp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversacion_whatsapp" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "conversacion_whatsapp"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_insert ON "conversacion_whatsapp"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_update ON "conversacion_whatsapp"
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation_delete ON "conversacion_whatsapp"
  FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
