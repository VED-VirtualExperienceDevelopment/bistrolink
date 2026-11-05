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

Texto del campo de descripción de cada caso TC-I en Kiwi. Lo carga
`cargar-casos-integracion.mjs --descripciones`: cada bloque `## TC-I-NNN`
reemplaza la descripción de ese caso, y solo si cambió. Los casos que no
están en este archivo no se tocan.

Formato de cada bloque: `### Precondición`, `### Pasos` y `### Resultado
esperado`, igual que los casos cargados a mano desde TC-I-029.

## Casos para cargar

## TC-I-161

### Precondición

Tenant A del seed. Tres pagos APROBADOS sin comprobante: dos de hace 10 minutos (Surtec falso emite para uno y responde 503 para el otro) y uno de hace 5 días.

### Pasos

1. Correr la conciliación de CFE para el tenant B.
2. Correrla para el tenant A.
3. Correrla otra vez enseguida.
4. Con Surtec de vuelta, correrla 6 minutos después.

### Resultado esperado

1. No se emite nada de los pagos del tenant A (RLS).
2. El primero queda con su CFE (tipo 101, id externo `bl-<pagoId>`). El segundo queda sin CFE, con 1 intento fallido y el error guardado. El de hace 5 días no se toca.
3. El segundo no se reintenta (espera 5 minutos después del primer fallo).
4. El segundo queda con su CFE y el primero no se vuelve a emitir.

## TC-I-162

### Precondición

Tenant A del seed. Dos pagos APROBADOS sin comprobante: uno de hace 10 minutos y otro de hace 5 días.

### Pasos

1. Consultar los pendientes de emisión del tenant A y del tenant B.
2. Reintentar el de hace 5 días desde el tenant B.
3. Reintentarlo desde el tenant A (Surtec falso emite) y volver a consultar.
4. Reintentarlo otra vez.
5. Leer el registro de auditoría.

### Resultado esperado

1. En el tenant A aparecen los dos: el reciente con 0 intentos y próximo intento, el de hace 5 días como «requiere atención» y sin próximo intento. En el tenant B no aparecen.
2. 404.
3. Se emite el CFE y el pago ya no está entre los pendientes.
4. 409: ya tiene su comprobante.
5. Un registro PAGO_CFE_REINTENTADO del pago con el resultado EMITIDO.

## TC-I-163

### Precondición

Establecimiento de prueba con un usuario Mozo y un usuario Cocina. Una mesa propia ocupada con un pedido esperando el pago en efectivo.

### Pasos

1. El comensal avisa que paga en efectivo (queda una solicitud pendiente).
2. Se conectan al KDS por WebSocket un Mozo y un Cocina.
3. Se emiten en vivo un llamado de mesa y un aviso de efectivo.
4. Se emite un evento para todo el establecimiento (cambio de estado de mesa) como control.

### Resultado esperado

1. El Mozo recibe el efectivo pendiente en `llamados:snapshot`.
2. El Mozo recibe los dos avisos en vivo.
3. Cocina recibe el evento de control, pero ninguno de los avisos: ni snapshot, ni llamados, ni efectivo.
