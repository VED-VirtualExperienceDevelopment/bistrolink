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
| 1.39    | 14/11/2026 | TC-I-221 y 222: «Sugerencia del local» (HU-044 / BL-537). Se borran los bloques de TC-I-217 a 220, ya cargados.                                                                                                                           |
| 1.40    | 14/11/2026 | TC-I-223 y 224: insignia «Más pedido» (HU-045 / BL-543). Se borran los bloques de TC-I-221 y 222, ya cargados.                                                                                                                            |
| 1.41    | 14/11/2026 | TC-I-225 a 228: complementos antes de pagar (HU-046 / BL-551 y BL-552): platos sugeribles y con alcohol, reglas de asociación y endpoint. Se borran los bloques de TC-I-223 y 224, ya cargados.                                           |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-225

### Precondición

Tenant A del seed, con el administrador logueado. Plato de prueba «Pancho de prueba» (BL-402), sin alcohol y sin sugerir.

### Pasos

1. `PATCH /admin/menu/item/:id` con `{ sugerible: "si" }`.
2. `PATCH` con `{ sugerible: true }`.
3. `PATCH` con `{ contieneAlcohol: true }`.
4. `PATCH` con `{ sugerible: true }`, y después con `{ sugerible: true, contieneAlcohol: true }`.
5. Marcarlo sugerible directo en la base, sin pasar por la API.
6. Leer la carta del administrador y el registro de auditoría del plato.

### Resultado esperado

1. 400: el valor no es booleano.
2. 200, con `sugerible: true` y `contieneAlcohol: false`.
3. 200, con `contieneAlcohol: true` y `sugerible: false`: con alcohol deja de ser sugerible.
4. 400 las dos veces, con el mensaje «Un plato con alcohol no se puede sugerir como complemento.», y el plato no cambia.
5. La base lo rechaza (CHECK `item_carta_alcohol_no_sugerible`).
6. La carta trae `sugerible: false` y `contieneAlcohol: true`. La auditoría (`CARTA_ITEM_MODIFICADO`) tiene `sugerible` de `false` a `true`, y `sugerible` de `true` a `false` con `contieneAlcohol` de `false` a `true`.

## TC-I-226

### Precondición

Tenant A del seed, con el usuario MOZO logueado.

### Pasos

1. `PATCH /admin/menu/item/:id` con `{ sugerible: true }`.
2. `PATCH` con `{ contieneAlcohol: true }`.

### Resultado esperado

1. 403.
2. 403. Solo el administrador cambia estos campos.

## TC-I-227

### Precondición

Tenant A del seed. Categoría de prueba con Milanesa, Flan (sugerible), Vino (con alcohol), Agua (sugerible), Café (sugerible) y Relleno. Pedidos con pago cargados en la base: 6 con milanesa, flan y vino; 4 con milanesa y agua aprobados y 3 rechazados; 5 con milanesa y café de hace 100 días; 5 solo con relleno.

### Pasos

1. Recalcular las reglas del local.
2. Leer las reglas de los platos de prueba.
3. Recalcular otra vez.
4. Leer las reglas de la milanesa desde el contexto de otro tenant.

### Resultado esperado

1. Termina sin errores.
2. Solo dos reglas, las dos hacia el flan: milanesa → flan (6 pedidos con los dos, confianza 0,6, lift mayor que 1, soporte mayor que 0) y vino → flan. No hay regla hacia el agua (4 pedidos aprobados: menos de 5), el café (fuera de los 90 días), el vino (tiene alcohol) ni la milanesa (no es sugerible).
3. Las mismas dos reglas: el recálculo es idempotente.
4. Ninguna: la RLS no deja ver las reglas de otro local.

## TC-I-228

### Precondición

Igual que TC-I-227, con las reglas recalculadas. El agua tiene 12 unidades vendidas hace 3 días en `resumen_platos_hora` (respaldo de popularidad, HU-045). La mesa 1 del seed, con la sesión abierta.

### Pasos

1. `POST /menu/tenant/:tenantId/restaurante/:restauranteId/complementos` con la milanesa.
2. Lo mismo con la milanesa y el flan.
3. Marcar el flan como agotado y pedir con la milanesa. Volver a dejarlo disponible.
4. Pedir con el vino.
5. Pedir sin platos, con un id inválido y con un restaurante que no es del tenant.
6. `POST /menu/qr/:token/complementos` con la milanesa, 21 veces seguidas con el mismo QR.
7. `POST /menu/qr/inventado/complementos`.

### Resultado esperado

1. 200, `origen: "reglas"` y solo el flan, con `id`, `nombre`, `descripcion`, `precio` e `imagenUrl`: nada de las reglas ni de otros pedidos.
2. 200, `origen: "popularidad"` y solo el agua: el flan ya está en el pedido.
3. El flan no aparece.
4. El vino no aparece.
5. 400, 400 y 404.
6. Las primeras 20 responden 200 con el flan; la 21, 429.
7. 404.
