# Descripciones de los casos de integración (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                                                                                             |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | 24/10/2026 | TC-I-010 a 013 y 055 a 081, cargadas en Kiwi con el script.                                                                                                                                                              |
| 1.1     | 27/10/2026 | TC-I-022 a 024 (el pedido llega al KDS al aprobarse el pago, BL-311) y TC-I-082 a 086 (sesión de mesa, HU-017 / BL-60). Cargadas en Kiwi el 27/10/2026.                                                                  |
| 1.2     | 27/10/2026 | TC-I-082 a 086: la mesa del test pasa de la 97 a la 79 (fuera del rango 80 a 99 de `mesas-layout.e2e-spec.ts`).                                                                                                          |
| 1.3     | 27/10/2026 | TC-I-087 a 094 (gestión de establecimientos, BL-404 / BL-416), para cargar con el script antes de mergear el PR.                                                                                                         |
| 1.4     | 27/10/2026 | TC-I-095 a 098 (vencimiento y conciliación de pagos, HU-032 / BL-202).                                                                                                                                                   |
| 1.5     | 27/10/2026 | Se recupera el contenido que se perdió en el merge de BL-435 (TC-I-010 a 098). TC-I-099 a 108: CRUD de la carta (HU-005, BL-52/BL-53), antes `[TC-E-…]`.                                                                 |
| 1.6     | 28/10/2026 | TC-I-113 a 117 (cobro en efectivo, HU-031 / BL-201), para cargar con el script antes de mergear el PR.                                                                                                                   |
| 1.7     | 28/10/2026 | TC-I-118 a 121 (solicitud de pago en efectivo del comensal, HU-031b / BL-442), para cargar con el script antes de mergear el PR.                                                                                         |
| 1.8     | 28/10/2026 | TC-I-122 a 125 (pedido cargado por el mozo, HU-039 / BL-209), para cargar con el script antes de mergear el PR.                                                                                                          |
| 1.9     | 31/10/2026 | TC-I-106 y 107: DELETE pasa a eliminar definitivamente (BL-394). TC-I-126 a 131: Gestión de Carta (BL-392 / BL-402).                                                                                                     |
| 1.10    | 01/11/2026 | TC-I-132 a 135 (configuración del establecimiento, HU-020 / BL-72), para cargar con el script antes de mergear el PR.                                                                                                    |
| 1.11    | 01/11/2026 | TC-I-133 y 135: Plexo queda fuera del MVP, igual que Handy (BL-452).                                                                                                                                                     |
| 1.12    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-136 y 137: avisos de efectivo pendientes en el KDS (BL-448), para cargar con el script antes de mergear el PR.                                              |
| 1.13    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-138: rebaja de IVA de la Ley 17.934 en el estado del pago (HU-037 / BL-207), para cargar con el script antes de mergear el PR.                              |
| 1.14    | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-139: datos del establecimiento para la política de privacidad (HU-036 / BL-206), para cargar con el script antes de mergear el PR.                          |
| 1.15    | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-140 y 141: e-Factura con RUT y razón social, consentimiento y anonimización (HU-009 / BL-453), para cargar con el script antes de mergear el PR.            |
| 1.16    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-142 y 143: estado de los CFE ante la DGI y listado de comprobantes del administrador (HU-009 / BL-455), para cargar con el script antes de mergear el PR.   |
| 1.17    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-I-144 a 152: dashboard de reportes de ventas y resumen por hora (HU-012 / BL-108, BL-109, BL-110 y BL-219), para cargar con el script antes de mergear el PR. |

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-144

### Precondición

Tenant A del seed. Ventas de prueba el 10/03/2020 (hora de Montevideo): un pedido QR de 2 × plato A ($ 1.000, Mercado Pago, 12 h), uno del mozo de 1 × plato B ($ 500, efectivo, 12 h), uno Web de 1 × plato A ($ 500, Mercado Pago, 20 h), un pago rechazado y uno reembolsado. Dos sesiones de mesa cerradas ese día (30 y 90 minutos). Resumen de ventas recalculado. Usuario administrador.

### Pasos

1. Como administrador, pedir GET /admin/reportes con período personalizado del 10/03/2020 al 10/03/2020 y todos los canales.

### Resultado esperado

1. Responde 200 con: total vendido $ 2.000, 3 pedidos, ticket promedio $ 666,67, período anterior en cero; dentro del local $ 1.500, Web $ 500, WhatsApp 0; ventas a las 12 h ($ 1.500, 2 pedidos) y a las 20 h ($ 500, 1 pedido); platos por cantidad: A (3, $ 1.500) y B (1, $ 500); rotación con 2 sesiones y 60 minutos de ocupación promedio. El pago rechazado y el reembolsado no cuentan.

## TC-I-145

### Precondición

Los mismos datos que TC-I-144. Usuario administrador.

### Pasos

1. Pedir el reporte del 10/03/2020 con el canal En el local.
2. Pedirlo con el canal Web.
3. Pedirlo con el canal WhatsApp.

### Resultado esperado

1. $ 1.500 y 2 pedidos (QR y mozo), solo la hora 12; la rotación aplica.
2. $ 500 y 1 pedido, solo la hora 20, plato A; la rotación no aplica. La comparación dentro y fuera del local sigue con todos los canales.
3. Todo en cero, sin horas; la rotación no aplica.

## TC-I-146

### Precondición

API levantada.

### Pasos

1. Pedir GET /admin/reportes sin token.

### Resultado esperado

1. Responde 401.

## TC-I-147

### Precondición

Usuario mozo del tenant A.

### Pasos

1. Pedir GET /admin/reportes con el token del mozo.

### Resultado esperado

1. Responde 403: los reportes son solo del administrador.

## TC-I-148

### Precondición

Usuario de cocina del tenant A.

### Pasos

1. Pedir GET /admin/reportes con el token de cocina.

### Resultado esperado

1. Responde 403.

## TC-I-149

### Precondición

Usuario administrador.

### Pasos

1. Pedir un período personalizado en el futuro (enero de 2099).
2. Pedir: «desde» posterior a «hasta»; un rango de más de 366 días; un día que no existe (30/02); el período personalizado sin fechas; un período desconocido; un canal desconocido; un parámetro tenantId.

### Resultado esperado

1. Responde 200 con el reporte vacío (sin error).
2. Cada pedido responde 400, nunca 5xx.

## TC-I-150

### Precondición

Los mismos datos que TC-I-144.

### Pasos

1. Leer el resumen de ventas del tenant A para el 10/03/2020.
2. Recalcular de nuevo esa ventana y volver a leerlo.

### Resultado esperado

1. Tres filas: QR con Mercado Pago $ 1.000, mozo con efectivo $ 500 y Web con Mercado Pago $ 500. El pago rechazado y el reembolsado no están.
2. Las mismas filas (el recálculo es idempotente).

## TC-I-151

### Precondición

Los mismos datos que TC-I-144 en el tenant A. Tenant B del seed.

### Pasos

1. Desde el contexto del tenant B, contar las filas del resumen del tenant A del 10/03/2020.
2. Pedir el reporte del 10/03/2020 para el tenant B.

### Resultado esperado

1. Cero filas (RLS).
2. Todo en cero: no se ve nada del tenant A.

## TC-I-152

### Precondición

Tenant A con 3 sprints (6 semanas) de resumen cargado: 12 horas por día, 3 canales, 2 medios de pago y 20 platos por hora y canal.

### Pasos

1. Pedir el reporte del último mes de esos datos y medir el tiempo.

### Resultado esperado

1. Responde con datos y el top 10 de platos en menos de 2 segundos.
