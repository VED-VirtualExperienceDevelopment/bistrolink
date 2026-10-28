# Descripciones de los casos E2E (Kiwi TCMS)

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
