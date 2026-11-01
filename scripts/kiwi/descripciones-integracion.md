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
| 1.8     | 28/10/2026 | TC-I-122 a 125 (pedido cargado por el mozo, HU-039 / BL-209), para cargar con el script antes de mergear el PR.                                          |
| 1.9     | 31/10/2026 | TC-I-106 y 107: DELETE pasa a eliminar definitivamente (BL-394). TC-I-126 a 131: Gestión de Carta (BL-392 / BL-402).                                     |

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

## TC-I-122

### Precondición

Tenant A del seed, la mesa de prueba 92 abierta (con sesión) y el usuario MOZO del seed.

### Pasos

1. Cargar un pedido con `PedidosService.crearPorMozo` (el mismo servicio que usa `POST /pedidos/mozo`) con el mozo como actor: 2 unidades de un ítem con nota y una nota general.
2. Consultar los cobros pendientes.
3. Cobrarlo en efectivo (BL-201).

### Resultado esperado

1. El pedido queda en `PENDIENTE_PAGO`, con canal `MOZO`, el `usuario_id` del mozo y la nota general.
2. Aparece entre los cobros pendientes.
3. Pasa a `RECIBIDO` con un único pago `EFECTIVO` / `APROBADO`.

## TC-I-123

### Precondición

La mesa de prueba 92 abierta.

### Pasos

1. Cargar un pedido como mozo.
2. Repetir la misma solicitud con el mismo `idempotencyKey` (doble toque o reintento).

### Resultado esperado

Las dos respuestas son el mismo pedido y en la base hay un único pedido con esa clave.

## TC-I-124

### Precondición

La mesa de prueba 92 abierta.

### Pasos

1. Cargar un pedido como mozo y no cobrarlo.
2. Cerrar la sesión de la mesa (`MesasService.cerrarSesion`).
3. Intentar cargar otro pedido en la mesa cerrada.

### Resultado esperado

1. El cierre cancela también el pedido del mozo que no se pagó (queda `CANCELADO`).
2. Con la mesa cerrada, la carga da 409.

## TC-I-125

### Precondición

Usuarios de prueba MOZO y COCINA del tenant A (`TEST_MOZO_*`, `TEST_COCINA_*`) y la mesa de prueba 92 abierta.

### Pasos

1. `POST /pedidos/mozo` con el token de COCINA.
2. `POST /pedidos/mozo` con el token del MOZO.

### Resultado esperado

1. 403: Cocina no puede cargar pedidos.
2. 201 con el pedido en `PENDIENTE_PAGO`, canal `MOZO`, la mesa 92 y el usuario que lo cargó.

## TC-I-106

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`). El servicio de la carta está simulado: el caso prueba la ruta, el rol y el aviso en tiempo real.

### Pasos

1. `DELETE /admin/menu/item/:id` con el token del ADMIN.

### Resultado esperado

1. 200 con `{ id, eliminado: true }` en menos de 2 segundos.
2. Se emite `menu:item:retirado` con el id del ítem.

Desde BL-394, DELETE elimina definitivamente (solo sin historial). Sacar un ítem de la carta y conservarlo es «archivar» (`POST …/archivar`). El 409 con historial lo prueba TC-I-129.

## TC-I-107

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`). El servicio de la carta está simulado: el caso prueba la ruta, el rol y el aviso en tiempo real.

### Pasos

1. `DELETE /admin/menu/categoria/:id` con el token del ADMIN.

### Resultado esperado

1. 200 con `{ id, eliminada: true }` en menos de 2 segundos.
2. Se emite `menu:categoria:retirada` con el id de la categoría.

Desde BL-394, DELETE elimina definitivamente (solo sin ítems). El 409 con ítems lo prueba TC-I-129.

## TC-I-126

### Precondición

Usuarios de prueba ADMIN y MOZO del tenant A (`TEST_ADMIN_*`, `TEST_MOZO_*`). El test crea su propia categoría «BL-402 …» con dos ítems.

### Pasos

1. Como MOZO, `GET /admin/menu/categoria`.
2. Como MOZO, marcar un ítem agotado y otra vez disponible (`PATCH /admin/menu/item/:id/disponibilidad`).
3. Como MOZO, crear y editar una categoría, crear, editar, archivar y eliminar un ítem, y reordenar la carta.

### Resultado esperado

1. 200: el mozo ve la carta.
2. 200 en los dos cambios.
3. 403 en todas: editar la carta es solo del ADMIN (BL-395).

## TC-I-127

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y la categoría de prueba.

### Pasos

1. `PATCH /admin/menu/categoria/:id` con un `updatedAt` viejo.
2. Repetir con el `updatedAt` actual (el que devuelve `GET /admin/menu/categoria`).

### Resultado esperado

1. 409 «Otra persona modificó este dato. Recargá para ver los cambios.» y no se guarda nada.
2. 200: se guarda (bloqueo optimista, BL-394).

## TC-I-128

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y la categoría de prueba con dos ítems.

### Pasos

1. Crear un pedido para retirar con el primer ítem.
2. Archivar el segundo ítem y crear un pedido con él.
3. Ocultar la categoría (`activo: false`) y crear un pedido con el primer ítem.
4. Volver a mostrar la categoría.

### Resultado esperado

1. El pedido se crea.
2. 400 «no existe en la carta»: un ítem archivado no se puede pedir.
3. 400 «no existe en la carta»: tampoco un ítem de una categoría oculta (BL-397, un solo criterio para el comensal y el mozo).

## TC-I-129

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`). El primer ítem de la categoría de prueba tiene un pedido (TC-I-128) y el segundo está archivado.

### Pasos

1. `DELETE /admin/menu/item/:id` del ítem con pedido.
2. `DELETE /admin/menu/categoria/:id` de la categoría de prueba.

### Resultado esperado

1. 409 «El ítem tiene pedidos y no se puede eliminar. Archivalo para sacarlo de la carta.»
2. 409 «La categoría tiene ítems y no se puede eliminar…»: cuenta también el ítem archivado (BL-394).

## TC-I-130

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`). La categoría de prueba quedó al final de la carta (la API asigna el orden, BL-399).

### Pasos

1. `PUT /admin/menu/categorias/orden` con la lista sin una categoría.
2. Repetir con la lista completa en orden inverso y leer la carta.
3. Volver a dejar el orden original.

### Resultado esperado

1. 409 «La carta cambió mientras la ordenabas. Recargá e intentá de nuevo.» y el orden no cambia.
2. 200 y la carta vuelve en el orden nuevo.
3. 200.

## TC-I-131

### Precondición

Usuario de prueba ADMIN del tenant B (`TEST_TENANT_B_*`) y la categoría de prueba del tenant A.

### Pasos

1. Como admin de B, `GET /admin/menu/categoria` con el restaurante de A.
2. Como admin de B, editar, archivar, eliminar y reordenar la categoría de A, y marcar agotado y archivar uno de sus ítems.

### Resultado esperado

1. La respuesta no trae la categoría de A (RLS).
2. 404 en todas: para otro tenant, la carta de A no existe.
