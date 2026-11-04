# ADR 0009 — Stock: descuento al confirmar el pago y sobreventa avisada

| Campo | Valor |
| --- | --- |
| Estado | Aceptada |
| Fecha | 03/11/2026 |
| Referencias | RF.04; RD.03; RD.04; RD.09; HU-015 (BL-120); ADR 0006; HU-024 (BL-104) |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

HU-015 suma el stock por ítem de la carta: el administrador carga las unidades de la jornada, recibe una alerta cuando un ítem baja de su umbral y, en cero, el ítem deja de estar disponible.

RF.04 y RD.09 piden que el stock se verifique y se descuente de forma atómica **al confirmarse el pago**, sin reservarlo en el carrito ni durante el pago. RD.09 agrega que, si al confirmarse el pago otra transacción ya agotó el ítem, el sistema rechace la confirmación y revierta el cobro.

Con el prepago (ADR 0006), cuando el pago se confirma la pasarela ya cobró. Revertirlo requiere el reembolso (HU-024, BL-104), que no está implementado: hoy un pago aprobado que el pedido no puede usar solo queda marcado como `REQUIERE_REEMBOLSO`.

## Decisión

- El stock se descuenta al confirmarse el pago, en el servicio de confirmación compartido (`confirmarPagoEnTx`), dentro de la misma transacción que el pago. Vale para todos los medios: tarjeta, webhook, conciliación y efectivo.
- **Doble verificación antes de cobrar:** al crear el pedido (comensal y mozo) y al reservar el pago o registrar el efectivo. Si el stock no alcanza, la API responde 409 y no se cobra nada.
- **Al confirmarse el pago**, el descuento es atómico y nunca baja de cero. Si otro cobro se llevó las últimas unidades entre la reserva y la aprobación, el pedido sigue, el ítem queda agotado y no disponible, y la alerta al administrador lo marca como «vendido sin stock», con cuántas unidades de más. También queda en la auditoría. El local lo resuelve con el comensal: un cambio o la devolución del dinero.
- Las alertas no se guardan: son el estado actual de los ítems en o debajo de su umbral, y se avisan en vivo por el gateway del staff a una sala solo de administradores.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Reservar el stock durante el checkout, con vencimiento | RD.09 descarta reservar en el carrito y durante el pago, y obliga a manejar vencimientos de reservas. |
| Rechazar la confirmación y marcar el pago para reembolso (RD.09 literal) | Toca los tres flujos de pago y la pantalla del comensal para un caso muy poco frecuente; el reembolso igual seguiría siendo manual hasta HU-024. |
| Autorizar el pago y capturarlo después de verificar el stock | Mercado Pago lo permite en la API Orders (`capture_mode` manual), pero solo con tarjeta de crédito, y cambia el flujo de pago que ya está en producción. Queda como mejora junto con HU-024. |

## Consecuencias

- Fuera de ese caso, un ítem sin stock no se puede pedir ni cobrar.
- Puede haber una sobreventa de pocas unidades cuando dos pagos casi simultáneos compiten por las últimas; el administrador se entera en el momento y queda registrado.
- Es coherente con RD.04: el stock cargado es una cifra operativa del local, no un inventario exacto.
- Solicitud de cambio menor sobre RD.09: la sobreventa por concurrencia se avisa y la resuelve el local, en lugar de revertir el cobro automáticamente, hasta que exista el reembolso (HU-024).
