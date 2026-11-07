# Descripciones de los casos E2E (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                         |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | Plantilla (BL-435).                                                                                                                                  |
| 1.1     | 28/10/2026 | TC-E-046 a 049: cobro en efectivo (BL-201), solicitud de efectivo (BL-442) y pedido del mozo (BL-209).                                               |
| 1.2     | 31/10/2026 | TC-E-007 y 008 cambian: la carta por URL muestra los agotados bloqueados, igual que el QR (BL-397).                                                  |
| 1.3     | 31/10/2026 | TC-E-050 a 055: Gestión de Carta (BL-392 / BL-402).                                                                                                  |
| 1.4     | 01/11/2026 | TC-E-056 a 058: medios de pago del comensal según la configuración del local (BL-452).                                                               |
| 1.5     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-059 a 061: retomar el pago al recargar y aviso de efectivo en el KDS (BL-448).          |
| 1.6     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-062: política de privacidad desde la carta y el pago (BL-206).                          |
| 1.7     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-063 y 064: e-Factura con RUT y razón social desde la pantalla de pago (HU-009, BL-453). |
| 1.8     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-063 cambia: sin aceptar el aviso no se avisa al mozo (BL-453, ajuste de staging).       |
| 1.9     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-065: comprobantes del administrador y su estado ante la DGI (HU-009, BL-455).           |
| 1.10    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-066 a 068: dashboard de reportes del administrador (HU-012, BL-108).                    |
| 1.11    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-069 a 071: stock de la jornada y campana de alertas de stock (HU-015, BL-120).          |
| 1.12    | 04/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-072: pendientes de emisión de comprobantes (HU-023, BL-96).                             |
| 1.13    | 04/11/2026 | TC-E-073 y 074: alertas del mozo (campana, pantalla Alertas y recarga con alertas pendientes) (BL-441).                                              |
| 1.14    | 06/11/2026 | TC-E-075 y 076: pantalla de Configuración accesible, responsive y con «Guardar cambios» al final (BL-473).                                           |
| 1.15    | 06/11/2026 | TC-E-077 y 078: pantalla de Stock de la jornada accesible, responsive y con «Guardar cambios» al final (BL-474).                                     |
| 1.16    | 07/11/2026 | TC-E-080: el mozo registra el cobro con el POS del local (HU-007b, BL-80).                                                                           |
| 1.17    | 07/11/2026 | TC-E-081: el mozo cancela desde el KDS un pedido pagado en efectivo (HU-024, BL-104).                                                                |
| 1.18    | 07/11/2026 | Se borran los bloques de TC-E-072, 080 y 081, ya cargados en Kiwi. TC-E-079: PDF del comprobante desde Comprobantes (HU-009, BL-454).                |
| 1.19    | 07/11/2026 | TC-E-082: el mozo cobra con el POS del local al confirmar el pedido de una mesa (HU-007b, BL-485).                                                   |

Plantilla para cargar en Kiwi la descripción de casos TC-E (Playwright)
nuevos o que cambiaron (BL-435). La usa
`cargar-casos-integracion.mjs --e2e --descripciones`.

## Cómo se usa

1. Agregar al final de este archivo un bloque por caso, con el formato del
   ejemplo de abajo (sin la sangría): un encabezado `## TC-E-NNN` en su
   propia línea y debajo `### Precondición`, `### Pasos` y
   `### Resultado esperado`.
2. Ver qué va a cambiar:
   `node scripts/kiwi/cargar-casos-integracion.mjs --e2e --descripciones`
3. Cargar:
   `node scripts/kiwi/cargar-casos-integracion.mjs --e2e --aplicar --descripciones`
4. Verificar con el comando del paso 2: tiene que decir «0 para actualizar».

El script reemplaza la descripción de cada caso que tenga un bloque acá, y
solo si cambió. Los casos sin bloque no se tocan. Una vez cargados, los
bloques se pueden borrar de este archivo: la descripción queda en Kiwi, que
es donde se consulta.

Reglas:

- El caso tiene que existir en el Test Plan «E2E-Playwright». Si es nuevo,
  el mismo comando con `--aplicar` lo crea antes de cargar la descripción.
- Sin credenciales, URLs de entornos ni datos personales: el repositorio es
  público.

## Ejemplo

    ## TC-E-040

    ### Precondición
    Usuario de prueba y datos que necesita el test.

    ### Pasos
    1. Lo que hace el test en la pantalla.

    ### Resultado esperado
    Lo que tiene que verse.

## Casos para cargar

## TC-E-073

### Precondición

Administrador del establecimiento del seed logueado en el panel. El test crea una mesa propia y la borra al terminar.

### Pasos

1. Abrir «Pedidos activos» del panel de administración.
2. Desde el QR de la mesa de prueba, presionar «Llamar al mozo».
3. En el encabezado, abrir la campana y revisar la vista rápida con axe-core (WCAG 2.1 AA).
4. Presionar Esc.
5. Desde el menú, abrir «Alertas» y revisar la pantalla con axe-core (WCAG 2.1 AA).
6. Aceptar la alerta de la mesa de prueba.

### Resultado esperado

