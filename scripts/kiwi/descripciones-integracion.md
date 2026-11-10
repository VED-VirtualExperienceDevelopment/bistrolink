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
| 1.29    | 10/11/2026 | TC-I-192 y 193: umbrales de espera del KDS configurables por local (HU-038 / BL-506), para cargar con el script antes de mergear el PR. |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-190

### Precondición

Tenant A del seed. Mesa 92 abierta, con dos pedidos cargados por el usuario Mozo del seed, los dos esperando el pago.

### Pasos

1. Como Mozo, cancelar el primer pedido.
2. Ver el pedido, su historial, la auditoría, la mesa, el segundo pedido y los cobros pendientes.
3. Cancelar el primer pedido otra vez.
4. Con un pago con tarjeta en curso en el segundo pedido, intentar cancelarlo.
5. Cobrar el segundo pedido en efectivo e intentar cancelarlo.

### Resultado esperado

1. Devuelve el pedido como CANCELADO, con su total.
2. El pedido está CANCELADO y sin pagos; el historial registra el paso de PENDIENTE_PAGO a CANCELADO con el usuario del mozo; la auditoría tiene PEDIDO_PENDIENTE_CANCELADO con el mozo como actor; la mesa sigue OCUPADA; el segundo pedido sigue esperando el pago; el primero ya no está entre los cobros pendientes y el segundo sí.
3. Conflicto: «El pedido ya está cancelado».
4. Conflicto: el comensal tiene un pago con tarjeta en curso. El pedido sigue esperando el pago.
5. Conflicto: «Este pedido ya se cobró: se cancela con la devolución del pago». El pedido queda en RECIBIDO.

## TC-I-191

### Precondición

Usuarios Mozo y Cocina del tenant A (Keycloak de pruebas). Un pedido cargado por el mozo en la mesa 92, esperando el pago.

### Pasos

1. Como Cocina, POST /cobros/pendientes/{id}/cancelar.
2. Como Mozo, POST /cobros/pendientes/{id}/cancelar.
3. Repetir el paso 2.
4. Como Mozo, cancelar con un id que no es UUID y con un UUID que no existe.

### Resultado esperado

1. 403, y el pedido sigue esperando el pago.
2. 200 con el pedido CANCELADO y su total.
3. 409.
4. 400 y 404.

## TC-I-192

### Precondición

Base de pruebas con el restaurante del tenant A y sus umbrales de espera por defecto (30/60/120).

### Pasos

1. Como administrador, cambiar los umbrales a 15 / 45 / 90 minutos (PATCH /admin/configuracion).
2. Leer la configuración guardada.
3. Revisar la auditoría de configuración.
4. Revisar el aviso a los KDS abiertos.

### Resultado esperado

1. 200 con los umbrales nuevos.
2. Quedan guardados 15 / 45 / 90.
3. Un registro «Configuración modificada» con los umbrales anteriores y los nuevos.
4. Se avisa al tenant con los umbrales nuevos (kds:umbrales-espera).

## TC-I-193

### Precondición

Igual que TC-I-192.

### Pasos

1. Como administrador, poner «Demora alta desde» igual a «Demorado desde».
2. Sin pasar por la API, escribir en la base «Atención» mayor que «Demorado».
3. Sin pasar por la API, escribir en la base «Demora alta» en 601 minutos.

### Resultado esperado

1. 400: «Demora alta desde» tiene que ser mayor que «Demorado desde». No se guarda ni se audita nada.
2. La base lo rechaza (CHECK restaurante_minutos_espera_orden).
3. La base lo rechaza (CHECK restaurante_minutos_espera_rango). La configuración queda como estaba.
