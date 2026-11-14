# Descripciones de los casos de integración (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                                                                                                              |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 24/10/2026 | TC-I-010 a 013 y 055 a 081, cargadas en Kiwi con el script.                                                                                                                                                                               |
| 1.1     | 27/10/2026 | TC-I-022 a 024 (el pedido llega al KDS al aprobarse el pago, BL-311) y TC-I-082 a 086 (sesión de mesa, HU-017 / BL-60). Cargadas en Kiwi el 27/10/2026.                                                                                   |
| 1.2     | 27/10/2026 | TC-I-082 a 086: la mesa del test pasa de la 97 a la 79 (fuera del rango 80 a 99 de `mesas-layout.e2e-spec.ts`).                                                                                                                           |
| 1.3     | 27/10/2026 | TC-I-087 a 094 (gestión de establecimientos, BL-404 / BL-416), para cargar con el script antes de mergear el PR.                                                                                                                          |
| 1.4     | 27/10/2026 | TC-I-095 a 098 (vencimiento y conciliación de pagos, HU-032 / BL-202).                                                                                                                                                                    |
| 1.5     | 27/10/2026 | Se recupera el contenido que se perdió en el merge de BL-435 (TC-I-010 a 098). TC-I-099 a 108: CRUD de la carta (HU-005, BL-52/BL-53), antes `[TC-E-…]`.                                                                                  |
| 1.6     | 28/10/2026 | TC-I-113 a 117 (cobro en efectivo, HU-031 / BL-201), para cargar con el script antes de mergear el PR.                                                                                                                                    |
| 1.7     | 28/10/2026 | TC-I-118 a 121 (solicitud de pago en efectivo del comensal, HU-031b / BL-442), para cargar con el script antes de mergear el PR.                                                                                                          |
| 1.8     | 28/10/2026 | TC-I-122 a 125 (pedido cargado por el mozo, HU-039 / BL-209), para cargar con el script antes de mergear el PR.                                                                                                                           |
| 1.9     | 31/10/2026 | TC-I-106 y 107: DELETE pasa a eliminar definitivamente (BL-394). TC-I-126 a 131: Gestión de Carta (BL-392 / BL-402).                                                                                                                      |
| 1.10    | 01/11/2026 | TC-I-132 a 135 (configuración del establecimiento, HU-020 / BL-72), para cargar con el script antes de mergear el PR.                                                                                                                     |
| 1.11    | 01/11/2026 | TC-I-133 y 135: Plexo queda fuera del MVP, igual que Handy (BL-452).                                                                                                                                                                      |
| 1.12    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-136 y 137: avisos de efectivo pendientes en el KDS (BL-448), para cargar con el script antes de mergear el PR.                                                               |
| 1.13    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-138: rebaja de IVA de la Ley 17.934 en el estado del pago (HU-037 / BL-207), para cargar con el script antes de mergear el PR.                                               |
| 1.14    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-139: datos del establecimiento para la política de privacidad (HU-036 / BL-206), para cargar con el script antes de mergear el PR.                                           |
| 1.15    | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-140 y 141: e-Factura con RUT y razón social, consentimiento y anonimización (HU-009 / BL-453), para cargar con el script antes de mergear el PR.                             |
| 1.16    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-142 y 143: estado de los CFE ante la DGI y listado de comprobantes del administrador (HU-009 / BL-455), para cargar con el script antes de mergear el PR.                    |
| 1.17    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-144 a 152: dashboard de reportes de ventas y resumen por hora (HU-012 / BL-108, BL-109, BL-110 y BL-219), para cargar con el script antes de mergear el PR.                  |
| 1.18    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-153 a 160: stock de la jornada, alertas de stock bajo y descuento al confirmar el pago (HU-015 / BL-120, BL-121 y BL-122), para cargar con el script antes de mergear el PR. |
| 1.19    | 04/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-161 y 162: conciliación de CFE pendientes y pendientes de emisión del administrador (HU-023 / BL-96), para cargar con el script antes de mergear el PR.                      |
| 1.20    | 06/11/2026 | TC-I-164 a 167: cola del KDS y límite de pedidos en preparación (HU-042 / BL-467), para cargar con el script antes de mergear el PR.                                                                                                      |
| 1.21    | 07/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-168 a 174: limpieza de los datos de prueba (BL-285 / BL-476, ADR 0011), para cargar con el script antes de mergear el PR.                                                    |
| 1.22    | 07/11/2026 | TC-I-177 y 178: cobro con el POS del local (HU-007b / BL-80), para cargar con el script antes de mergear el PR.                                                                                                                           |
| 1.23    | 07/11/2026 | TC-I-179 a 182: cancelación de un pedido pagado y devolución del pago (HU-024 / BL-104), para cargar con el script antes de mergear el PR.                                                                                                |
| 1.24    | 07/11/2026 | Se borran los bloques de TC-I-177 a 182, ya cargados en Kiwi. TC-I-175 y 176: PDF del comprobante y su copia en S3 (HU-009 / BL-454), para cargar con el script antes de mergear el PR.                                                   |
| 1.25    | 08/11/2026 | Se borran los bloques de TC-I-168 a 176, ya cargados en Kiwi. TC-I-142: el estado ante la DGI se consulta con la API v2 de Surtec, CFE por CFE (HU-009 / BL-471); cambia el título y la descripción.                                      |
| 1.26    | 08/11/2026 | Se borra el bloque de TC-I-142, ya cargado en Kiwi. TC-I-183 a 186: ventas de BistroLink al POS del local (HU-011 / BL-488), para cargar con el script antes de mergear el PR.                                                            |
| 1.27    | 09/11/2026 | Se borran los bloques de TC-I-183 a 186, ya cargados en Kiwi. TC-I-187 a 189: ventas hechas en el POS del local, traídas al dashboard (HU-011 / BL-489), para cargar con el script antes de mergear el PR.                                |
| 1.28    | 09/11/2026 | Se borran los bloques de TC-I-187 a 189, ya cargados en Kiwi. TC-I-190 y 191: cancelar un pedido que todavía no se cobró (bug BL-501), para cargar con el script antes de mergear el PR.                                                  |
| 1.29    | 10/11/2026 | TC-I-192 y 193: umbrales de espera del KDS configurables por local (HU-038 / BL-506), para cargar con el script antes de mergear el PR.                                                                                                   |
| 1.30    | 10/11/2026 | TC-I-194: propinas del reporte de ventas, aparte del consumo y por canal (HU-022 / BL-496). Renumerado desde TC-I-153, que ya era de stock (BL-512).                                                                                      |
| 1.31    | 10/11/2026 | TC-I-195 a 198: estado de la mesa con varios cobros, cierre con cobros pendientes y cobro con la mesa cerrada (HU-017 / bug BL-509), para cargar con el script antes de mergear el PR.                                                    |
| 1.32    | 10/11/2026 | Se borran los bloques de TC-I-190 a 198, ya cargados en Kiwi. TC-I-203 a 205: «Mis pedidos» en la mesa y acceso a un pedido solo en la sesión abierta (bug BL-502), para cargar con el script antes de mergear el PR.                     |
| 1.33    | 10/11/2026 | Se borran los bloques de TC-I-203 a 205, ya cargados en Kiwi. TC-I-206 y 207: aviso al comensal cuando el mozo cierra la mesa (bug BL-518), para cargar con el script antes de mergear el PR.                                             |
| 1.34    | 11/11/2026 | TC-I-009: `GET /` responde JSON en lugar del texto «Hello World!» (DAST, BL-526); cambia el título y la descripción, para cargar con el script antes de mergear el PR.                                                                    |
| 1.35    | 13/11/2026 | TC-I-208 y 209: cola del KDS sugerida en el alta de un establecimiento (HU-042 / BL-472), para cargar con el script antes de mergear el PR.                                                                                               |
| 1.36    | 14/11/2026 | TC-I-199 a 202: pedidos para retirar (HU-040 / BL-210). Se borran los bloques ya cargados (TC-I-206 a 209 y 009).                                                                                                                         |
| 1.37    | 14/11/2026 | TC-I-210 a 216: pago por link (HU-033 / BL-203). Se borran los bloques de TC-I-199 a 202, ya cargados.                                                                                                                                    |
| 1.38    | 14/11/2026 | TC-I-217 a 220: marca propia del local (HU-043 / BL-531, 532, 561 y 562): plantilla, logo, nombre y dirección, y portada. Se numeran después de los de HU-033.                                                                            |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-220

