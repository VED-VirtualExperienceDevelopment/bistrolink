# ADR 0013 — Estado de la mesa con varios cobros

| Campo | Valor |
| --- | --- |
| Estado | Propuesta |
| Fecha | 10/11/2026 |
| Referencias | Bug BL-509 (issue #474); HU-016 (BL-59); HU-017 (BL-60); HU-032 (BL-202); RD.03; ADR 0006; ADR 0010; ADR 0012 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

La mesa tiene un solo estado (`LIBRE`, `OCUPADA`, `EN_PROCESO_DE_PAGO`, `REQUIERE_LIMPIEZA`), que el mapa de mesas muestra con un color. Pero cada pedido tiene su propio pago: dos comensales de la misma mesa pueden estar pagando a la vez.

ADR 0006 dice que después del pago la mesa queda `OCUPADA`. El código lo aplicaba cada vez que terminaba un pago, aunque otro comensal siguiera pagando. Pasaba lo siguiente:

- el mapa mostraba la mesa roja («Ocupada») con un cobro en curso;
- «Cerrar mesa» solo miraba el color, así que dejaba cerrarla y cancelaba el pedido que se estaba cobrando;
- si dos cobros terminaban a la vez, cada uno veía al otro todavía pendiente y la mesa podía quedar amarilla sin ningún cobro en curso, sin poder cerrarse;
- un pago pendiente que terminaba en «requiere reembolso» dejaba la mesa amarilla para siempre;
- si el mozo cerraba la mesa mientras el comensal empezaba a pagar, el cobro chocaba con el CHECK de sesión de la base (error 500).

La conciliación de pagos (HU-032) ya aplicaba la regla correcta al vencer un pago; los otros caminos no.

## Decisión

- **Se mantienen los cuatro estados de la mesa.** El amarillo (`EN_PROCESO_DE_PAGO`) le avisa al mozo que no puede cerrar la mesa y por qué.
- **La mesa está `EN_PROCESO_DE_PAGO` mientras tenga al menos un pago `PENDIENTE`.** Cuando termina un cobro (aprobado, rechazado, vencido o con reembolso), la mesa vuelve a `OCUPADA` solo si no queda otro cobro en curso en ella. Solo los pagos con tarjeta nacen `PENDIENTE`; el efectivo y el POS nacen aprobados y no pasan por este estado.
- **Una sola función aplica la regla:** `liberarMesaDelCobro` (`src/pagos/mesa-en-cobro.ts`). La usan el cobro directo, el error de la pasarela, los webhooks de Mercado Pago y Plexo, y la conciliación.
- **Bloqueo de la fila de la mesa (`SELECT … FOR UPDATE`)** dentro de la transacción que resolvió el pago, antes de contar los cobros en curso. Dos cobros de la misma mesa que terminan a la vez se resuelven de a uno: el segundo espera al primero y ve su pago ya resuelto. El bloqueo es por mesa, no por local (a diferencia del lock por tenant de la cola del KDS, ADR 0010): cobros de mesas distintas no se esperan entre sí.
- **El cierre de la mesa mira los pagos, no solo el color:** `cerrarSesion` responde 409 si hay algún pago `PENDIENTE` de los pedidos de la mesa.
- **Un cobro solo empieza con la sesión de la mesa abierta:** la reserva del cobro pasa la mesa a `EN_PROCESO_DE_PAGO` con una actualización condicional (sesión abierta y estado `OCUPADA` o `EN_PROCESO_DE_PAGO`), en la misma transacción que crea el pago. Si la mesa se cerró, responde 409 y no crea el pago.
- **La mesa virtual (pedidos para retirar) no cambia de estado** al cobrar: no tiene sesión ni aparece en el mapa.

Esto precisa ADR 0006: después del pago aprobado, la mesa queda `OCUPADA` **si no le queda otro cobro en curso**.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Sacar `EN_PROCESO_DE_PAGO` y dejar solo libre, ocupada y limpieza | Simplifica el modelo, pero el mozo pierde la señal visual de un cobro en curso. Además exige una migración del enum de la mesa y del CHECK de sesión, y cambios en el frontend, los tests, Kiwi y la documentación, cerca de la entrega final. |
| Sacar solo el color amarillo del mapa | Esconde el síntoma: el estado sigue en la base, y el cierre con un cobro en curso y la mesa trabada siguen pasando. |
| Calcular el estado de la mesa al vuelo a partir de los pagos, sin guardarlo | Cambia todas las consultas y eventos que hoy leen `mesa.estado` (mapa, WebSocket, CHECK de sesión). Es un cambio grande para corregir un bug. |
| Lock por tenant (`pg_advisory_xact_lock`), como la cola del KDS | Serializaría los cobros de todas las mesas del local. Con la fila de la mesa alcanza. |
| Transacciones `SERIALIZABLE` | Obliga a reintentar las transacciones que fallan por conflicto en todos los caminos de pago. El bloqueo de la fila resuelve el caso sin reintentos. |

## Consecuencias

- **Lo que ganamos:**
  - El color de la mesa refleja lo que pasa: amarilla mientras alguien paga, roja cuando nadie paga.
  - No se puede cancelar un pedido que se está cobrando, ni empezar un cobro en una mesa cerrada (409 en lugar de 500).
  - Una sola regla para todos los caminos de cobro: un medio de pago nuevo con pagos `PENDIENTE` tiene que llamar a `liberarMesaDelCobro` al resolverlos.
- **Un pago `PENDIENTE` que nunca se resuelve deja la mesa amarilla** hasta que la conciliación lo vence (15 min por defecto, ADR 0012). Si la conciliación está apagada, el mozo no puede cerrar la mesa.
- **Datos anteriores a este cambio:** una mesa roja con un pago `PENDIENTE` no se puede cerrar hasta que el pago se resuelva o venza.
- **Casos de prueba:** TC-I-195 a 198 en `sesion-mesa.e2e-spec.ts`; TC-I-198 prueba el bloqueo con dos transacciones en paralelo contra PostgreSQL.
- **Solicitud de cambio menor en el Anexo 10:** la transición de `EN_PROCESO_DE_PAGO` a `OCUPADA` ocurre cuando termina el último cobro en curso de la mesa, y «Cerrar mesa» no se permite con cobros pendientes.

## Control de versiones

| Versión | Fecha | Modificación |
| --- | --- | --- |
| 1.0 | 10/11/2026 | Versión inicial (BL-509). |
