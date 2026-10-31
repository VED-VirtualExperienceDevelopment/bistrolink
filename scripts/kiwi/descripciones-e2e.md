# Descripciones de los casos E2E (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                           |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| 1.0     | 27/10/2026 | Plantilla (BL-435).                                                                                    |
| 1.1     | 28/10/2026 | TC-E-046 a 049: cobro en efectivo (BL-201), solicitud de efectivo (BL-442) y pedido del mozo (BL-209). |
| 1.2     | 31/10/2026 | TC-E-007 y 008 cambian: la carta por URL muestra los agotados bloqueados, igual que el QR (BL-397).    |

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
