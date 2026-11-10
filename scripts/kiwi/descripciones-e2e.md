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
| 1.24    | 10/11/2026 | TC-E-091 y 092: monitor de Cocina de solo lectura, sin scroll, con resumen grande y accesible (HU-038, BL-510). |
| 1.25    | 10/11/2026 | TC-E-093 a 097: propina en el pago del comensal, en los cobros del mozo y en Reportes (HU-022, BL-496). Renumerados desde TC-E-087 a 091, que ya eran de KDS (BL-512). |

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

## TC-E-091

### Precondición

Usuarios Mozo y Cocina del tenant de testing (Keycloak de pruebas), en sesiones separadas. Cola automática apagada. Monitor de Cocina en una pantalla de 1920×1080.

### Pasos

1. Como comensal, hacer y pagar dos pedidos.
2. Como Mozo, pasar el primero a preparación. El segundo queda recibido.
3. Como Cocina, abrir el KDS.
4. Como Mozo, marcar el primero «Listo para entregar».
5. Como Mozo, marcarlo «Entregado».

### Resultado esperado

1. —
2. —
3. Se ve el monitor con el resumen «En preparación», «Listos» y «En espera» (al menos 1). El primer pedido tiene tarjeta «En preparación»; el segundo no tiene tarjeta. No hay botones ni scroll.
4. Sin recargar, la tarjeta pasa a «Listo para entregar».
5. La tarjeta sale del monitor. Sigue sin haber scroll.

## TC-E-092

### Precondición

Igual que TC-E-091.

### Pasos

1. Como comensal, hacer y pagar un pedido; como Mozo, pasarlo a preparación.
2. Como Cocina, abrir el KDS.

### Resultado esperado

1. —
2. Se ve la tarjeta del pedido en el monitor. Sin errores graves de accesibilidad (axe, WCAG 2.1 AA).

## TC-E-093

### Precondición

Usuario Mozo del tenant de testing (Keycloak de pruebas). El establecimiento no trae propinas sugeridas: se usa «Otro monto». Consumo de $ 590 (Milanesa a la napolitana, seed).

### Pasos

1. Como comensal, en la mesa, pedir una Milanesa a la napolitana y llegar a «Pagá tu pedido».
2. Elegir «Otro monto», escribir 50 y tocar «Aplicar».
3. Avisar al mozo para pagar en efectivo.
4. Como Mozo, en «Cobros pendientes», ver el pedido y tocar «Cobrar en efectivo».
5. Ver el desglose y tocar «Confirmar cobro».

### Resultado esperado

1. —
2. El resumen muestra Consumo $ 590, Propina $ 50 y Total $ 640.
3. La pantalla guarda la propina de $ 50 y avisa al mozo.
4. La fila dice «Incluye propina de $ 50» y se abre el diálogo de cobro.
5. El diálogo muestra Consumo, Propina y Total $ 640, y el Mozo no puede cambiar la propina. El cobro responde 201 con el total esperado de $ 640 y el comensal ve «¡Tu pedido ya está en cocina!».

## TC-E-094

### Precondición

Igual que TC-E-093.

### Pasos

1. Como comensal, hacer los pasos 1 a 3 de TC-E-093.
2. Como Mozo, en «Cobros pendientes», tocar «Cobrar con el POS» en ese pedido.
3. Ver el desglose, elegir «Débito», escribir el número de autorización y tocar «Registrar cobro».

### Resultado esperado

1. —
2. Se abre el diálogo con Consumo, Propina y «Total a cobrar en el POS» de $ 640.
3. El cobro responde 201 con el total esperado de $ 640, aparece «Cobro registrado: pedido #…» y el pedido sale de la lista de pendientes.

## TC-E-095

### Precondición

Usuario Administrador del tenant de testing (Keycloak de pruebas).

### Pasos

1. Abrir Reportes desde el menú.

### Resultado esperado

1. La API responde 200 con las propinas del período (total, pedidos con propina y porcentaje de las ventas) y la propina de cada hora, todos numéricos. La pantalla muestra «Total vendido» y «Propinas» como tarjetas separadas, con el texto «Nadie dejó propina…» o «N de M pedidos dejaron propina».

## TC-E-096

### Precondición

Sin sesión. Igual que TC-E-093 en el pedido; se paga con una tarjeta de prueba del sandbox de Mercado Pago (APRO).

### Pasos

1. Como comensal, en la mesa, pedir una Milanesa a la napolitana y llegar a «Pagá tu pedido».
2. Ver el botón de pago sin elegir propina.
3. Elegir «Otro monto», escribir 50 y tocar «Aplicar».
4. Pagar con la tarjeta de prueba.

### Resultado esperado

1. —
2. El botón dice «Pagar $ 590».
3. El resumen muestra Total $ 640 y el botón pasa a «Pagar $ 640».
4. La pantalla guarda la propina antes de cobrar (PUT de la propina, 200, con $ 50), el pago responde 201 y el comensal ve «¡Tu pedido ya está en cocina!».

## TC-E-097

### Precondición

Igual que TC-E-096, sin llegar a pagar.

### Pasos

1. Como comensal, en la mesa, pedir una Milanesa a la napolitana y llegar a «Pagá tu pedido».
2. Elegir «Otro monto», escribir 50 y tocar «Aplicar».
3. Tocar «Sin propina».

### Resultado esperado

1. —
2. El resumen muestra la línea Propina y el Total $ 640.
3. Desaparece la línea Propina, el Total vuelve a $ 590 y el botón dice «Pagar $ 590».
