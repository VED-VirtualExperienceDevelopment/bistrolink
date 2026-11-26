# ADR 0015 — Bot de pedidos por WhatsApp con Evolution API

| Campo       | Valor                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estado      | Aceptada; implementada en staging (BL-112). El código está en producción desde v0.6.0; el bot se activa con sus variables. El cambio de alcance de HU-010 va por CR. |
| Fecha       | 21/11/2026                                                                                                                                                           |
| Referencias | HU-010 (BL-112); HU-033; HU-036; HU-040; ADR 0002; ADR 0003                                                                                                          |
| Autores     | E. Arenas, V. Couto, D. Silvera                                                                                                                                      |

## Contexto

HU-010 pide que el comensal haga su pedido por WhatsApp, con el menú, la selección por número y el pedido registrado igual que por QR o web, y con notificaciones en plantillas HSM aprobadas por Meta.

Las plantillas HSM solo existen en la **WhatsApp Business Platform (Cloud API)** de Meta. Para usarla hace falta una cuenta de Meta Business verificada, un número dedicado registrado en la plataforma y la aprobación de cada plantilla, con costo por conversación iniciada por la empresa. Con el tiempo que queda hasta la entrega (27/11/2026), esos trámites no son viables.

## Decisión

- **Evolution API v2.3.7** (código abierto, se autoaloja en Railway con su propio Postgres y Redis) conecta el número del proyecto como WhatsApp Web y reenvía los mensajes a `POST /webhooks/whatsapp`.
- **Alcance:** pedidos **para retirar**, con las mismas reglas que el retiro web (HU-040) y el pago por el link de HU-033. Sin pedidos de mesa (esos ya tienen el QR).
- **Mensajes de texto fijos** en el código, en lugar de plantillas HSM. El bot solo contesta mensajes que inicia el comensal.
- **Seguridad:** secreto compartido en un header, comparado en tiempo constante; tenant según la instancia, nunca según el mensaje; conversación con RLS; rate limiting por teléfono; idempotencia por id de mensaje.
- **Datos personales:** la conversación guarda un HMAC del teléfono; el número va al pedido solo si el comensal aceptó el aviso de privacidad (HU-036).

## Alternativas consideradas

| Alternativa                          | Por qué no                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| WhatsApp Cloud API de Meta (con HSM) | Verificación del negocio, número dedicado y aprobación de plantillas: no entra en el plazo. Es el camino a producción. |
| Proveedores BSP (Twilio, 360dialog)  | Los mismos trámites de Meta, más costo por mensaje.                                                                    |
| Dejar HU-010 fuera del alcance       | Es el único canal del MVP que todavía no tiene pedidos (el filtro de reportes ya lo muestra).                          |

## Consecuencias

- **Riesgo de bloqueo del número:** Meta no permite automatizar WhatsApp Web. Se usa solo el chip del proyecto, nunca un número personal ni el de un local real. Para producción, la decisión se revisa a favor de la Cloud API.
- **Cambio de alcance:** el criterio «plantillas HSM aprobadas por Meta» se reemplaza por «mensajes de texto fijos». Va por CR (Anexo 9).
- **Un servicio más en staging** (Evolution con su Postgres y Redis), con costo en Railway.
- **Variables nuevas:** `EVOLUTION_API_URL` y `EVOLUTION_INSTANCIAS` en Railway; `EVOLUTION_API_KEY`, `WHATSAPP_WEBHOOK_SECRETO` y `WHATSAPP_TELEFONO_CLAVE` en Infisical. Sin ellas el bot queda apagado y la API arranca igual.
- **Casos de prueba:** unitarios TC-U-651 a 669; integración TC-I-245 y 246 (con Evolution simulado: el CI no usa WhatsApp).
- **Operación:** `docs/runbooks/whatsapp-evolution.md`.

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                 |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| 1.0     | 21/11/2026 | Versión inicial (BL-112).                                                                                    |
| 1.1     | 24/11/2026 | Aceptada por el equipo. El código está en producción desde v0.6.0 (incluye BL-112, BL-604, BL-605 y BL-613). |
