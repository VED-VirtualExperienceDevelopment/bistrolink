# ADR 0006 — Prepago con el estado PENDIENTE_PAGO

| Campo | Valor |
| --- | --- |
| Estado | Aceptada |
| Fecha | 18/10/2026 |
| Referencias | RD.03; RD.05; Anexo 6 §6; BL-311; HU-032 (BL-202) |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

RD.03 y la máquina de estados del Anexo 6 definen un modelo de **prepago**: la cocina recibe el pedido cuando el pago está aprobado. Al revisar el código el 18/10 se encontró que funcionaba como **postpago**: el pedido se creaba en `RECIBIDO` y llegaba al KDS al confirmar el carrito, y el pago no cambiaba su estado.

## Decisión

Se agrega el estado **`PENDIENTE_PAGO`** al pedido:

- al confirmar el carrito, el pedido se guarda en `PENDIENTE_PAGO` y **no** se envía al KDS;
- cuando el pago se aprueba, un servicio de confirmación compartido lo pasa a `RECIBIDO`, registra la transición en el historial y lo emite al KDS. Lo llaman la respuesta directa de la pasarela y el webhook, y es idempotente: si el pedido ya está en `RECIBIDO`, no hace nada;
- después del pago aprobado la mesa queda `OCUPADA`; la libera el cierre de la sesión de mesa;
- el pago y la consulta del comprobante se atan al pedido y a la mesa (RD.05): un comensal de otra mesa no puede pagar ni consultar ese pedido;
- los pedidos que quedan en `PENDIENTE_PAGO` sin pagar se vencen con la conciliación de pagos pendientes (HU-032).

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Mantener el postpago | Contradice RD.03: la cocina prepararía pedidos que nunca se pagan. |
| No guardar el pedido hasta que se apruebe el pago | Sin un pedido guardado no hay una referencia estable para la idempotencia del pago, el webhook y la conciliación. |

## Consecuencias

- La cocina solo ve pedidos pagados.
- El webhook y la respuesta directa pueden llegar en cualquier orden sin duplicar el pedido en el KDS.
- Aparecen pedidos sin pagar en la base, que la conciliación tiene que vencer.
- El cobro en efectivo (HU-031 y HU-031b) se apoya en el mismo paso de `PENDIENTE_PAGO` a `RECIBIDO`, y el pago presencial con el POS del local (HU-007b) lo va a usar también.
- Solicitud de cambio menor en el Anexo 6 §6 y en el Anexo 10: el carrito confirmado se guarda como `PENDIENTE_PAGO`, invisible para la cocina.