### Precondición

Tenant A del seed con su restaurante. Se anota la portada guardada (o que no tiene).

### Pasos

1. Cambiar la configuración con el servicio, con `portadaKey` de una portada del tenant B.
2. Lo mismo con la key del logo del tenant A (`{tenant}/menu/marca/{uuid}.webp`).
3. Lo mismo con la key de la foto de un ítem del tenant A (`{tenant}/menu/{uuid}.webp`).
4. Lo mismo con una key de la cuarentena del tenant A (`incoming/…`).
5. Buscar en la auditoría los registros `ESTABLECIMIENTO_CONFIGURACION_MODIFICADA` del actor del test y leer la portada guardada.

### Resultado esperado

1. 400 «La portada no es válida para este establecimiento».
2. 400, con el mismo mensaje.
3. 400, con el mismo mensaje.
4. 400, con el mismo mensaje.
5. Ningún registro nuevo y la portada guardada no cambió.

## TC-I-219

### Precondición

Tenant A del seed con su restaurante. El nombre y la dirección guardados se anotan para restaurarlos al terminar.

### Pasos

1. Cambiar la configuración con el servicio: nombre y dirección nuevos.
2. Leer el restaurante en la base, con el contexto del tenant.
3. Buscar en la auditoría los registros `ESTABLECIMIENTO_CONFIGURACION_MODIFICADA` del actor del test.
4. Pedir la carta pública del restaurante (HU-002).

