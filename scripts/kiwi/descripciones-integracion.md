# Descripciones de los casos de integración (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                                                |
| ------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 24/10/2026 | TC-I-010 a 013 y 055 a 081, cargadas en Kiwi con el script.                                                                                                                 |
| 1.1     | 27/10/2026 | TC-I-022 a 024 (el pedido llega al KDS al aprobarse el pago, BL-311) y TC-I-082 a 086 (sesión de mesa, HU-017 / BL-60). Cargadas en Kiwi el 27/10/2026.                     |
| 1.2     | 27/10/2026 | TC-I-082 a 086: la mesa del test pasa de la 97 a la 79 (fuera del rango 80 a 99 de `mesas-layout.e2e-spec.ts`).                                                             |
| 1.3     | 27/10/2026 | TC-I-087 a 094 (gestión de establecimientos, BL-404 / BL-416), para cargar con el script antes de mergear el PR.                                                            |
| 1.4     | 27/10/2026 | TC-I-095 a 098 (vencimiento y conciliación de pagos, HU-032 / BL-202).                                                                                                      |
| 1.5     | 27/10/2026 | Se recupera el contenido que se perdió en el merge de BL-435 (TC-I-010 a 098). TC-I-099 a 108: CRUD de la carta (HU-005, BL-52/BL-53), antes `[TC-E-…]`.                    |
| 1.6     | 28/10/2026 | TC-I-113 a 117 (cobro en efectivo, HU-031 / BL-201), para cargar con el script antes de mergear el PR.                                                                      |
| 1.7     | 28/10/2026 | TC-I-118 a 121 (solicitud de pago en efectivo del comensal, HU-031b / BL-442), para cargar con el script antes de mergear el PR.                                            |
| 1.8     | 28/10/2026 | TC-I-122 a 125 (pedido cargado por el mozo, HU-039 / BL-209), para cargar con el script antes de mergear el PR.                                                             |
| 1.9     | 31/10/2026 | TC-I-106 y 107: DELETE pasa a eliminar definitivamente (BL-394). TC-I-126 a 131: Gestión de Carta (BL-392 / BL-402).                                                        |
| 1.10    | 01/11/2026 | TC-I-132 a 135 (configuración del establecimiento, HU-020 / BL-72), para cargar con el script antes de mergear el PR.                                                       |
| 1.11    | 01/11/2026 | TC-I-133 y 135: Plexo queda fuera del MVP, igual que Handy (BL-452).                                                                                                        |
| 1.12    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-136 y 137: avisos de efectivo pendientes en el KDS (BL-448), para cargar con el script antes de mergear el PR. |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-136

### Precondición

Tenant A del seed, la mesa de prueba 77 abierta (con sesión) y un pedido de esa mesa en `PENDIENTE_PAGO` por $ 590.

### Pasos

1. El comensal pide pagar en efectivo con $ 1.000 (`SolicitudEfectivoService.solicitar`).
2. Consultar los avisos de efectivo pendientes del tenant A (`listarSolicitudesEfectivo`, lo que recibe el KDS al conectarse).
3. Consultar los avisos de otro tenant.
4. El mozo cobra el pedido en efectivo.
5. Volver a consultar los avisos del tenant A.

### Resultado esperado

1. La solicitud queda guardada en el pedido.
2. El aviso aparece con la mesa, el número de mesa, el pedido, el total ($ 590,00) y con cuánto paga ($ 1.000,00).
3. El otro tenant no lo ve (RLS).
4. El pedido pasa a `RECIBIDO`.
5. El aviso ya no aparece.

## TC-I-137

### Precondición

Tenant A del seed, la mesa de prueba 77 abierta, un pedido de esa mesa en `PENDIENTE_PAGO` y el usuario MOZO del seed (Keycloak). Ningún KDS conectado.

### Pasos

1. El comensal pide pagar en efectivo sin decir con cuánto: el aviso en vivo no lo recibe nadie.
2. Un KDS se conecta por WebSocket con el token del mozo.

### Resultado esperado

Al conectarse, el KDS recibe `llamados:snapshot` con el aviso del pedido: la mesa 77, motivo `PAGO_EFECTIVO`, total $ 590,00 y sin monto de pago.
