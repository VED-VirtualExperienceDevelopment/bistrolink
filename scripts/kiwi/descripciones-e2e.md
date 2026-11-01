# Descripciones de los casos E2E (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                           |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| 1.0     | 27/10/2026 | Plantilla (BL-435).                                                                                    |
| 1.1     | 28/10/2026 | TC-E-046 a 049: cobro en efectivo (BL-201), solicitud de efectivo (BL-442) y pedido del mozo (BL-209). |
| 1.2     | 31/10/2026 | TC-E-007 y 008 cambian: la carta por URL muestra los agotados bloqueados, igual que el QR (BL-397).    |
| 1.3     | 31/10/2026 | TC-E-050 a 055: Gestión de Carta (BL-392 / BL-402).                                                    |
| 1.4     | 01/11/2026 | TC-E-056 a 058: medios de pago del comensal según la configuración del local (BL-452).                 |

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

## TC-E-046

### Precondición

Usuario de prueba MOZO (`TEST_MOZO_*`) del tenant A, con el efectivo habilitado en el establecimiento. Ítem disponible en la carta web (pedido para retirar).

### Pasos

1. Como comensal, agregar un ítem desde la carta web y tocar «Continuar al pago», sin pagar con tarjeta.
2. Como mozo, abrir «Cobros pendientes» y buscar el pedido por su código.
3. Tocar «Cobrar en efectivo», ingresar el monto recibido y confirmar.
4. Abrir el KDS.

### Resultado esperado

1. El pedido aparece entre los pendientes de pago, con su código y su total.
2. El diálogo muestra el vuelto antes de confirmar; al confirmar, aviso «Cobro registrado» y el pedido sale de la lista.
3. El pedido aparece en el KDS (pasó a RECIBIDO).

## TC-E-047

### Precondición

Mesa del seed abierta (QR del fixture), efectivo habilitado en el establecimiento y usuario de prueba MOZO (`TEST_MOZO_*`).

### Pasos

1. Como comensal, desde el QR de la mesa, agregar un ítem y tocar «Continuar al pago».
2. Elegir «Efectivo», completar «¿Con cuánto vas a pagar?» con 10000 y tocar «Avisar al mozo».
3. Como mozo, abrir «Cobros pendientes», buscar el pedido por su código, tocar «Cobrar en efectivo» y confirmar.

### Resultado esperado

1. Aparecen las opciones «Tarjeta de débito o crédito» y «Efectivo».
2. La pantalla del comensal pasa a «Esperando al mozo».
3. El pedido aparece marcado «Pidió pagar en efectivo» y el diálogo trae 10000.00 en «Monto recibido».
4. Al confirmar, la pantalla del comensal pasa sola a «¡Tu pedido ya está en cocina!».

## TC-E-048

### Precondición

Carta web del local (pedido para retirar, fuera del local).

### Pasos

1. Agregar un ítem y tocar «Continuar al pago».

### Resultado esperado

Se ve solo el formulario de tarjeta: no aparecen las opciones de pago ni «Efectivo».

## TC-E-049

### Precondición

Usuario de prueba MOZO (`TEST_MOZO_*`) y la mesa del seed abierta (la abre el fixture de los QR). Efectivo habilitado en el establecimiento.

### Pasos

1. Como mozo, abrir la carga de pedido de la mesa (`/admin/mesas/pedido?mesa=…`), agregar una unidad de un ítem con una nota y tocar «Confirmar pedido».
2. Tocar «Cobrar en efectivo», ingresar el monto recibido y confirmar.
3. Abrir el KDS.

### Resultado esperado

1. El pedido se crea con canal `MOZO`.
2. Aparece el aviso «Cobro registrado».
3. El pedido aparece en el KDS.

## TC-E-007

### Precondición

Mesa del seed con su QR (fixture) y, en la carta, al menos un ítem disponible y uno agotado («Agua con gas» del seed).

### Pasos

1. Pedir la carta por la API con el QR de la mesa y por la URL del restaurante.
2. Abrir la carta por URL en el navegador.

### Resultado esperado

1. Las dos respuestas traen los mismos ítems.
2. Se ven todos los ítems disponibles.
3. Los agotados también se ven, con «No disponible» y bloqueados (`aria-disabled="true"`), como en la carta del QR (BL-397).

## TC-E-008

### Precondición

Al menos un ítem disponible en la carta del restaurante.

### Pasos

1. Abrir la carta por URL.
2. Tocar «Agregar» en el primer ítem disponible (los agotados se saltean: desde BL-397 la carta por URL también los muestra).

### Resultado esperado

El ítem queda en el carrito.