### Resultado esperado

1. La respuesta trae el nombre y la dirección nuevos.
2. Quedaron guardados.
3. Un solo registro, con los campos `nombre` y `direccion` y sus valores antes y después.
4. La carta muestra el nombre y la dirección nuevos.

## TC-I-218

### Precondición

Tenant A del seed con su restaurante. Se anota el logo guardado (o que no tiene).

### Pasos

1. Cambiar la configuración con el servicio, con `logoKey` de un logo del tenant B.
2. Lo mismo con una key de la cuarentena del tenant A (`incoming/…`).
3. Lo mismo con la key de la foto de un ítem del tenant A (`{tenant}/menu/{uuid}.webp`).
4. Buscar en la auditoría los registros `ESTABLECIMIENTO_CONFIGURACION_MODIFICADA` del actor del test y leer el logo guardado.

### Resultado esperado

1. 400 «El logo no es válido para este establecimiento».
2. 400, con el mismo mensaje.
3. 400, con el mismo mensaje.
4. Ningún registro nuevo y el logo guardado no cambió.

## TC-I-217

### Precondición

Tenant A del seed con su restaurante. La plantilla de marca guardada se anota para restaurarla al terminar.

### Pasos

1. Cambiar la configuración con el servicio a otra plantilla de la lista (`gourmet`, o `familiar` si ya era `gourmet`).
2. Leer el restaurante en la base, con el contexto del tenant.
3. Buscar en la auditoría los registros `ESTABLECIMIENTO_CONFIGURACION_MODIFICADA` del actor del test.
4. Escribir directo en la base la plantilla `azul`, sin pasar por la API.

### Resultado esperado

1. La respuesta trae la plantilla nueva y las cuatro que se pueden elegir (`clasica`, `gourmet`, `rapida`, `familiar`).
2. La plantilla nueva quedó guardada.
3. Un solo registro, con el campo `plantilla` y sus valores antes y después.
4. La base la rechaza (CHECK `restaurante_plantilla_valida`) y la plantilla guardada no cambia.

## TC-I-210

### Precondición

Tenant A del seed con su mozo y la mesa 71 abierta. Pasarela falsa que aprueba (como el sandbox) y CFE apagado. Pedido de 2 unidades cargado por el mozo (HU-039), en PENDIENTE_PAGO.

### Pasos

1. Generar el link de pago del pedido con el mozo del seed.
2. Revisar la URL del link.
3. `POST /auth/comensal/link-pago` con el token del link.
4. `GET /link-pago` con el JWT del comensal y el header `X-Link-Pago`.
5. `POST /pedidos/:id/pagos` con el JWT y `X-Link-Pago`.
6. Volver a abrir el link y consultar `GET /pedidos/:id/pagos` con `X-Link-Pago`.

### Resultado esperado

1. Devuelve la URL `/pagar/<token>` y el vencimiento.
2. El token tiene 103 caracteres y la URL no contiene el id del tenant, del restaurante, del pedido ni de la mesa.
3. 200 con el JWT del comensal técnico del tenant.
4. 200 con el pedido, estado PENDIENTE_PAGO, mesa 71, el consumo y el mismo vencimiento.
5. 201. El pedido pasa a RECIBIDO con el pago APROBADO (el mismo flujo de HU-007).
6. 200 en los dos: con el pedido pagado, el link sirve para ver el estado y el comprobante.

## TC-I-211

### Precondición

Igual que TC-I-210, con un pedido nuevo en PENDIENTE_PAGO.

### Pasos

1. Generar un link, abrirlo (`POST /auth/comensal/link-pago`) y guardar el JWT.
2. Generar otro link del mismo pedido, confirmando el reemplazo (`reemplazar: true`).
3. Abrir el primer link.
4. `POST /pedidos/:id/pagos` con el primer link.
5. Abrir el segundo link.

