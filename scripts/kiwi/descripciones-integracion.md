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

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-183

### Precondición

Tenant A del seed con «Mandar las ventas al POS» activado. POS de prueba (adaptador mock) en línea. Mesa 74 abierta con un pedido en PENDIENTE_PAGO de un ítem de $ 590.

### Pasos

1. Cobrar el pedido con el POS del local (débito).
2. Esperar a que la venta figure como enviada.
3. Buscar la sincronización del pedido como tenant B.

### Resultado esperado

1. El cobro se confirma y la venta queda encolada en la misma transacción.
2. En menos de 5 s la venta está ENVIADA, con 1 intento, sin error y con el id que devolvió el POS. El POS recibió la venta con el id del pedido como referencia, moneda UYU, total 590, medio POS_DEBITO, la mesa 74 y la línea del ítem.
3. El tenant B no ve la fila (RLS).

## TC-I-184

### Precondición

Igual que TC-I-183, con el POS de prueba fuera de línea.

### Pasos

1. Cobrar el pedido.
2. Ver la sincronización y el estado del pedido.
3. Volver a poner el POS en línea y correr el job de reintentos para el tenant A.

### Resultado esperado

1. El cobro se confirma igual.
2. La venta queda PENDIENTE, con 1 intento y el motivo «El POS de prueba está fuera de línea». El pedido ya no está en PENDIENTE_PAGO: la falla del POS no deshace el cobro.
3. El job manda la venta: queda ENVIADA con 2 intentos y el POS la tiene registrada.

## TC-I-185

### Precondición

Igual que TC-I-183. Motivo de cancelación «Reclamo del cliente», con la devolución en efectivo confirmada.

### Pasos

1. Cobrar un pedido, esperar a que la venta esté ENVIADA y cancelar el pedido.
2. Con el POS fuera de línea, cobrar otro pedido (la venta queda PENDIENTE) y cancelarlo antes de que se mande.

### Resultado esperado

1. Se crea la ANULACION del pedido, queda ENVIADA y la venta figura anulada en el POS.
2. La VENTA queda DESCARTADA, no se crea ninguna anulación y el POS nunca recibe esa venta.

## TC-I-186

### Precondición

Usuarios Administrador y Cocina del tenant A (Keycloak de pruebas). Una venta que el POS rechazó (HTTP 422) y quedó con error.

### Pasos

1. Como Administrador, GET /admin/pos/sincronizaciones.
2. POST /admin/pos/sincronizaciones/{id}/reintentar de la venta con error.
3. Repetir el reintento.
4. PATCH /admin/pos/configuracion con `habilitada: "si"` y después con `habilitada: true`.
5. Como Cocina, GET /admin/pos/sincronizaciones.

### Resultado esperado

1. 200 con `habilitada: true`, adaptador «mock» y la venta con error (tipo VENTA, total 590, mesa 74).
2. 200: la venta queda ENVIADA y sin error.
3. 409: ya está en el POS.
4. 400 con el valor inválido; 200 con `habilitada: true`.
5. 403.
