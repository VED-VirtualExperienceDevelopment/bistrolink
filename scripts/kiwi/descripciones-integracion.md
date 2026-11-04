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

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-153

### Precondición

Tenant A del seed. Un ítem de prueba en la categoría Platos, sin control de stock. Usuario administrador.

### Pasos

1. Como administrador, mandar PATCH /admin/stock con ese ítem: control de stock activado, 4 unidades y aviso en 5.
2. Pedir GET /admin/stock.
3. Pedir GET /admin/stock/alertas.

### Resultado esperado

1. Responde 200 con el ítem: control de stock activado, 4 unidades, aviso en 5, disponible y alerta «STOCK_CRITICO».
2. El ítem aparece con 4 unidades.
3. El ítem aparece con 4 unidades, aviso en 5 y tipo «STOCK_CRITICO». La alerta solo lleva nombre y cantidades.

## TC-I-154

### Precondición

El ítem de prueba de TC-I-153. Usuario administrador.

### Pasos

1. Mandar PATCH /admin/stock con: un aviso de -1; un stock de -5; un stock de 2,5; un stock de 3 con un campo tenantId de más.

### Resultado esperado

1. Cada pedido responde 400 y el stock no cambia.

## TC-I-155

### Precondición

API levantada.

### Pasos

1. Pedir GET /admin/stock/alertas sin token.
2. Mandar PATCH /admin/stock sin token.

### Resultado esperado

1. Responde 401.
2. Responde 401.

## TC-I-156

### Precondición

Usuarios mozo y cocina del tenant A.

### Pasos

1. Con cada uno, pedir GET /admin/stock/alertas.
2. Con cada uno, mandar PATCH /admin/stock con 99 unidades.

### Resultado esperado

1. Responde 403: el stock es solo del administrador.
2. Responde 403 y el stock no cambia.

## TC-I-157

### Precondición

El ítem de prueba con control de stock, 7 unidades y aviso en 5. Un pedido en espera de pago con 3 unidades del ítem.

### Pasos

1. Confirmar el pago del pedido.

### Resultado esperado

1. En la misma transacción el stock baja a 4 y el ítem sigue disponible. Se avisa a los administradores del tenant A (`stock:alerta`) con el ítem, 4 unidades, aviso en 5 y tipo «STOCK_CRITICO», en menos de 5 segundos.

## TC-I-158

### Precondición

El ítem de prueba con control de stock, 2 unidades y aviso en 5. Un pedido en espera de pago con 2 unidades del ítem.

### Pasos

1. Confirmar el pago del pedido.
2. Crear otro pedido con 1 unidad del ítem y verificar el stock antes de cobrarlo.

### Resultado esperado

1. El stock queda en 0 y el ítem no disponible. Se avisa a los administradores con tipo «AGOTADO» y a la carta del comensal que el ítem no está disponible.
2. Responde 409: el ítem está agotado y no se cobra.

## TC-I-159

### Precondición

El ítem de prueba con control de stock y 1 unidad. Dos pedidos en espera de pago con 1 unidad cada uno, que ya pasaron la verificación de stock.

### Pasos

1. Confirmar los dos pagos a la vez.

### Resultado esperado

1. Los dos pagos se confirman (el dinero ya se cobró, ADR 0009). El stock queda en 0, nunca negativo, y el ítem no disponible. Se avisa una sola vez «1 vendida sin stock» y queda un registro «CARTA_ITEM_VENDIDO_SIN_STOCK» en la auditoría.

## TC-I-160

### Precondición

El ítem de prueba del tenant A agotado (0 unidades). Tenant B del seed.

### Pasos

1. Pedir las alertas y el stock con el contexto del tenant B.
2. Pedir las alertas con el contexto del tenant A.

### Resultado esperado

1. El ítem del tenant A no aparece (RLS).
2. El ítem aparece.
