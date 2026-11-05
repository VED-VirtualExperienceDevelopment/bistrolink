# ADR 0010 — Cola del KDS y límite de pedidos en preparación

| Campo | Valor |
| --- | --- |
| Estado | Propuesta |
| Fecha | 05/11/2026 |
| Referencias | RF.03; RD.03; RD.06; RNF.05; RNF.06; HU-004 (BL-44); HU-038 (BL-208); ADR 0001; ADR 0006 |
| Autores | E. Arenas, V. Couto, D. Silvera |

## Contexto

Hoy el pedido llega al KDS en `RECIBIDO` cuando se aprueba el pago (ADR 0006) y el mozo o el administrador lo pasa a `EN_PREPARACION` a mano. No hay límite: en hora pico la cocina puede tener más pedidos "en preparación" de los que realmente puede hacer, y el comensal no sabe cuánto va a esperar.

La nueva funcionalidad pide un límite de pedidos en preparación por sucursal, una cola FIFO para los que no entran, la promoción automática del siguiente cuando se libera un lugar, el tiempo estimado ajustado para el comensal y una alerta de alta demanda cuando la cola crece.

La plataforma corre en una sola instancia con Socket.IO embebido (ADR 0001), sin Redis ni colas de mensajes.

## Decisión

- **La cola vive en PostgreSQL, no en memoria ni en un broker.** El estado del pedido es la cola: no se suma una tabla ni un servicio. Sobrevive a reinicios y a un redeploy, y queda aislada por tenant con el RLS existente.
- **`RECIBIDO` es el estado "en espera".** No se agrega `EN_ESPERA` al enum: `RECIBIDO` ya significa "llegó a cocina y todavía no se empezó". En la pantalla se muestra como «En espera» (KDS) y «En cola» (comensal).
- **El orden FIFO lo da `pedido.encolado_en`**, la hora en que el pedido pasó a `RECIBIDO` (pago aprobado), no `created_at`.
- **Límite por restaurante** (`restaurante.limite_pedidos_en_preparacion`). `NULL` = cola automática desactivada: el local sigue como hasta ahora. Los locales existentes no cambian al desplegar.
- **Atomicidad con un lock por tenant** (`pg_advisory_xact_lock`) dentro de la transacción que ya existe:
  - al confirmar el pago (`confirmarPagoEnTx`): si hay lugar, el pedido pasa de `RECIBIDO` a `EN_PREPARACION` en la misma transacción;
  - al pasar un pedido a `LISTO_PARA_ENTREGAR` o al cancelar uno en preparación: se promueve el más antiguo de la cola.
  El lock serializa solo las operaciones de cola del mismo local, se libera solo al terminar la transacción y funciona igual con varias instancias.
- **Eventos:** se reusan `pedido:nuevo` y `pedido:actualizado` (el `estado` del payload ubica el pedido en la sección correcta). Se suma `cola:actualizada` (cantidad en espera, límite, alerta de alta demanda y tiempo estimado) a la sala del staff del tenant, y se incluye en el snapshot al conectar.
- **Tiempo estimado:** promedio de `EN_PREPARACION → LISTO_PARA_ENTREGAR` de los últimos pedidos del día (historial de estados); sin historial, `minutos_preparacion_estimados`. Para la posición `p` de la cola: `promedio × (1 + p / límite)`. Crece solo con la cola, así que la alerta de alta demanda no necesita un multiplicador aparte.

## Alternativas consideradas

| Alternativa | Por qué se descartó |
| --- | --- |
| Nuevo estado `EN_ESPERA` en el enum | Duplica el significado de `RECIBIDO` y obliga a tocar la máquina de estados, reportes, la ficha del establecimiento, el cierre de mesa y el seguimiento del comensal. |
| Cola en memoria (como las alertas pendientes) | Se pierde al reiniciar o redeployar y no escala a más de una instancia. |
| Redis / BullMQ | Infraestructura nueva y un costo de operación que hoy no se justifica para una sola instancia; el problema es de consistencia, no de throughput. |
| `SELECT … FOR UPDATE` sobre los pedidos | No bloquea el caso "no hay filas todavía" y tiene más riesgo de deadlock que un lock por tenant. |
| Promoción por un job periódico | Agrega demora y una segunda fuente de cambios de estado; la promoción en la misma transacción es inmediata y consistente. |

## Consecuencias

- La transición manual `RECIBIDO → EN_PREPARACION` se mantiene, pero respeta el límite cuando la cola automática está activa.
- Las transiciones del KDS siguen siendo de Mozo y Administrador (RD.06): el rol Cocina sigue en solo lectura.
- Para escalar a varias instancias solo falta el adaptador de Redis de Socket.IO (ya documentado en ADR 0001); el lock y la cola no cambian.
