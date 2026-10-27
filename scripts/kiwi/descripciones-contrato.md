# Descripciones de los contratos PactJS (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                            |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | TC-C-001 a 009: contratos de Mercado Pago (API Orders y notificación de webhook, BL-215), plan nuevo «Contract-PactJS». |

Texto del campo de descripción de cada caso TC-C en Kiwi. Lo carga
`cargar-casos-integracion.mjs --contrato --descripciones`: cada bloque
`## TC-C-NNN` reemplaza la descripción de ese caso, y solo si cambió. Los
casos que no están en este archivo no se tocan. Convenciones en
`apps/backend/test/contract/README.md`.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`. Sin credenciales, tokens reales ni URLs de entornos: el
repositorio es público.

## Ejemplo

    ## TC-C-010

    ### Precondición
    Estado del proveedor que fija el contrato («given»).

    ### Pasos
    1. Lo que hace BistroLink contra el mock del proveedor.

    ### Resultado esperado
    Lo que tiene que responder el proveedor y lo que hace nuestro código.

## Casos para cargar

## TC-C-001

### Precondición

Contrato `bistrolink-backend` → `mercadopago-orders-api`. Estado del proveedor: «la tarjeta de prueba del pagador tiene fondos». Mock server de Pact en lugar de la API de Mercado Pago.

### Pasos

1. `MercadoPagoGateway.cobrar()` con un cobro de 590 con tarjeta de crédito.

### Resultado esperado

1. El request es `POST /v1/orders` con `Authorization: Bearer …`, `X-Idempotency-Key` con formato UUID, `type: online`, `processing_mode: automatic`, monto como texto con 2 decimales, `external_reference` de BistroLink y un pago con tarjeta y token.
2. Mercado Pago responde 201 con la order `processed` / `accredited`.
3. El gateway devuelve el cobro aprobado, no pendiente, con el id de la order como referencia.

## TC-C-002

### Precondición

Mismo contrato. Estado del proveedor: «la tarjeta de prueba del pagador no tiene fondos suficientes».

### Pasos

1. `MercadoPagoGateway.cobrar()` con el mismo cobro.

### Resultado esperado

1. Mercado Pago responde 402 con el id de la order y el motivo en `data.transactions.payments[].status_detail` (`insufficient_amount`, `rejected_by_issuer` o `max_attempts_exceeded`).
2. El gateway devuelve el cobro rechazado, con la referencia de la order y el motivo `insufficient_amount`.

## TC-C-003

### Precondición

Mismo contrato. Estado del proveedor: «el token de tarjeta ya fue usado».

### Pasos

1. `MercadoPagoGateway.cobrar()` con un token de tarjeta ya usado.

### Resultado esperado

1. Mercado Pago responde 402 con `status_detail: invalid_card_token`.
2. El gateway lanza `BadRequestException`: es un error del pedido de cobro, no un rechazo del emisor.

## TC-C-004

### Precondición

Mismo contrato. Estado del proveedor: «existe una order aprobada creada por BistroLink» (el id de la order llega por el provider state).

### Pasos

1. `MercadoPagoGateway.consultarOrden()` con el id de la order.

### Resultado esperado

1. El request es `GET /v1/orders/{id}` con `Authorization: Bearer …`.
2. Mercado Pago responde 200 con `status: processed`, `status_detail: accredited`, el monto y el `external_reference` de BistroLink.
3. El gateway devuelve esos datos, que el webhook y la conciliación (HU-032) usan para aprobar el pago.

## TC-C-005

### Precondición

Mismo contrato. Estado del proveedor: «existe una order pendiente de acción creada por BistroLink».

### Pasos

1. `MercadoPagoGateway.consultarOrden()` con el id de la order.

### Resultado esperado

Mercado Pago responde 200 con `status: action_required` y un `status_detail` de texto. El gateway devuelve esos datos: el pago sigue pendiente.

## TC-C-006

### Precondición

Mismo contrato. Estado del proveedor: «existe una order fallida creada por BistroLink».

### Pasos

1. `MercadoPagoGateway.consultarOrden()` con el id de la order.

### Resultado esperado

Mercado Pago responde 200 con `status: failed` y un `status_detail` de texto. El gateway devuelve esos datos: el pago queda rechazado.

## TC-C-007

### Precondición

Mismo contrato. Estado del proveedor: «no existe la order consultada».

### Pasos

1. `MercadoPagoGateway.consultarOrden()` con un id que no existe.

### Resultado esperado

Mercado Pago responde 404 y el gateway devuelve `null`: el webhook responde 200 y la notificación se ignora.

## TC-C-008

### Precondición

Contrato de mensaje `bistrolink-backend` → `mercadopago-webhooks`. Estado del proveedor: «Mercado Pago notifica una order procesada (pago aprobado)». La firma `x-signature` se prueba aparte (unitarios de la firma del webhook).

### Pasos

1. Leer la notificación como lo hace el controller del webhook (`leerNotificacionOrden`) y, si es de una order, pasarla a procesar.

### Resultado esperado

1. La notificación trae `type: order`, `action` y `data.id`, con los headers `x-signature` (`ts=…,v1=…`) y `x-request-id` y la query `type` y `data.id`.
2. Se pide procesar la order notificada, por su id. El estado no se toma de la notificación: se consulta con `GET /v1/orders/{id}` (TC-C-004 a 006).

## TC-C-009

### Precondición

Mismo contrato de mensaje. Estado del proveedor: «Mercado Pago notifica una order fallida (pago rechazado)».

### Pasos

1. Leer la notificación como lo hace el controller del webhook y, si es de una order, pasarla a procesar.

### Resultado esperado

Igual que TC-C-008: se pide procesar la order notificada por su id, sin tomar el resultado de la notificación.
