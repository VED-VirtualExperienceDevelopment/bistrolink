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

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-187

### Precondición

Tenant A del seed con la sincronización con el POS activada. POS de prueba (adaptador mock) en línea, con dos ventas de mostrador del tenant A en efectivo ($ 350,50 y $ 149,50) a las 10:15 UTC de un día del pasado, y una venta que mandó BistroLink (con la referencia de un pedido).

### Pasos

1. Traer las ventas del POS para el tenant A.
2. Ver las ventas importadas y el resumen por hora del canal POS.
3. Traer las ventas otra vez.
4. Pedir el reporte de ese día con el canal «POS del local».
5. Buscar las ventas importadas como tenant B.

### Resultado esperado

1. Se importan las dos ventas de mostrador; la de BistroLink se omite.
2. Están las dos ventas, y el resumen de esa hora (canal POS, efectivo) tiene 2 ventas por $ 500.
3. No hay ventas nuevas ni duplicadas, y el resumen no cambia.
4. Total vendido $ 500 con 2 ventas; «POS del local» suma $ 500 en «Dentro y fuera del local»; sin platos.
5. El tenant B no ve ninguna (RLS).

## TC-I-188

### Precondición

Igual que TC-I-187, con dos ventas de mostrador con crédito ($ 800 y $ 200) ya importadas.

### Pasos

1. Anular en el POS la venta de $ 800 y apagar el POS.
2. Traer las ventas.
3. Volver a prender el POS y traer las ventas.
4. Ver el resumen de esa hora y el reporte del día con el canal «POS del local».

### Resultado esperado

1. —
2. Falla porque el POS no está disponible; el resumen no cambia (2 ventas).
3. Se actualiza la venta anulada.
4. Queda 1 venta por $ 200: la anulada dejó de contar.

## TC-I-189

### Precondición

Usuarios Administrador y Cocina del tenant A (Keycloak de pruebas). Sincronización activada y POS de prueba.

### Pasos

1. Como Administrador, GET /admin/pos/ventas.
2. POST /admin/pos/ventas/simular con total 123,45 y débito.
3. GET /admin/pos/ventas.
4. POST /admin/pos/ventas/importar.
5. POST /admin/pos/ventas/simular con total 0.
6. Apagar la sincronización y POST /admin/pos/ventas/importar.
7. Como Cocina, GET /admin/pos/ventas.

### Resultado esperado

1. 200 con la cantidad de ventas y el total.
2. 201: se importa 1 venta nueva, con un id del POS de prueba.
3. Una venta más y $ 123,45 más que en el paso 1.
4. 200 sin ventas nuevas.
5. 400.
6. 409.
7. 403.
