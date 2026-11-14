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
| 1.23    | 10/11/2026 | TC-E-087 a 090: tiempo de espera de las comandas, indicador de conexión y accesibilidad del KDS (HU-038, BL-505).                                                                    |
| 1.24    | 10/11/2026 | TC-E-091 y 092: monitor de Cocina de solo lectura, sin scroll, con resumen grande y accesible (HU-038, BL-510).                                                                      |
| 1.25    | 10/11/2026 | TC-E-093 a 097: propina en el pago del comensal, en los cobros del mozo y en Reportes (HU-022, BL-496). Renumerados desde TC-E-087 a 091, que ya eran de KDS (BL-512).               |

| 1.26 | 10/11/2026 | TC-E-069 a 071 cambian: las alertas de stock están en la campana de Alertas. TC-E-100 y 101: «Ir a cobrar» desde el aviso de efectivo (BL-470). TC-E-098 y 099 ya son de HU-040. |
| 1.27 | 10/11/2026 | Se borran los bloques de TC-E-071 y de TC-E-085 a 101, ya cargados en Kiwi. TC-E-102 y 103: «Mis pedidos» en la mesa y «Gracias por tu compra» (bug BL-502). |
| 1.28 | 10/11/2026 | Se borran los bloques de TC-E-102 y 103, ya cargados en Kiwi. TC-E-104: la carta pasa a «Tu mesa se cerró» cuando el mozo cierra la mesa (bug BL-518). |
| 1.29 | 10/11/2026 | Se borra el bloque de TC-E-104, ya cargado en Kiwi. TC-E-008 cambia: en el celular el detalle del carrito se abre desde la barra. TC-E-105 a 107: en el celular el carrito es una barra y el detalle se abre en una hoja; en escritorio sigue la columna (bug BL-519). |
| 1.30 | 11/11/2026 | Se borran los bloques de TC-E-008 y TC-E-105 a 107, ya cargados en Kiwi. TC-E-108 a 111: pantalla de Inicio del administrador y del mozo (mejora BL-520). |
| 1.31 | 12/11/2026 | Se borran los bloques de TC-E-108 a 111, ya cargados en Kiwi. TC-E-098 y 099: pedido para retirar con código, aviso de listo y entrega con código (HU-040, BL-210). |

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

## TC-E-098

### Precondición

El local del seed toma pedidos para retirar (habilitado, todo el día). Sandbox de Mercado Pago. Mozo logueado en otra pestaña.

### Pasos

1. Abrir la carta del enlace web, agregar un ítem, completar nombre y teléfono y aceptar el aviso.
2. Pagar con la tarjeta de prueba.
3. Como Mozo, abrir el KDS.
4. Marcar el pedido en preparación y listo para entregar.
5. Mirar la pantalla del comensal, sin recargar.

### Resultado esperado

1. —
2. «¡Tu pedido ya está en cocina!» con el «Código de retiro» R-NNN.
3. La comanda dice «Para retirar · R-NNN» y el nombre del comensal.
4. —
5. Aparece «Tu pedido está listo para retirar» con el código.

## TC-E-099

### Precondición

Igual que TC-E-098, con el efectivo habilitado (valor por defecto).

### Pasos

1. Armar un pedido para retirar y, como Mozo, cobrarlo en efectivo desde «Cobros pendientes».
2. En el KDS, pasarlo a preparación y a listo.
3. Tocar «Entregar con código», escribir otro código y tocar «Entregar».
4. Escribir el código del pedido y tocar «Entregar».

### Resultado esperado

1. El pedido llega al KDS como «Para retirar · R-NNN».
2. No aparece «Marcar como entregado»: aparece «Entregar con código».
3. El diálogo avisa que el código no coincide y el pedido no se entrega. Sin errores graves de accesibilidad (axe).
4. Responde 200 y la comanda sale del tablero.
