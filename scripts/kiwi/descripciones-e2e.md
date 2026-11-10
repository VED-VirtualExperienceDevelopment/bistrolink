# Descripciones de los casos E2E (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                                                         |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | 27/10/2026 | Plantilla (BL-435).                                                                                                                                                                  |
| 1.1     | 28/10/2026 | TC-E-046 a 049: cobro en efectivo (BL-201), solicitud de efectivo (BL-442) y pedido del mozo (BL-209).                                                                               |
| 1.2     | 31/10/2026 | TC-E-007 y 008 cambian: la carta por URL muestra los agotados bloqueados, igual que el QR (BL-397).                                                                                  |
| 1.3     | 31/10/2026 | TC-E-050 a 055: Gestión de Carta (BL-392 / BL-402).                                                                                                                                  |
| 1.4     | 01/11/2026 | TC-E-056 a 058: medios de pago del comensal según la configuración del local (BL-452).                                                                                               |
| 1.5     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-059 a 061: retomar el pago al recargar y aviso de efectivo en el KDS (BL-448).                                          |
| 1.6     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-062: política de privacidad desde la carta y el pago (BL-206).                                                          |
| 1.7     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-063 y 064: e-Factura con RUT y razón social desde la pantalla de pago (HU-009, BL-453).                                 |
| 1.8     | 02/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-063 cambia: sin aceptar el aviso no se avisa al mozo (BL-453, ajuste de staging).                                       |
| 1.9     | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-065: comprobantes del administrador y su estado ante la DGI (HU-009, BL-455).                                           |
| 1.10    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-066 a 068: dashboard de reportes del administrador (HU-012, BL-108).                                                    |
| 1.11    | 03/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-069 a 071: stock de la jornada y campana de alertas de stock (HU-015, BL-120).                                          |
| 1.12    | 04/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-072: pendientes de emisión de comprobantes (HU-023, BL-96).                                                             |
| 1.13    | 04/11/2026 | TC-E-073 y 074: alertas del mozo (campana, pantalla Alertas y recarga con alertas pendientes) (BL-441).                                                                              |
| 1.14    | 06/11/2026 | TC-E-075 y 076: pantalla de Configuración accesible, responsive y con «Guardar cambios» al final (BL-473).                                                                           |
| 1.15    | 06/11/2026 | TC-E-077 y 078: pantalla de Stock de la jornada accesible, responsive y con «Guardar cambios» al final (BL-474).                                                                     |
| 1.16    | 07/11/2026 | TC-E-080: el mozo registra el cobro con el POS del local (HU-007b, BL-80).                                                                                                           |
| 1.17    | 07/11/2026 | TC-E-081: el mozo cancela desde el KDS un pedido pagado en efectivo (HU-024, BL-104).                                                                                                |
| 1.18    | 07/11/2026 | Se borran los bloques de TC-E-072, 080 y 081, ya cargados en Kiwi. TC-E-079: PDF del comprobante desde Comprobantes (HU-009, BL-454).                                                |
| 1.19    | 07/11/2026 | TC-E-082: el mozo cobra con el POS del local al confirmar el pedido de una mesa (HU-007b, BL-485).                                                                                   |
| 1.20    | 08/11/2026 | Se borran los bloques de TC-E-073 a 079 y 082, ya cargados en Kiwi. TC-E-083: ventas al POS del local desde «POS del local» (HU-011, BL-488).                                        |
| 1.21    | 09/11/2026 | Se borra el bloque de TC-E-083, ya cargado en Kiwi. TC-E-084: al hacer scroll en Reportes solo se desplaza el contenido (bug BL-500).                                                |
| 1.22    | 09/11/2026 | Se borra el bloque de TC-E-084, ya cargado en Kiwi. TC-E-085 y 086: el mozo cancela un pedido antes de cobrarlo, en la pantalla del pedido y desde «Cobros pendientes» (bug BL-501). |
| 1.23    | 10/11/2026 | TC-E-087 a 090: tiempo de espera de las comandas, indicador de conexión y accesibilidad del KDS (HU-038, BL-505). |

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

