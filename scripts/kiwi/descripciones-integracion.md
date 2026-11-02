# Descripciones de los casos de integración (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                                                                    |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 24/10/2026 | TC-I-010 a 013 y 055 a 081, cargadas en Kiwi con el script.                                                                                                                                     |
| 1.1     | 27/10/2026 | TC-I-022 a 024 (el pedido llega al KDS al aprobarse el pago, BL-311) y TC-I-082 a 086 (sesión de mesa, HU-017 / BL-60). Cargadas en Kiwi el 27/10/2026.                                         |
| 1.2     | 27/10/2026 | TC-I-082 a 086: la mesa del test pasa de la 97 a la 79 (fuera del rango 80 a 99 de `mesas-layout.e2e-spec.ts`).                                                                                 |
| 1.3     | 27/10/2026 | TC-I-087 a 094 (gestión de establecimientos, BL-404 / BL-416), para cargar con el script antes de mergear el PR.                                                                                |
| 1.4     | 27/10/2026 | TC-I-095 a 098 (vencimiento y conciliación de pagos, HU-032 / BL-202).                                                                                                                          |
| 1.5     | 27/10/2026 | Se recupera el contenido que se perdió en el merge de BL-435 (TC-I-010 a 098). TC-I-099 a 108: CRUD de la carta (HU-005, BL-52/BL-53), antes `[TC-E-…]`.                                        |
| 1.6     | 28/10/2026 | TC-I-113 a 117 (cobro en efectivo, HU-031 / BL-201), para cargar con el script antes de mergear el PR.                                                                                          |
| 1.7     | 28/10/2026 | TC-I-118 a 121 (solicitud de pago en efectivo del comensal, HU-031b / BL-442), para cargar con el script antes de mergear el PR.                                                                |
| 1.8     | 28/10/2026 | TC-I-122 a 125 (pedido cargado por el mozo, HU-039 / BL-209), para cargar con el script antes de mergear el PR.                                                                                 |
| 1.9     | 31/10/2026 | TC-I-106 y 107: DELETE pasa a eliminar definitivamente (BL-394). TC-I-126 a 131: Gestión de Carta (BL-392 / BL-402).                                                                            |
| 1.10    | 01/11/2026 | TC-I-132 a 135 (configuración del establecimiento, HU-020 / BL-72), para cargar con el script antes de mergear el PR.                                                                           |
| 1.11    | 01/11/2026 | TC-I-133 y 135: Plexo queda fuera del MVP, igual que Handy (BL-452).                                                                                                                            |
| 1.12    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-136 y 137: avisos de efectivo pendientes en el KDS (BL-448), para cargar con el script antes de mergear el PR.                     |
| 1.13    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-138: rebaja de IVA de la Ley 17.934 en el estado del pago (HU-037 / BL-207), para cargar con el script antes de mergear el PR.     |
| 1.14    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-139: datos del establecimiento para la política de privacidad (HU-036 / BL-206), para cargar con el script antes de mergear el PR. |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-139

### Precondición

Tenant A del seed, con un correo de privacidad cargado en el restaurante (el test lo carga y al terminar deja el que había) y el QR de la mesa del seed.

### Pasos

1. Pedir los datos para la política de privacidad desde la carta web: `GET /menu/tenant/:tenantId/restaurante/:restauranteId/privacidad`.
2. Pedirlos desde el QR de la mesa: `GET /menu/qr/:token/privacidad`.
3. Pedirlos con un restaurante que no es del tenant.

### Resultado esperado

1. 200 con el nombre del local, la razón social, el RUT, la dirección y el correo de privacidad.
2. 200 con los mismos datos.
3. 404, sin revelar si el restaurante existe en otro tenant.
