# Seguridad: Endpoints Públicos

Este documento describe el modelo de seguridad de los endpoints públicos de BistroLink, específicamente los endpoints de acceso al menú sin autenticación.

## Endpoints Públicos

### HU-001 / HU-034: Acceso al menú por mesa (QR)

- **Ruta**: `GET /menu/qr/:token`
- **Propósito**: Permitir a comensales escanear un QR en la mesa para ver el menú
- **Criterio de aceptación**: "Funciona sin login ni instalación previa"
- **Token del QR (BL-204)**: la URL de la mesa lleva un token opaco que emite el backend, en lugar de los ids del tenant y la mesa. No se puede armar ni modificar desde el cliente, y el administrador puede regenerarlo (el anterior deja de funcionar). Respuestas: `404` si el token no es válido (sin distinguir el motivo) y `410` si el QR fue reemplazado.
- **Pedidos y llamados desde la mesa**: usan el mismo token en el header `X-Mesa-Token`; la mesa sale del token, nunca del cliente.
- La ruta anterior por ids (`GET /menu/:tenantId/:mesaId`) se retiró en BL-204.

### HU-002: Acceso al menú por enlace directo

- **Ruta**: `GET /menu/tenant/:tenantId/restaurante/:restauranteId`
- **Propósito**: Permitir a comensales acceder al menú desde fuera del local vía enlace web
- **Criterio de aceptación**: "Funciona sin login ni instalación previa"

### HU-010: Webhook del bot de WhatsApp (BL-112)

- **Ruta**: `POST /webhooks/whatsapp`
- **Quién lo llama**: Evolution API, con cada mensaje que recibe el número del local.
- **Autenticación**: secreto compartido en el header `x-bistrolink-webhook-secreto` (`WHATSAPP_WEBHOOK_SECRETO`, al menos 32 caracteres), comparado en tiempo constante. Sin el secreto configurado, el bot está apagado y responde `401` a todo.
- **Tenant**: sale de la instancia de Evolution (`EVOLUTION_INSTANCIAS`), nunca del cuerpo del mensaje. Todo lo que lee o escribe corre en el contexto RLS de ese tenant.
- **Abuso**: límite de 20 mensajes por minuto por teléfono (por hash, no por IP: todo llega desde Evolution). Los mensajes repetidos (mismo id) se descartan y la confirmación crea un solo pedido (`idempotencyKey` por mensaje).
- **Datos personales**: la conversación se guarda con un HMAC del teléfono; el número queda en el pedido solo con el aviso de privacidad aceptado. Detalle en `docs/runbooks/whatsapp-evolution.md`.

---

## Modelo de Amenazas (Threat Model)

### ¿Qué protegemos?

1. **Aislamiento multi-tenant**: Un tenant NO puede acceder a datos de otro tenant
2. **Integridad de datos**: Solo se pueden consultar recursos que existen
3. **Prevención de inyección**: Los parámetros de URL no pueden ser explotados

### ¿Qué NO protegemos en estos endpoints?

- **Autenticación**: Por diseño, estos endpoints son públicos (decisión de negocio)
- **Autorización**: Cualquier persona con la URL puede acceder (pero solo a datos del tenant correcto)

---

## Capas de Defensa (Defensa en Profundidad)

### Capa 1: Validación de Parámetros (ParseUUIDPipe)

**Ubicación**: `menu.controller.ts`

```typescript
@Param('tenantId', ParseUUIDPipe) tenantId: string
@Param('restauranteId', ParseUUIDPipe) restauranteId: string
```
