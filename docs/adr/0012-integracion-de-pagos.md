# ADR 0012 — Integración de pagos

| Campo | Valor |
| --- | --- |
| Estado | Propuesta |
| Fecha | 08/11/2026 |
| Referencias | BL-491; HU-007 (BL-77, BL-78, BL-90, BL-311); HU-007b (BL-80, BL-485); HU-020 (BL-72, BL-452); HU-024 (BL-104); HU-031 (BL-201); HU-031b (BL-442); HU-032 (BL-202); BL-215; RD.03; RD.05; ADR 0001; ADR 0002; ADR 0004; ADR 0006 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

BistroLink cobra los pedidos antes de mandarlos a cocina (prepago, RD.03 y ADR 0006). El comensal paga desde el celular con tarjeta, y también se puede cobrar en efectivo o con el POS del local. Las decisiones sobre cómo se integra la pasarela se tomaron historia por historia y quedaron repartidas en comentarios del código. Este ADR las junta en un solo lugar.

Restricciones:

- **Datos de tarjeta.** BistroLink no puede guardar ni recibir el número de la tarjeta: quedaría alcanzado por el estándar PCI DSS completo.
- **Pasarelas de Uruguay.** La configuración del establecimiento prevé Mercado Pago, Plexo y Handy. Las credenciales del ambiente de pruebas de Plexo no llegaron a tiempo para el MVP.
- **Red poco confiable.** La pasarela puede tardar, caerse o confirmar el pago por webhook antes o después de responder la llamada.
- **Multi-tenant con RLS (ADR 0002).** El webhook llega sin JWT, así que no trae el tenant.
- **Producción en sandbox (ADR 0004).** No hay plata real en ningún entorno.

## Decisión

### 1. Mercado Pago es la pasarela del MVP, con la API Orders

- El cobro con tarjeta se hace con la **API Orders** (`POST /v1/orders`, procesamiento automático): una sola llamada crea y procesa el pago. Con esa misma API se consulta el estado (`GET /v1/orders/{id}`) y se hace el reembolso (`POST /v1/orders/{id}/refund`).
- **La tarjeta se tokeniza en el navegador** con los campos seguros del SDK de Mercado Pago (`@mercadopago/sdk-react`: `CardNumber`, `ExpirationDate`, `SecurityCode` y `createCardToken`). El backend recibe solo un token de un solo uso, el medio de pago y el correo. El número de la tarjeta nunca pasa por BistroLink.
- **Una sola aplicación de Mercado Pago por entorno** (`MP_ACCESS_TOKEN`, en Infisical), con la cuenta de BistroLink. Staging y producción usan aplicaciones distintas (ADR 0004).
- **Plexo queda en el código, pero no se ofrece.** `PlexoGateway` y su webhook siguen implementados detrás del mismo puerto, pero el medio no se puede habilitar en la configuración (BL-452). Plexo quedó fuera del proyecto el 17/10/2026. **Handy** no se implementó.

### 2. Un puerto para la pasarela, con resiliencia alrededor

- `PagoGateway` (`cobrar`) es el puerto (ADR 0001). `PagoGatewayFactory` elige el adaptador según el medio de pago.
- Cada adaptador va envuelto en `ResilientPagoGateway`, con **timeout de 10 s y circuit breaker** (cockatiel): se abre después de 3 fallos técnicos seguidos y prueba de nuevo a los 30 s (BL-77). Solo cuentan como fallo los timeouts, las caídas y los 5xx. Un dato inválido del comensal (4xx) no abre el circuito para los demás.
- Con el circuito abierto, o si se pasa el timeout, no se sabe si la pasarela cobró. El pago queda `PENDIENTE` y lo resuelve la conciliación (punto 5).

### 3. El backend decide el monto y cada cobro es idempotente

- **El monto nunca viaja en el request** (BL-90): se calcula en el backend a partir del pedido.
- **Cobro en tres fases** (`PagosService`):
  1. Una transacción corta valida el pedido, calcula el monto y guarda el pago como `PENDIENTE`.
  2. La llamada a la pasarela se hace fuera de la transacción.
  3. Una segunda transacción guarda el resultado, solo si el pago sigue `PENDIENTE`. Así una respuesta vieja no pisa lo que ya aplicó el webhook.