## TC-E-050

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`). El test crea por la API una categoría «E2E carta …» vacía y al terminar la elimina.

### Pasos

1. En `/admin/menu`, tocar «Agregar ítem» en la categoría de prueba.
2. Completar «Nombre» con «Chivito E2E» y «Precio» con «590,50» (con coma) y tocar «Guardar».

### Resultado esperado

El diálogo se cierra y la tarjeta del ítem muestra el precio con centésimos (590,50).

## TC-E-051

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y una categoría de prueba con el ítem «Flan E2E», creada por la API.

### Pasos

1. Abrir el menú «⋯» del ítem y elegir «Archivar».
2. Confirmar en el diálogo.
3. Tocar «Deshacer» en el aviso.

### Resultado esperado

1. El diálogo «Archivar ítem» se abre con el foco en «Cancelar».
2. El ítem sale de la vista y aparece el aviso «Ítem «Flan E2E» archivado».
3. El ítem vuelve a la carta.

## TC-E-052

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y una categoría de prueba con el ítem «Pancho E2E».

### Pasos

1. Apagar el switch «Pancho E2E disponible».
2. Volver a abrir la carta.

### Resultado esperado

1. La tarjeta muestra «Agotado».
2. El ítem sigue agotado: el cambio quedó guardado.

## TC-E-053

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y una categoría de prueba con «Primero E2E» y «Segundo E2E», en ese orden. La categoría nueva queda última en la carta.

### Pasos

1. Abrir el menú «⋯» de «Segundo E2E» y elegir «Subir».
2. En la manija «Mover la categoría …» de la categoría de prueba: Espacio, flecha arriba, Espacio.
3. Volver a abrir la carta.

### Resultado esperado

1. «Segundo E2E» queda primero y el foco vuelve a su «⋯».
2. La categoría de prueba sube un lugar.
3. Los dos cambios siguen: quedaron guardados.

## TC-E-054

### Precondición

Usuario de prueba MOZO (`TEST_MOZO_*`) y la carta del seed.

### Pasos

1. Abrir `/admin/menu` como mozo.

### Resultado esperado

1. Se ven los switches de disponibilidad (por ejemplo, «Milanesa a la napolitana disponible»).
2. No aparecen «Nueva categoría», «Agregar ítem», los menús «⋯» ni las manijas para ordenar.
3. El filtro «Estado» no ofrece «En categorías ocultas» ni «Archivados».

## TC-E-055

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y una categoría de prueba con dos ítems.

### Pasos

En celular (390 px), tablet (768 px) y PC (1280 px), revisar con axe-core:

1. La carta.
2. El menú «⋯» de un ítem, abierto.
3. Los diálogos «Nueva categoría», «Nuevo ítem» y «Archivar ítem» (se cierran con «Cancelar», sin guardar).
4. La carta con una búsqueda escrita (aviso «Para cambiar el orden, quitá los filtros.»).

### Resultado esperado

Ninguna violación critical ni serious de WCAG 2.1 AA.

## TC-E-056

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y la mesa del seed abierta. Corre en el proyecto `chromium-configuracion`.

### Pasos

1. Como admin, deshabilitar Mercado Pago y dejar el efectivo habilitado (`PATCH /admin/configuracion`).
2. Como comensal, abrir la carta con el QR de la mesa, agregar un ítem y tocar «Continuar al pago».
3. Al terminar, restaurar la configuración.

### Resultado esperado

1. Se muestra directo el pago en efectivo («¿Con cuánto vas a pagar?» y «Avisar al mozo»).
2. No aparecen el formulario de tarjeta ni el selector de medios.

## TC-E-057

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y la mesa del seed abierta. Corre en el proyecto `chromium-configuracion`.

### Pasos

1. Como admin, deshabilitar el efectivo y dejar Mercado Pago habilitado.
2. Como comensal, abrir la carta con el QR de la mesa, agregar un ítem y tocar «Continuar al pago».
3. Al terminar, restaurar la configuración.

### Resultado esperado

1. Se muestra directo el formulario «Tarjeta de débito o crédito».
2. No aparecen el selector de medios ni «Avisar al mozo».

## TC-E-058

### Precondición

Usuario de prueba ADMIN (`TEST_ADMIN_*`) y la mesa del seed abierta. Corre en el proyecto `chromium-configuracion`.

### Pasos

1. Como admin, deshabilitar el efectivo y Mercado Pago.
2. Como comensal, abrir la carta con el QR de la mesa, agregar un ítem y tocar «Continuar al pago».
3. Al terminar, restaurar la configuración.

### Resultado esperado

1. Se ve el aviso «… Llamá al mozo para que te cobre.» con el botón «Llamar al mozo».
2. No aparecen el formulario de tarjeta ni el de efectivo.