1. Se ve el tablero y la campana del encabezado.
2. El comensal ve «Avisamos al mozo». La campana muestra el contador y el tablero no muestra el aviso de la mesa: los llamados se atienden desde la campana y la pantalla «Alertas».
3. Se abre la vista rápida con «Mesa N solicita atención» (N es el número de la mesa de prueba), sin errores graves ni críticos de accesibilidad.
4. La vista rápida se cierra y el foco vuelve a la campana.
5. Se abre la pantalla «Alertas», marcada como la página actual del menú, con la alerta de la mesa y los botones «Aceptar» y «Desestimar», sin errores graves ni críticos de accesibilidad.
6. La alerta sale de la lista.

## TC-E-074

### Precondición

Administrador del establecimiento del seed logueado en el panel. El test crea dos mesas propias y las borra al terminar.

### Pasos

1. Abrir «Alertas» desde el menú.
2. Desde el QR de cada una de las dos mesas de prueba (A y B), presionar «Llamar al mozo».
3. Recargar la página.
4. Aceptar la alerta de la mesa A.
5. Recargar la página otra vez.

### Resultado esperado

1. Se abre la pantalla «Alertas».
2. Las dos mesas aparecen en la lista como «Mesa N solicita atención».
3. Las dos alertas siguen en la lista, aunque nadie las atendió.
4. La alerta de la mesa A sale de la lista.
5. La alerta de la mesa B sigue en la lista y la de la mesa A no vuelve.

## TC-E-075

### Precondición

Administrador del establecimiento del seed logueado en el panel. Ventana de escritorio (1440 × 900). El test no cambia la configuración.

### Pasos

1. Abrir «Configuración».
2. Revisar la pantalla con axe-core (WCAG 2.1 AA).
3. Mirar los botones del panel.
4. Bajar hasta la sección «Privacidad».

### Resultado esperado

1. Se ve el formulario de configuración.
2. No hay errores de accesibilidad graves ni críticos.
3. «Guardar cambios» es el último botón y se ve en pantalla.
4. «Guardar cambios» sigue siendo el último botón y sigue a la vista (barra fija abajo).

## TC-E-076

### Precondición

Administrador del establecimiento del seed logueado en el panel. Ventana de celular (375 × 812). El test no cambia la configuración.

### Pasos

1. Abrir «Configuración».
2. Revisar si la página o el panel tienen scroll horizontal.
3. Bajar hasta «Anonimizar datos de facturación».

### Resultado esperado

1. Se ve el formulario en una sola columna.
2. No hay scroll horizontal y «Guardar cambios» se ve en pantalla.
3. Sigue sin haber scroll horizontal y «Guardar cambios» sigue a la vista, como último botón.

## TC-E-077

### Precondición

Administrador del establecimiento del seed logueado en el panel. Ventana de escritorio (1440 × 900). El test no cambia el stock.

### Pasos

1. Abrir «Stock».
2. Revisar la pantalla con axe-core (WCAG 2.1 AA).
3. Mirar los botones del panel.
4. Bajar hasta la última categoría.

### Resultado esperado

1. Se ven las tablas de stock por categoría.
2. No hay errores de accesibilidad graves ni críticos.
3. «Guardar cambios» es el último botón y se ve en pantalla.
4. «Guardar cambios» sigue siendo el último botón y sigue a la vista (barra fija abajo).

## TC-E-078

### Precondición

Administrador del establecimiento del seed logueado en el panel. Ventana de celular (375 × 812). El test no cambia el stock.

### Pasos

1. Abrir «Stock».
2. Revisar si la página, el panel o las tablas tienen scroll horizontal.
3. Bajar hasta la última categoría.

### Resultado esperado

1. Se ven las tablas de stock por categoría, una debajo de la otra.
2. No hay scroll horizontal y «Guardar cambios» se ve en pantalla.
3. Sigue sin haber scroll horizontal y «Guardar cambios» sigue a la vista, como último botón.

## TC-E-079

### Precondición

Administrador del establecimiento del seed logueado en el panel. Al menos un comprobante emitido en la última semana (si no hay, el test se saltea).

### Pasos

1. Abrir «Comprobantes» y poner «Desde» una semana atrás.
2. Tocar «PDF» en el primer comprobante.

### Resultado esperado

Se descarga un archivo «e-Ticket-<serie>-<número>.pdf» o «e-Factura-<serie>-<número>.pdf».

## TC-E-082

### Precondición

Mozo del establecimiento del seed logueado. Mesa del seed abierta. Efectivo y POS del local habilitados en Configuración.

### Pasos

1. Abrir «Cargar pedido» de la mesa, agregar un ítem y tocar «Confirmar pedido».
2. Tocar «Cobrar con el POS», elegir «Crédito» y cargar la autorización «e2e082».
3. Tocar «Registrar cobro».
4. Abrir el KDS.

### Resultado esperado

1. El pedido queda cargado y se ofrecen «Cobrar en efectivo» y «Cobrar con el POS».
2. Se abre el diálogo con el total del pedido. Sin errores graves de accesibilidad (axe).
3. Se registra el cobro (crédito, autorización E2E082) y aparece «Cobro registrado: pedido …».
4. El pedido está en el KDS.