- **Idempotencia en dos niveles:**
  - `pago.idempotency_key` es única: dos requests iguales devuelven el mismo pago y no cobran dos veces.
  - Hacia Mercado Pago, `X-Idempotency-Key` es un UUID que se deriva de (tenant, clave del cliente). El mismo intento repetido usa la misma clave. El reembolso usa una clave fija por pago.
- **Prepago (ADR 0006).** Cuando el pago se aprueba, un servicio compartido (`confirmarPagoEnTx`) pasa el pedido de `PENDIENTE_PAGO` a `RECIBIDO`, descuenta el stock (ADR 0009) y, después del commit, lo manda al KDS y pide el CFE en segundo plano. Lo usan todos los medios de pago.

### 4. El webhook se verifica y lleva el tenant en la referencia

- **Firma HMAC-SHA256** de Mercado Pago (`x-signature`, BL-78). Se compara en tiempo constante y **falla cerrado**: sin clave secreta, o si falta algún dato, la notificación se rechaza.
- **La notificación solo avisa que algo cambió.** El backend consulta la order a Mercado Pago, que es la fuente de verdad, y aplica el estado actual. Así un aviso duplicado o fuera de orden no deja un estado viejo. Además se verifica que el monto coincida.
- **`external_reference`** = `v1` + tenant + pedido, cada UUID en base64url (46 caracteres). El webhook sabe a qué restaurante pertenece la order **sin consultar entre tenants** y después trabaja dentro del RLS de ese tenant. Si la order no tiene ese formato, no es de BistroLink y se ignora.
- **Respuestas.** Un error técnico (Mercado Pago o la base caídos) sale como 5xx a propósito, para que Mercado Pago reintente. Una order que no existe se responde con 200.

### 5. Conciliación y vencimiento de los pagos pendientes

Un job (`ConciliacionPagosJob`, HU-032) recorre los pagos `PENDIENTE`:

- A los **2 minutos** sin resolverse, le consulta la order a Mercado Pago y aplica el resultado con el **mismo flujo que el webhook** (origen `CONCILIACION`).
- A los **15 minutos**, el pago vence: queda `RECHAZADO` con motivo `VENCIDO`. El pedido sigue en `PENDIENTE_PAGO` y el comensal puede volver a pagar.
- Si después llega una aprobación tardía, se aplica solo si el pedido todavía puede usar ese pago. Si no, el pago se marca para reembolsar.

Cada cambio de estado queda en `pago_estado_historial`, con su origen (respuesta del cobro, webhook, conciliación o vencimiento). Esa tabla solo admite altas.

### 6. El efectivo y el POS del local los registra el personal

- **Efectivo (HU-031)** y **POS del local (HU-007b)**: no hay pasarela de por medio. El mozo o el administrador registra el cobro, y el pago se crea directamente `APROBADO` y pasa por el mismo `confirmarPagoEnTx`. Del POS se guarda solo el tipo de tarjeta (crédito o débito) y el número de autorización del voucher, nunca datos de la tarjeta.
- **Aviso de efectivo (HU-031b).** Cuando el comensal avisa que paga en efectivo, **no se crea un pago**: un pago `PENDIENTE` lo vencería la conciliación y bloquearía el pago con tarjeta. El aviso se guarda en el pedido y le llega al mozo.
- **Venta en el sistema del POS (HU-011, BL-488).** Mandar la venta al sistema del POS del local es una integración aparte, con su propio puerto y su bandeja de salida. Si falla, no afecta al cobro.

### 7. La devolución va antes de cancelar

Al cancelar un pedido pagado (HU-024):

1. **Primero se devuelve el pago.** Mercado Pago, por la API (reembolso total). Efectivo y POS, a mano, con la confirmación del mozo.
2. Si Mercado Pago falla, el pedido **no se cancela** (502) y se puede reintentar. Los pagos que ya se devolvieron quedan `REEMBOLSADO` y no se devuelven de nuevo.

### 8. Los medios de pago se habilitan por establecimiento

Cada restaurante elige qué medios acepta (HU-020): Mercado Pago, efectivo y POS. Si un medio está apagado, la pantalla del comensal no lo ofrece y la API responde 409 antes de reservar el pago. El reintento de un pago que ya existía se respeta aunque el medio se haya apagado después.

