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
| 1.32    | 10/11/2026 | Se borran los bloques de TC-I-190 a 198, ya cargados en Kiwi. TC-I-199 a 202: pedidos para retirar con código, horario, datos del comensal y entrega con código (HU-040 / BL-210), para cargar con el script antes de mergear el PR.      |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-199

### Precondición

Tenant A del seed, tomando pedidos para retirar todo el día. Pasarela de pago y CFE falsos (los tests no llaman a Mercado Pago ni a Surtec).

### Pasos

1. Como comensal del enlace web, crear un pedido para retirar con nombre, teléfono y el aviso aceptado, y pagarlo.
2. Crear otro pedido para retirar con nombre y teléfono pero sin aceptar el aviso, y pagarlo.
3. Consultar el estado del pago del primero (GET /pedidos/{id}/pagos) con el token del pedido.
4. Consultar los pedidos pendientes del KDS.

### Resultado esperado

1. El pedido queda RECIBIDO, en la mesa virtual, con un código de retiro R-NNN, el nombre sin espacios de más, el teléfono solo con dígitos y la fecha del consentimiento.
2. El pedido no guarda ni el nombre ni el teléfono, y su código es el siguiente del contador del local (después del 999 vuelve a R-001).
3. Devuelve el mismo código de retiro.
4. Los dos aparecen con su bloque de retiro: código y nombre (null en el que no aceptó el aviso).

## TC-I-200

### Precondición

Tenant A del seed. El test cambia la configuración del retiro y al terminar la deja como estaba.

### Pasos

1. Deshabilitar los pedidos para retirar, abrir la carta del enlace web e intentar crear un pedido.
2. Habilitarlos con una franja que no incluye la hora actual del local, abrir la carta e intentar crear un pedido.
3. Cambiar la franja para que incluya la hora actual, abrir la carta y crear un pedido.

### Resultado esperado

1. La carta indica retiro no habilitado ni abierto. POST /pedidos responde 409 con el código RETIRO_NO_DISPONIBLE y «Este local no está tomando pedidos para retirar.».
2. La carta indica habilitado pero cerrado, con la franja. 409 RETIRO_NO_DISPONIBLE con «Este local toma pedidos para retirar de HH:MM a HH:MM.».
3. La carta indica abierto y el pedido se crea (201).

## TC-I-201

### Precondición

Tenant A del seed. Tres pedidos para retirar pagados con el aviso aceptado: dos con el mismo teléfono (escrito de dos formas) y uno con otro teléfono.

### Pasos

1. Anonimizar el teléfono de los dos primeros como Administrador.
2. Ver los pedidos, sus códigos, pagos y líneas, y el pedido del otro teléfono.
3. Ver la auditoría.
4. Anonimizar el mismo teléfono otra vez.

### Resultado esperado

1. Informa 2 pedidos.
2. En los dos se borraron el nombre y el teléfono; se conservan la fecha del consentimiento y queda la de la anonimización. El código, los pagos y las líneas no cambiaron. El pedido del otro teléfono sigue con sus datos.
3. Un registro PEDIDO_RETIRO_ANONIMIZADO con la cantidad de pedidos y sin el teléfono.
4. Informa 0 pedidos.

## TC-I-202

### Precondición

Usuarios Mozo y Cocina del tenant A (Keycloak de pruebas). Un pedido para retirar pagado, con su código.

### Pasos

1. Como Mozo, entregar con el código (POST /pedidos/{id}/entregar-retiro) mientras está en cocina.
2. Pasarlo a listo e intentar el pase común a ENTREGADO del KDS.
3. Como Cocina, entregar con el código.
4. Como Mozo, entregar con un código mal escrito, con un id que no es UUID, con un pedido que no existe y con otro código válido.
5. Como Mozo, entregar con el código escrito como «r» y el número.
6. Repetir la entrega.

### Resultado esperado

1. 409: «El pedido todavía no está listo para retirar».
2. Se rechaza: los pedidos para retirar se entregan verificando el código.
3. 403.
4. 400, 400, 404 y 409 «El código no coincide: este pedido es el R-NNN. Revisá el pedido antes de entregarlo.». El pedido sigue listo.
5. 200: el pedido queda ENTREGADO, con una sola entrada en el historial.
6. 409: «Este pedido ya se entregó».
