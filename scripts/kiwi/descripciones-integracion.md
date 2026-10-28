# Descripciones de los casos de integración (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                             |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 24/10/2026 | TC-I-010 a 013 y 055 a 081, cargadas en Kiwi con el script.                                                                                              |
| 1.1     | 27/10/2026 | TC-I-022 a 024 (el pedido llega al KDS al aprobarse el pago, BL-311) y TC-I-082 a 086 (sesión de mesa, HU-017 / BL-60). Cargadas en Kiwi el 27/10/2026.  |
| 1.2     | 27/10/2026 | TC-I-082 a 086: la mesa del test pasa de la 97 a la 79 (fuera del rango 80 a 99 de `mesas-layout.e2e-spec.ts`).                                          |
| 1.3     | 27/10/2026 | TC-I-087 a 094 (gestión de establecimientos, BL-404 / BL-416), para cargar con el script antes de mergear el PR.                                         |
| 1.4     | 27/10/2026 | TC-I-095 a 098 (vencimiento y conciliación de pagos, HU-032 / BL-202).                                                                                   |
| 1.5     | 27/10/2026 | Se recupera el contenido que se perdió en el merge de BL-435 (TC-I-010 a 098). TC-I-099 a 108: CRUD de la carta (HU-005, BL-52/BL-53), antes `[TC-E-…]`. |
| 1.6     | 28/10/2026 | TC-I-113 a 117 (cobro en efectivo, HU-031 / BL-201), para cargar con el script antes de mergear el PR.                                                   |
| 1.7     | 28/10/2026 | TC-I-118 a 121 (solicitud de pago en efectivo del comensal, HU-031b / BL-442), para cargar con el script antes de mergear el PR.                         |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-109

### Precondición

Tenant A del seed con el ítem de carta 5555… y su precio original.

### Pasos

1. Cambiar el precio del ítem con `MenuAdminService.updateItem` (el mismo servicio que usa `PATCH /admin/menu/item/:id`), con un actor de prueba.
2. Volver a poner el precio original.

### Resultado esperado

1. En `registro_auditoria` hay una fila `CARTA_ITEM_MODIFICADO` del ítem, con el actor, `valores_antes` con el precio original y `valores_despues` con el nuevo.
2. La vuelta también queda registrada, con el precio original en `valores_despues`.

## TC-I-110

### Precondición

Un registro de auditoría del tenant A (el de TC-I-109). La API usa el rol de runtime `bistrolink_app`.

### Pasos

1. Desde el tenant A, `UPDATE registro_auditoria` sobre ese registro.
2. Desde el tenant A, `DELETE FROM registro_auditoria` sobre ese registro.

### Resultado esperado

Los dos fallan con «permission denied» (el rol no tiene UPDATE ni DELETE sobre la tabla) y el registro sigue igual.

## TC-I-111

### Precondición

Un registro de auditoría del tenant A.

### Pasos

1. Contar ese registro desde el contexto de otro tenant.

### Resultado esperado

0 filas: RLS no deja ver registros de otro establecimiento.

## TC-I-112

### Precondición

Usuarios de prueba ADMIN y MOZO del tenant A (`TEST_ADMIN_*`, `TEST_MOZO_*`) y al menos un registro `CARTA_ITEM_MODIFICADO`.

### Pasos

1. `GET /auditoria?accion=CARTA_ITEM_MODIFICADO` con el token del ADMIN.
2. `GET /auditoria` con el token del MOZO.

### Resultado esperado

1. 200 con registros, todos de esa acción; el más reciente es del ítem 5555… (entidad `item_carta`).
2. 403: solo el administrador consulta la auditoría.

## TC-I-113

### Precondición

Tenant A del seed con el efectivo habilitado y la mesa de prueba 94 ocupada. Un pedido de la mesa en `PENDIENTE_PAGO`, con una línea de $ 590.

### Pasos

1. Registrar el cobro en efectivo con `CobroEfectivoService.registrar` (el mismo servicio que usa `POST /cobros/efectivo`), con un actor de prueba y $ 1000 recibidos.

### Resultado esperado

1. La respuesta trae el total ($ 590.00), lo recibido ($ 1000.00) y el vuelto ($ 410.00).
2. El pedido queda en `RECIBIDO`, con su fila en el historial de estados.
3. Hay un único pago, `EFECTIVO` / `APROBADO`, por $ 590.00 (calculado en el backend).
4. En `registro_auditoria` hay una fila `PAGO_EFECTIVO_REGISTRADO` del pago, con el actor, el total, lo recibido y el vuelto en `valores_despues`, y el pedido en `detalle`.

## TC-I-114

### Precondición

Un pedido de la mesa de prueba en `PENDIENTE_PAGO`, de $ 590.

### Pasos