### 9. Contratos con la pasarela

Lo que BistroLink manda y lee de la API Orders y del webhook está fijado en contratos PactJS (BL-215, TC-C-001 a 009 y 022). El CI falla si el contrato cambia sin commitearse.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Checkout Pro de Mercado Pago (redirigir al comensal a la página de Mercado Pago) | Saca al comensal de la pantalla del pedido y vuelve por redirección. El pago con campos seguros mantiene la experiencia en BistroLink con el mismo alcance PCI (la tarjeta no pasa por nuestros servidores). |
| API Payments (`/v1/payments`) en lugar de Orders | Mercado Pago recomienda Orders para las integraciones nuevas, y Payments ya no recibe funcionalidades nuevas, solo arreglos de seguridad y estabilidad ([documentación de Checkout API](https://www.mercadopago.com.ar/developers/en/docs/checkout-api-payments/overview)). Además, con Orders el cobro, la consulta y el reembolso usan la misma API y las notificaciones se configuran en «Tus integraciones». |
| Recibir los datos de la tarjeta en el backend y tokenizarlos ahí | Haría que BistroLink quede alcanzado por PCI DSS completo. |
| Plexo como pasarela principal | No llegaron las credenciales del ambiente de pruebas a tiempo para el MVP. El adaptador queda listo para cuando lleguen. |
| Confiar en el contenido del webhook sin consultar la order | El webhook se puede repetir, llegar desordenado o ser falso. Consultar la order y verificar la firma evita las tres cosas. |
| Buscar la order en todos los tenants para saber de quién es | Rompe el aislamiento por RLS (ADR 0002). La referencia externa lleva el tenant. |
| Cobrar dentro de la transacción de la base | Una pasarela lenta mantendría abierta la transacción y ocuparía conexiones del pool. Con las tres fases y la idempotencia se cubre lo mismo. |
| Reintentar el cobro automáticamente si hay timeout | Si la pasarela llegó a cobrar, el reintento puede cobrar dos veces. Se deja `PENDIENTE` y se concilia consultando el estado. |
| Split payment de la pasarela para dividir la cuenta | El split payment reparte la plata de un pagador entre varios vendedores (marketplace), que es lo contrario de lo que necesita BistroLink. La división de cuenta (HU-008) se modela en BistroLink: cada parte es un cobro independiente. |
| Una cuenta de Mercado Pago por restaurante (OAuth de Mercado Pago) | Sería lo correcto en una operación real, pero requiere el alta de cada restaurante en Mercado Pago y no hay operaciones reales (ADR 0004). Queda para el paso a operación. |

## Consecuencias

- **Lo que ganamos:**
  - Ningún dato de tarjeta pasa por BistroLink.
  - Un cobro no se duplica por reintentos ni por avisos repetidos.
  - Una caída de la pasarela no traba la mesa: el pago queda pendiente y se resuelve o vence solo.
- **Todos los medios terminan en el mismo lugar:** pasan por `confirmarPagoEnTx`. Un medio nuevo solo agrega cómo se cobra; el paso a cocina, el stock, la auditoría y el CFE no cambian.
- **Pedidos sin pagar en la base.** Hay pedidos `PENDIENTE_PAGO` y pagos `PENDIENTE` que dependen del job de conciliación. Si el job se apaga (`PAGOS_CONCILIACION_HABILITADA=false`), quedan sin resolver.
- **Conciliación solo para Mercado Pago.** Plexo no tiene consulta de estado implementada: sus pagos solo vencerían. Antes de habilitarlo hay que generalizar el webhook y la consulta en el puerto (hay un TODO en `PagosWebhookService`).
- **Cuenta única de Mercado Pago.** Toda la plata entra a la cuenta de la aplicación de BistroLink. Para operar con dinero real, cada restaurante tiene que cobrar en su propia cuenta (OAuth o credenciales por establecimiento), y eso cambia cómo se configura el gateway.
- **Plazos iguales para todos los locales.** El vencimiento (15 min) y la consulta (2 min) se configuran por variable de entorno. HU-032 pide que se puedan configurar por establecimiento: queda pendiente.

## Control de versiones

| Versión | Fecha | Modificación |
| --- | --- | --- |
| 1.0 | 08/11/2026 | Versión inicial (BL-491). |