### Resultado esperado

1. 200.
2. Devuelve otro link.
3. 410 con `codigo` LINK_PAGO_REEMPLAZADO y «Este link de pago fue reemplazado por otro. Pedile al mozo el nuevo.».
4. 403 con el mismo mensaje. La pasarela no cobra: el pedido sigue en PENDIENTE_PAGO y sin pagos.
5. 200.

## TC-I-212

### Precondición

Igual que TC-I-210, con un pedido nuevo en PENDIENTE_PAGO.

### Pasos

1. Generar un link, abrirlo y guardar el JWT.
2. Dejar el vencimiento del link en el pasado.
3. Abrir el link.
4. `POST /pedidos/:id/pagos` con el link.

### Resultado esperado

1. 200.
2. —
3. 410 con `codigo` LINK_PAGO_VENCIDO y «Este link de pago venció. Pedile al mozo uno nuevo.».
4. 403 con el mismo mensaje. La pasarela no cobra: el pedido sigue en PENDIENTE_PAGO y sin pagos.

## TC-I-213

### Precondición

Igual que TC-I-210, con dos pedidos en PENDIENTE_PAGO (A y B).

### Pasos

1. Generar el link de A, abrirlo y pagar B con ese link.
2. Abrir el link de A con un carácter cambiado, un token inventado del mismo largo y `../admin`.
3. Dejar un pago PENDIENTE en B y generar su link.
4. Cancelar A y generar su link.
5. Buscar en la auditoría la acción PEDIDO_LINK_PAGO_GENERADO de A.

### Resultado esperado

1. 403: el link de un pedido no sirve para otro. B sigue sin pagos.
2. 404, 404 y 400, sin decir el motivo.
3. 409 «Hay un pago en curso para este pedido. Esperá a que se resuelva antes de generar un link.».
4. 409 «Este pedido ya no espera el pago».
5. Una sola entrada, sin el token del link.

## TC-I-214

### Precondición

Usuarios MOZO y COCINA del test (variables TEST_MOZO_* y TEST_COCINA_*). Un pedido en PENDIENTE_PAGO.

### Pasos

1. `POST /cobros/pendientes/:id/link-pago` con el token de COCINA.
2. El mismo pedido con el token del MOZO.
3. `GET /cobros/pendientes` con el token del MOZO.

### Resultado esperado

1. 403.
2. 200 con la URL `/pagar/<token>`.
3. El pedido tiene `linkPagoVenceEn` igual al vencimiento del paso 2, y la respuesta no contiene el token del link.

## TC-I-215

### Precondición

Igual que TC-I-210, con dos pedidos nuevos en PENDIENTE_PAGO (A y B).

### Pasos

1. Generar el link de A (como el mozo A).
2. Generar otro link de A sin confirmar el reemplazo (el mozo B, con la pantalla desactualizada).
3. Abrir el link del paso 1.
4. Generar el link de B dos veces a la vez, sin confirmar el reemplazo.
5. Abrir el link que se generó en el paso 4 y buscar en la auditoría los links generados de B.

### Resultado esperado

1. Devuelve el link.
2. 409 con `codigo` LINK_PAGO_ACTIVO y «Ya hay un link de pago activo para este pedido. Si generás otro, el anterior deja de servir.». No se reemplaza nada.
3. 200: el link del mozo A sigue sirviendo.
4. Uno devuelve el link y el otro, el mismo 409 LINK_PAGO_ACTIVO.
5. 200, y una sola entrada de auditoría.

## TC-I-216

### Precondición

Igual que TC-I-210, con un pedido nuevo en PENDIENTE_PAGO.

### Pasos

1. Generar el link, abrirlo, pagar y consultar `GET /pedidos/:id/pagos` con el link.
2. Dejar el vencimiento del link 24 horas en el pasado.
3. Abrir el link.
4. Consultar `GET /pedidos/:id/pagos` con el link.
5. Abrir el mismo link hasta pasar el límite de 10 por minuto.
6. Abrir el link de otro pedido.

### Resultado esperado

1. 201 al pagar y 200 al consultar.
2. —
3. 410 con `codigo` LINK_PAGO_CADUCADO y «Este link de pago ya no está disponible. Si necesitás el comprobante, pedíselo al local.».
4. 403 con el mismo mensaje: ya no se puede ver el pedido ni bajar el comprobante (que en una e-Factura tiene el RUT y la razón social del cliente).
5. Al pasar el límite responde 429.
6. 200: el límite es por link.