1. Registrar el cobro en efectivo.
2. Repetir exactamente la misma solicitud, con el mismo `idempotencyKey` (como un doble clic o un reintento).

### Resultado esperado

Las dos respuestas son iguales. Hay un único pago, una única fila `RECIBIDO` en el historial y un único registro de auditoría.

## TC-I-115

### Precondición

Un pedido de la mesa de prueba en `PENDIENTE_PAGO`, de $ 590.

### Pasos

1. Registrar dos cobros en efectivo del mismo pedido al mismo tiempo, con `idempotencyKey` distintos (por ejemplo, dos pestañas).

### Resultado esperado

Uno se registra y el otro falla con 409 («Este pedido ya fue pagado»). El pedido queda en `RECIBIDO` con un único pago: el segundo se revierte entero.

## TC-I-116

### Precondición

Un pedido de la mesa de prueba en `PENDIENTE_PAGO`. El establecimiento del tenant A con `efectivo_habilitado = false` (se vuelve a habilitar al terminar).

### Pasos

1. Registrar el cobro en efectivo.

### Resultado esperado

409 «El cobro en efectivo no está habilitado en este establecimiento». El pedido sigue en `PENDIENTE_PAGO` y no se crea ningún pago.

## TC-I-117

### Precondición

Usuarios de prueba MOZO y COCINA del tenant A (`TEST_MOZO_*`, `TEST_COCINA_*`). Un pedido de la mesa de prueba en `PENDIENTE_PAGO`, de $ 590.

### Pasos

1. `GET /cobros/pendientes` con el token del MOZO.
2. `POST /cobros/efectivo` con el token del MOZO y $ 500 recibidos.
3. `POST /cobros/efectivo` con el token de COCINA y $ 600 recibidos.
4. `POST /cobros/efectivo` con el token del MOZO y $ 600 recibidos.

### Resultado esperado

1. 200: el efectivo figura habilitado y el pedido aparece con total $ 590.00, la mesa 94 y sin pago en curso.
2. 400: el monto recibido es menor que el total.
3. 403: Cocina no puede registrar cobros.
4. 201 con vuelto $ 10.00; el pedido queda en `RECIBIDO`.

## TC-I-118

### Precondición

Tenant A del seed con el efectivo habilitado y la mesa de prueba 93 ocupada. Dos pedidos de la mesa en `PENDIENTE_PAGO`, de $ 590.

### Pasos

1. Pedir pagar en efectivo el segundo pedido con `SolicitudEfectivoService.solicitar` (el mismo servicio que usa `POST /pedidos/:id/pagos/solicitud-efectivo`), diciendo que paga con $ 1000.
2. Consultar los cobros pendientes (`CobroEfectivoService.pendientes`, el de `GET /cobros/pendientes`).

### Resultado esperado

1. La respuesta trae el total ($ 590.00), con cuánto paga ($ 1000.00) y que se avisó.
2. El pedido sigue en `PENDIENTE_PAGO`, con `efectivo_solicitado_en` y `efectivo_paga_con` = 1000.00, y sin ningún pago creado.
3. Se avisa al staff (`llamado:nuevo`) con la mesa 93, el pedido, el total y con cuánto paga.
4. En los cobros pendientes, ese pedido aparece antes que el otro y marcado con la solicitud de efectivo.

## TC-I-119

### Precondición

Un pedido para retirar (canal WEB, mesa virtual) en `PENDIENTE_PAGO`.

### Pasos

1. Pedir pagar en efectivo ese pedido.

### Resultado esperado

409 (el efectivo es solo para pedidos hechos en el local). El pedido no queda marcado y no se avisa al staff.

## TC-I-120

### Precondición

Un pedido de la mesa de prueba en `PENDIENTE_PAGO`. El establecimiento con `efectivo_habilitado = false` (se vuelve a habilitar al terminar).

### Pasos

1. Pedir pagar en efectivo.

### Resultado esperado

409 «Este local no acepta pagos en efectivo…». El pedido no queda marcado.

## TC-I-121

### Precondición

Un pedido de la mesa de prueba en `PENDIENTE_PAGO`, el token del comensal (`POST /auth/comensal/mesa` con el QR y la sesión de la mesa) y el QR y la sesión de otra mesa (la del seed).

### Pasos

1. `POST /pedidos/:id/pagos/solicitud-efectivo` sin `X-Mesa-Token`.
2. El mismo POST con el QR y la sesión de otra mesa.
3. El mismo POST con el QR y la sesión de su mesa, pagando con $ 600.
4. `GET /pedidos/:id/pagos` con el QR y la sesión de su mesa.

### Resultado esperado

1. 400.
2. 403 (el pedido es de otra mesa).
3. 200, con `pagaCon` 600.00 y `avisado` true.
4. 200 con `efectivo.disponible` true y `efectivo.pagaCon` 600.00.
