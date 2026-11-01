# Descripciones de los casos E2E (Kiwi TCMS)

## Control de versiones

| Versión | Fecha      | Modificación                                                                                                                                |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 27/10/2026 | Plantilla (BL-435).                                                                                                                         |
| 1.1     | 28/10/2026 | TC-E-046 a 049: cobro en efectivo (BL-201), solicitud de efectivo (BL-442) y pedido del mozo (BL-209).                                      |
| 1.2     | 31/10/2026 | TC-E-007 y 008 cambian: la carta por URL muestra los agotados bloqueados, igual que el QR (BL-397).                                         |
| 1.3     | 31/10/2026 | TC-E-050 a 055: Gestión de Carta (BL-392 / BL-402).                                                                                         |
| 1.4     | 01/11/2026 | TC-E-056 a 058: medios de pago del comensal según la configuración del local (BL-452).                                                      |
| 1.5     | 01/11/2026 | Se borran los bloques de los casos ya cargados en Kiwi. TC-E-059 a 061: retomar el pago al recargar y aviso de efectivo en el KDS (BL-448). |

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

## TC-E-059

### Precondición

Mesa del seed abierta con su QR, efectivo habilitado en el establecimiento y el usuario de prueba MOZO (`TEST_MOZO_*`).

### Pasos

1. El comensal escanea el QR, agrega un ítem y va a pagar.
2. Elige «Efectivo», escribe que paga con $ 10.000 y toca «Avisar al mozo».
3. Recarga la página.
4. El mozo cobra el pedido desde «Cobros pendientes».

### Resultado esperado

1. Se crea el pedido y aparece «Pagá tu pedido».
2. Aparece «Esperando al mozo».
3. Después de recargar sigue en «Esperando al mozo», con el mismo código de pedido, y no se crea otro pedido.
4. La pantalla del comensal pasa sola a «¡Tu pedido ya está en cocina!».

## TC-E-060

### Precondición

Carta web del establecimiento del seed (pedido para retirar) con un ítem disponible.

### Pasos

1. El comensal agrega un ítem y va a pagar.
2. Recarga la página en la pantalla de pago con tarjeta.
3. Revisar lo que quedó guardado en el navegador (sessionStorage).

### Resultado esperado

1. Aparece «Pagá tu pedido» con el formulario de tarjeta.
2. Vuelve a «Pagá tu pedido» con el mismo código de pedido y el formulario de tarjeta, sin crear otro pedido.
3. Está el id del pedido, pero no el token del comensal (JWT) ni datos de la tarjeta.

## TC-E-061

### Precondición

Mesa del seed abierta con su QR, efectivo habilitado y el usuario de prueba MOZO (`TEST_MOZO_*`).

### Pasos

1. El comensal pide pagar en efectivo con $ 7.777.
2. Después de la solicitud, el mozo abre (o recarga) el KDS.
3. Al terminar, el mozo cobra el pedido y lo entrega.

### Resultado esperado

1. Aparece «Esperando al mozo».
2. En el KDS aparece el aviso «Mesa N quiere pagar en efectivo», con el monto de $ 7.777, aunque el KDS no estaba abierto cuando el comensal avisó.
3. El pedido no queda pendiente ni con el aviso abierto.