## TC-E-085

### Precondición

Mozo del establecimiento del seed logueado. La mesa del seed abierta.

### Pasos

1. Abrir «Cargar pedido» de la mesa, agregar un ítem y tocar «Confirmar pedido».
2. Tocar «Cancelar pedido».
3. En el diálogo, tocar «Cancelar pedido».
4. Ir a «Cobros pendientes».

### Resultado esperado

1. Aparece el pedido cargado, con los botones para cobrarlo y «Cancelar pedido».
2. Se abre el diálogo que avisa que el pedido todavía no se cobró. Sin errores graves de accesibilidad (axe).
3. Aparece «Pedido #… cancelado. No se cobró y no pasa a cocina.» y ya no se ofrece cobrarlo.
4. El pedido no está en la lista.

## TC-E-086

### Precondición

Igual que TC-E-085.

### Pasos

1. Cargar un pedido en la mesa y confirmarlo, sin cobrarlo.
2. Ir a «Cobros pendientes» y, en ese pedido, tocar «Cancelar pedido».
3. En el diálogo, tocar «Cancelar pedido».

### Resultado esperado

1. —
2. Se abre el diálogo de cancelación.
3. Aparece «Pedido #… cancelado. No se cobró y no pasa a cocina.» y el pedido desaparece de la lista.

## TC-E-087

### Precondición

Usuario Mozo del tenant de testing (Keycloak de pruebas) con el KDS abierto. Umbrales de espera por defecto (30/60/120). El reloj del navegador se adelanta con el reloj de prueba de Playwright.

### Pasos

1. Como comensal, hacer y pagar un pedido.
2. Ver su comanda en el KDS.
3. Adelantar el reloj 31 minutos, sin tocar nada.
4. Adelantar el reloj 30 minutos más.
5. Adelantar el reloj 1 hora más.

### Resultado esperado

1. —
2. La comanda dice «A tiempo», «Recién llegado» o «hace N min», y «Llegó HH:MM».
3. Sin recargar ni recibir otro evento, pasa a «Atención» y «hace 31 min» (aprox.).
4. Pasa a «Demorado» y «hace 1 h …».
5. Pasa a «⚠ Demora alta» y «hace 2 h …».

## TC-E-088

### Precondición

Igual que TC-E-087, con un pedido ya en el KDS.

### Pasos

1. Abrir el KDS.
2. Cortar la conexión con el servidor (el navegador sigue con red).
3. Mientras está cortada, hacer y pagar otro pedido.
4. Restablecer la conexión.

### Resultado esperado

1. El indicador dice «Conectado» y se ve la comanda.
2. El indicador pasa a «Reconectando…» y la comanda sigue a la vista.
3. —
4. Sin recargar la página, el indicador vuelve a «Conectado» y aparecen las dos comandas.

## TC-E-089

### Precondición

Igual que TC-E-087, con un pedido ya en el KDS.

### Pasos

1. Abrir el KDS.
2. Dejar el navegador sin red.
3. Devolverle la red.

### Resultado esperado

1. El indicador dice «Conectado».
2. Enseguida (sin esperar 30 s), el indicador pasa a «Desconectado». La comanda sigue a la vista.
3. El indicador vuelve a «Conectado».

## TC-E-090

### Precondición

Igual que TC-E-087.

### Pasos

1. Abrir el KDS con una comanda recién llegada.
2. Adelantar el reloj hasta «Atención», «Demorado» y «Demora alta».
3. Dejar el navegador sin red.

### Resultado esperado

1. Sin errores graves de accesibilidad (axe, WCAG 2.1 AA).
2. Sin errores graves de accesibilidad en cada nivel (incluido el contraste de los colores).
3. Con el indicador en «Desconectado», sin errores graves de accesibilidad.
